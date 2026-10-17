// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {MockIdentityRegistry} from "../src/MockIdentityRegistry.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

contract IdentityTest is BaseTest {
    MockIdentityRegistry registry;

    function setUp() public override {
        super.setUp();
        registry = new MockIdentityRegistry();
    }

    function test_vaultIsValidSignature_onlyForOwner() public view {
        bytes32 h = keccak256("anything");
        assertEq(vault.isValidSignature(h, _sign(ownerPk, h)), IERC1271.isValidSignature.selector);
        assertEq(vault.isValidSignature(h, _sign(agentPk, h)), bytes4(0));
    }

    function test_agentRegisters_andBindsVaultAsWallet_withOwnerConsent() public {
        vm.prank(agent);
        uint256 id = registry.register("http://localhost:4010/.well-known/agent.json");
        assertEq(registry.ownerOf(id), agent);
        assertEq(registry.getAgentWallet(id), agent);

        uint256 deadline = block.timestamp + 60;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _registryDomain(),
                keccak256(
                    abi.encode(
                        keccak256(
                            "AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)"
                        ),
                        id,
                        address(vault),
                        agent,
                        deadline
                    )
                )
            )
        );
        bytes memory ownerSig = _sign(ownerPk, digest);
        vm.prank(agent);
        registry.setAgentWallet(id, address(vault), deadline, ownerSig);
        assertEq(registry.getAgentWallet(id), address(vault));

        // the agent key alone cannot bind the vault
        bytes memory agentSig = _sign(agentPk, digest);
        vm.prank(agent);
        vm.expectRevert("invalid wallet sig");
        registry.setAgentWallet(id, address(vault), deadline, agentSig);
    }

    function test_usdc_transferWithAuthorization() public {
        MockUSDC token = new MockUSDC();
        token.mint(agent, 1_000_000);
        bytes32 nonce = keccak256("n1");
        uint256 validAfter = 0;
        uint256 validBefore = block.timestamp + 3600;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
                        agent,
                        alice,
                        1000,
                        validAfter,
                        validBefore,
                        nonce
                    )
                )
            )
        );
        bytes memory sig = _sign(agentPk, digest);
        token.transferWithAuthorization(agent, alice, 1000, validAfter, validBefore, nonce, sig);
        assertEq(token.balanceOf(alice), 1000);
        assertTrue(token.authorizationState(agent, nonce));
        vm.expectRevert(MockUSDC.AuthorizationAlreadyUsed.selector);
        token.transferWithAuthorization(agent, alice, 1000, validAfter, validBefore, nonce, sig);
    }

    function _registryDomain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ERC8004IdentityRegistry"),
                keccak256("1"),
                block.chainid,
                address(registry)
            )
        );
    }
}
