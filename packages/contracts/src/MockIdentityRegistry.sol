// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @notice Local stand-in for the ERC-8004 Identity Registry, with the same external
///         surface we use (register, setAgentURI, getAgentWallet, setAgentWallet) and
///         the same EIP-712 domain, so the registration script behaves identically
///         on Anvil and on Base Sepolia. Not upgradeable, no metadata beyond the wallet. [ERC-8004]
contract MockIdentityRegistry is ERC721, EIP712 {
    uint256 private _lastId;
    mapping(uint256 => string) private _uris;
    mapping(uint256 => address) private _wallets;

    bytes32 private constant AGENT_WALLET_SET_TYPEHASH = keccak256(
        "AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)"
    );
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;
    uint256 private constant MAX_DEADLINE_DELAY = 5 minutes;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    constructor() ERC721("ERC8004 Agent", "AGENT") EIP712("ERC8004IdentityRegistry", "1") {}

    function register() external returns (uint256 agentId) {
        return _register("");
    }

    function register(string memory agentURI) external returns (uint256 agentId) {
        return _register(agentURI);
    }

    function _register(string memory agentURI) internal returns (uint256 agentId) {
        agentId = _lastId++;
        _wallets[agentId] = msg.sender;
        _uris[agentId] = agentURI;
        _safeMint(msg.sender, agentId);
        emit Registered(agentId, agentURI, msg.sender);
        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(msg.sender));
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(_isAuthorized(_ownerOf(agentId), msg.sender, agentId), "Not authorized");
        _uris[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _uris[agentId];
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _wallets[agentId];
    }

    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external {
        address owner = ownerOf(agentId);
        require(_isAuthorized(owner, msg.sender, agentId), "Not authorized");
        require(newWallet != address(0), "bad wallet");
        require(block.timestamp <= deadline, "expired");
        require(deadline <= block.timestamp + MAX_DEADLINE_DELAY, "deadline too far");
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(AGENT_WALLET_SET_TYPEHASH, agentId, newWallet, owner, deadline))
        );
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != newWallet) {
            (bool ok, bytes memory res) =
                newWallet.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
            require(
                ok && res.length >= 32 && abi.decode(res, (bytes4)) == ERC1271_MAGICVALUE,
                "invalid wallet sig"
            );
        }
        _wallets[agentId] = newWallet;
        emit MetadataSet(agentId, "agentWallet", "agentWallet", abi.encodePacked(newWallet));
    }

    function unsetAgentWallet(uint256 agentId) external {
        require(_isAuthorized(ownerOf(agentId), msg.sender, agentId), "Not authorized");
        _wallets[agentId] = address(0);
        emit MetadataSet(agentId, "agentWallet", "agentWallet", "");
    }
}
