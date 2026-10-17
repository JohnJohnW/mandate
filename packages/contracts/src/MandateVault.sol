// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {MandateMath} from "./MandateMath.sol";

/// @title MandateVault
/// @notice Holds the owner's assets and lets an AI agent act only inside a
///         mandate the owner sets on-chain: per-asset caps, a fixed spending
///         window, allowlisted targets and function selectors, an expiry, and a
///         co-signature ceiling. Everything above the autonomous caps needs an
///         EIP-712 approval from the owner that this contract verifies itself.
///         Everything above the co-signature ceiling has no code path at all.
/// @dev Unaudited. Testnet only. Design notes live in docs/ARCHITECTURE.md and
///      the ADRs under docs/adr. The agent is an externally owned account that
///      signs each intent and submits it; `msg.sender` must equal the signer.
contract MandateVault is Ownable2Step, EIP712, ReentrancyGuard, Pausable, IERC1271 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice A typed, signed action. Field order is the EIP-712 field order.
    struct Intent {
        bytes32 kind;
        address target;
        address token;
        uint256 amount;
        bytes32 dataHash;
        uint256 nonce;
        uint256 deadline;
        bytes32 rationaleHash;
    }

    struct AssetMandate {
        uint128 autonomousPerTxCap;
        uint128 autonomousWindowCap;
        uint128 coSignPerTxCap;
        uint128 spentInWindow;
        uint64 windowStart;
        uint32 windowSeconds;
        bool enabled;
    }

    struct AgentMandate {
        bool active;
        uint64 expiry;
        uint256 nextNonce;
        mapping(address token => AssetMandate) assets;
        mapping(address target => bool) allowedTargets;
        mapping(address target => mapping(bytes4 selector => bool)) allowedSelectors;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    bytes32 public constant KIND_TRANSFER_NATIVE = keccak256("TRANSFER_NATIVE");
    bytes32 public constant KIND_TRANSFER_ERC20 = keccak256("TRANSFER_ERC20");
    bytes32 public constant KIND_CALL = keccak256("CALL");
    bytes32 public constant KIND_APPROVE_ERC20 = keccak256("APPROVE_ERC20");
    bytes32 public constant KIND_TOPUP_PETTY_CASH = keccak256("TOPUP_PETTY_CASH");

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "Intent(bytes32 kind,address target,address token,uint256 amount,bytes32 dataHash,uint256 nonce,uint256 deadline,bytes32 rationaleHash)"
    );
    bytes32 public constant APPROVAL_TYPEHASH =
        keccak256("Approval(bytes32 intentHash,uint256 deadline)");

    uint8 public constant TIER_AUTONOMOUS = 1;
    uint8 public constant TIER_COSIGN = 2;
    uint8 public constant TIER_FORBIDDEN = 3;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    mapping(address agent => AgentMandate) internal _mandates;
    mapping(bytes32 intentHash => bool) public consumedApprovals;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event AgentSet(address indexed agent, uint64 expiry, bool active);
    event AssetMandateSet(
        address indexed agent,
        address indexed token,
        uint128 autonomousPerTxCap,
        uint128 autonomousWindowCap,
        uint128 coSignPerTxCap,
        uint32 windowSeconds,
        bool enabled
    );
    event TargetAllowed(address indexed agent, address indexed target, bool allowed);
    event SelectorAllowed(
        address indexed agent, address indexed target, bytes4 selector, bool allowed
    );
    event AgentRevoked(address indexed agent);
    event IntentExecuted(
        address indexed agent,
        bytes32 indexed intentHash,
        bytes32 kind,
        address target,
        address token,
        uint256 amount,
        uint8 tier
    );
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event OwnerExecuted(address indexed to, uint256 value, bytes data);

    // ---------------------------------------------------------------------
    // Errors (one per check, in the order the checks run)
    // ---------------------------------------------------------------------

    error AgentNotActive();
    error MandateExpired();
    error IntentExpired();
    error BadNonce(uint256 expected, uint256 given);
    error BadAgentSignature();
    error UnknownKind(bytes32 kind);
    error TokenMismatch();
    error AssetNotEnabled(address token);
    error PettyCashTargetNotAgent();
    error UnlimitedApproval();
    error CalldataMismatch();
    error SelectorNotAllowed(address target, bytes4 selector);
    error TargetNotAllowed(address target);
    error AbovePerTxCap(uint256 amount, uint256 cap);
    error AboveWindowCap(uint256 spent, uint256 amount, uint256 cap);
    error AboveCoSignCap(uint256 amount, uint256 cap);
    error ApprovalExpired();
    error ApprovalConsumed(bytes32 intentHash);
    error BadOwnerSignature();
    error NativeTransferFailed();
    error CallFailed(bytes returndata);
    error ZeroAddress();
    error WindowTooShort();

    // ---------------------------------------------------------------------
    // Constructor and receive
    // ---------------------------------------------------------------------

    constructor(address initialOwner) Ownable(initialOwner) EIP712("MandateVault", "1") {}

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------------
    // Owner: mandate administration
    // ---------------------------------------------------------------------

    /// @notice Activates or deactivates an agent and sets its mandate expiry.
    function setAgent(address agent, uint64 expiry, bool active) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        AgentMandate storage m = _mandates[agent];
        m.active = active;
        m.expiry = expiry;
        emit AgentSet(agent, expiry, active);
    }

    /// @notice Sets the caps for one asset. The running window accounting is kept
    ///         so that changing a cap never resets what was already spent.
    function setAssetMandate(
        address agent,
        address token,
        uint128 autonomousPerTxCap,
        uint128 autonomousWindowCap,
        uint128 coSignPerTxCap,
        uint32 windowSeconds,
        bool enabled
    ) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        if (windowSeconds == 0) revert WindowTooShort();
        AssetMandate storage a = _mandates[agent].assets[token];
        a.autonomousPerTxCap = autonomousPerTxCap;
        a.autonomousWindowCap = autonomousWindowCap;
        a.coSignPerTxCap = coSignPerTxCap;
        a.windowSeconds = windowSeconds;
        a.enabled = enabled;
        // casting to uint64 is safe: block timestamps fit in 64 bits until the year 584 billion
        // forge-lint: disable-next-line(unsafe-typecast)
        if (a.windowStart == 0) a.windowStart = uint64(block.timestamp);
        emit AssetMandateSet(
            agent,
            token,
            autonomousPerTxCap,
            autonomousWindowCap,
            coSignPerTxCap,
            windowSeconds,
            enabled
        );
    }

    function setAllowedTarget(address agent, address target, bool allowed) external onlyOwner {
        _mandates[agent].allowedTargets[target] = allowed;
        emit TargetAllowed(agent, target, allowed);
    }

    function setAllowedSelector(address agent, address target, bytes4 selector, bool allowed)
        external
        onlyOwner
    {
        _mandates[agent].allowedSelectors[target][selector] = allowed;
        emit SelectorAllowed(agent, target, selector, allowed);
    }

    /// @notice Kill switch for one agent. Any later call from that agent reverts.
    function revokeAgent(address agent) external onlyOwner {
        _mandates[agent].active = false;
        emit AgentRevoked(agent);
    }

    /// @notice Kill switch for every agent at once.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Owner: direct control of the funds (not subject to any mandate)
    // ---------------------------------------------------------------------

    function ownerExecute(address to, uint256 value, bytes calldata data)
        external
        nonReentrant
        onlyOwner
        returns (bytes memory)
    {
        if (to == address(0)) revert ZeroAddress();
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) revert CallFailed(ret);
        emit OwnerExecuted(to, value, data);
        return ret;
    }

    function withdraw(address token, address to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdrawn(token, to, amount);
    }

    // ---------------------------------------------------------------------
    // Agent: execution paths
    // ---------------------------------------------------------------------

    /// @notice Tier 1. Executes an intent inside the autonomous caps and allowlists.
    /// @param i The intent, signed by the agent.
    /// @param data Calldata for CALL intents (its keccak256 must equal i.dataHash); empty otherwise.
    /// @param agentSig EIP-712 signature over the intent by msg.sender.
    function execute(Intent calldata i, bytes calldata data, bytes calldata agentSig)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 ih)
    {
        return _execute(i, data, agentSig, false, 0, msg.data[0:0]);
    }

    /// @notice Tier 2. Executes an intent above the autonomous caps or to a target
    ///         outside the allowlist, with an owner approval bound to this exact
    ///         intent hash and a deadline. Each approval can be used once.
    function executeWithApproval(
        Intent calldata i,
        bytes calldata data,
        bytes calldata agentSig,
        uint256 approvalDeadline,
        bytes calldata ownerSig
    ) external nonReentrant whenNotPaused returns (bytes32 ih) {
        return _execute(i, data, agentSig, true, approvalDeadline, ownerSig);
    }

    function _execute(
        Intent calldata i,
        bytes calldata data,
        bytes calldata agentSig,
        bool coSign,
        uint256 approvalDeadline,
        bytes calldata ownerSig
    ) internal returns (bytes32 ih) {
        AgentMandate storage m = _mandates[msg.sender];
        ih = _checkAgent(m, i, agentSig);
        AssetMandate storage a = _checkShape(m, i, data, coSign);
        uint8 tier = _account(a, i, ih, coSign, approvalDeadline, ownerSig);
        // Effects before interactions
        m.nextNonce = i.nonce + 1;
        _interact(i, data);
        _emitExecuted(ih, i, tier);
    }

    function _emitExecuted(bytes32 ih, Intent calldata i, uint8 tier) internal {
        emit IntentExecuted(msg.sender, ih, i.kind, i.target, i.token, i.amount, tier);
    }

    /// @dev Checks 1 and 2: agent and time bounds, nonce, and the agent signature.
    function _checkAgent(AgentMandate storage m, Intent calldata i, bytes calldata agentSig)
        internal
        view
        returns (bytes32 ih)
    {
        if (!m.active) revert AgentNotActive();
        if (block.timestamp > m.expiry) revert MandateExpired();
        if (block.timestamp > i.deadline) revert IntentExpired();
        if (i.nonce != m.nextNonce) revert BadNonce(m.nextNonce, i.nonce);
        ih = intentHash(i);
        if (ECDSA.recover(ih, agentSig) != msg.sender) revert BadAgentSignature();
    }

    /// @dev Check 3: kind, token, calldata and allowlist consistency. Returns the asset mandate.
    function _checkShape(
        AgentMandate storage m,
        Intent calldata i,
        bytes calldata data,
        bool coSign
    ) internal view returns (AssetMandate storage a) {
        bool isCall = i.kind == KIND_CALL;
        bool isNativeAccounted = i.kind == KIND_TRANSFER_NATIVE || isCall;
        if (
            !isNativeAccounted && i.kind != KIND_TRANSFER_ERC20 && i.kind != KIND_APPROVE_ERC20
                && i.kind != KIND_TOPUP_PETTY_CASH
        ) revert UnknownKind(i.kind);
        if (isNativeAccounted && i.token != address(0)) revert TokenMismatch();
        if (!isNativeAccounted && i.token == address(0)) revert TokenMismatch();

        a = m.assets[i.token];
        if (!a.enabled) revert AssetNotEnabled(i.token);

        if (i.kind == KIND_TOPUP_PETTY_CASH && i.target != msg.sender) {
            revert PettyCashTargetNotAgent();
        }
        if (i.kind == KIND_APPROVE_ERC20 && i.amount == type(uint256).max) {
            revert UnlimitedApproval();
        }

        if (isCall) {
            if (data.length < 4 || keccak256(data) != i.dataHash) revert CalldataMismatch();
            bytes4 selector = bytes4(data[:4]);
            // Selector allowlists are per target, so an allowed selector implies the target.
            if (!m.allowedSelectors[i.target][selector]) {
                revert SelectorNotAllowed(i.target, selector);
            }
        } else {
            if (data.length != 0 || i.dataHash != bytes32(0)) revert CalldataMismatch();
            if (!coSign && !m.allowedTargets[i.target]) revert TargetNotAllowed(i.target);
        }
    }

    /// @dev Check 4 and the spend effect: caps, window roll, and for Tier 2 the owner approval.
    function _account(
        AssetMandate storage a,
        Intent calldata i,
        bytes32 ih,
        bool coSign,
        uint256 approvalDeadline,
        bytes calldata ownerSig
    ) internal returns (uint8 tier) {
        // Tier 3 ceiling first: no signature can lift it.
        if (i.amount > a.coSignPerTxCap) revert AboveCoSignCap(i.amount, a.coSignPerTxCap);

        (uint128 spent, uint64 start) =
            MandateMath.roll(a.spentInWindow, a.windowStart, a.windowSeconds, block.timestamp);
        a.windowStart = start;

        if (coSign) {
            // The owner's signature is the authority for this exact intent and amount.
            // Co-signed spend still counts toward the window: the window cap is a blast
            // radius bound on the agent, not a bound on the owner. See ADR-008.
            if (block.timestamp > approvalDeadline) revert ApprovalExpired();
            if (consumedApprovals[ih]) revert ApprovalConsumed(ih);
            if (!SignatureChecker.isValidSignatureNow(
                    owner(), approvalHash(ih, approvalDeadline), ownerSig
                )) {
                revert BadOwnerSignature();
            }
            consumedApprovals[ih] = true;
            tier = TIER_COSIGN;
        } else {
            if (i.amount > a.autonomousPerTxCap) {
                revert AbovePerTxCap(i.amount, a.autonomousPerTxCap);
            }
            if (uint256(spent) + i.amount > a.autonomousWindowCap) {
                revert AboveWindowCap(spent, i.amount, a.autonomousWindowCap);
            }
            tier = TIER_AUTONOMOUS;
        }
        // casting to uint128 is safe: i.amount <= coSignPerTxCap, which is a uint128
        // forge-lint: disable-next-line(unsafe-typecast)
        a.spentInWindow = spent + uint128(i.amount);
    }

    /// @dev Step 6: the only place value leaves the vault on the agent's behalf.
    function _interact(Intent calldata i, bytes calldata data) internal {
        if (i.kind == KIND_TRANSFER_NATIVE) {
            (bool ok,) = payable(i.target).call{value: i.amount}("");
            if (!ok) revert NativeTransferFailed();
        } else if (i.kind == KIND_TRANSFER_ERC20 || i.kind == KIND_TOPUP_PETTY_CASH) {
            IERC20(i.token).safeTransfer(i.target, i.amount);
        } else if (i.kind == KIND_APPROVE_ERC20) {
            IERC20(i.token).forceApprove(i.target, i.amount);
        } else {
            (bool ok, bytes memory ret) = i.target.call{value: i.amount}(data);
            if (!ok) revert CallFailed(ret);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function intentHash(Intent calldata i) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INTENT_TYPEHASH,
                    i.kind,
                    i.target,
                    i.token,
                    i.amount,
                    i.dataHash,
                    i.nonce,
                    i.deadline,
                    i.rationaleHash
                )
            )
        );
    }

    function approvalHash(bytes32 ih, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(APPROVAL_TYPEHASH, ih, deadline)));
    }

    /// @notice ERC-1271: a signature over `hash` is valid for this vault when it was made by the
    ///         owner. This lets registries such as ERC-8004 bind the vault as the agent's wallet
    ///         with the owner's consent, while the agent key can never speak for the vault. [ERC-1271]
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        override
        returns (bytes4)
    {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == owner()) {
            return IERC1271.isValidSignature.selector;
        }
        return bytes4(0);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getAgent(address agent)
        external
        view
        returns (bool active, uint64 expiry, uint256 nextNonce)
    {
        AgentMandate storage m = _mandates[agent];
        return (m.active, m.expiry, m.nextNonce);
    }

    function getAssetMandate(address agent, address token)
        external
        view
        returns (AssetMandate memory)
    {
        return _mandates[agent].assets[token];
    }

    function isTargetAllowed(address agent, address target) external view returns (bool) {
        return _mandates[agent].allowedTargets[target];
    }

    function isSelectorAllowed(address agent, address target, bytes4 selector)
        external
        view
        returns (bool)
    {
        return _mandates[agent].allowedSelectors[target][selector];
    }

    /// @notice Previews the tier this contract would assign to an intent right now,
    ///         without signatures. 1 = execute() would pass the mandate checks,
    ///         2 = executeWithApproval() would, 3 = neither path exists.
    /// @dev Reason strings are the names of the errors the execution path would raise,
    ///      so the dashboard and the off-chain policy engine speak the same language.
    function classify(address agent, Intent calldata i, bytes calldata data)
        external
        view
        returns (uint8 tier, string memory reason)
    {
        AgentMandate storage m = _mandates[agent];
        if (paused()) return (TIER_FORBIDDEN, "EnforcedPause");
        if (!m.active) return (TIER_FORBIDDEN, "AgentNotActive");
        if (block.timestamp > m.expiry) return (TIER_FORBIDDEN, "MandateExpired");
        if (block.timestamp > i.deadline) return (TIER_FORBIDDEN, "IntentExpired");
        if (i.nonce != m.nextNonce) return (TIER_FORBIDDEN, "BadNonce");

        bool isCall = i.kind == KIND_CALL;
        bool isNativeAccounted = i.kind == KIND_TRANSFER_NATIVE || isCall;
        if (
            !isNativeAccounted && i.kind != KIND_TRANSFER_ERC20 && i.kind != KIND_APPROVE_ERC20
                && i.kind != KIND_TOPUP_PETTY_CASH
        ) return (TIER_FORBIDDEN, "UnknownKind");
        if (isNativeAccounted && i.token != address(0)) return (TIER_FORBIDDEN, "TokenMismatch");
        if (!isNativeAccounted && i.token == address(0)) return (TIER_FORBIDDEN, "TokenMismatch");

        AssetMandate storage a = m.assets[i.token];
        if (!a.enabled) return (TIER_FORBIDDEN, "AssetNotEnabled");
        if (i.kind == KIND_TOPUP_PETTY_CASH && i.target != agent) {
            return (TIER_FORBIDDEN, "PettyCashTargetNotAgent");
        }
        if (i.kind == KIND_APPROVE_ERC20 && i.amount == type(uint256).max) {
            return (TIER_FORBIDDEN, "UnlimitedApproval");
        }

        bool targetAllowed = m.allowedTargets[i.target];
        if (isCall) {
            if (data.length < 4) return (TIER_FORBIDDEN, "CalldataMissing");
            if (keccak256(data) != i.dataHash) return (TIER_FORBIDDEN, "CalldataMismatch");
            if (!m.allowedSelectors[i.target][bytes4(data[:4])]) {
                return (TIER_FORBIDDEN, "SelectorNotAllowed");
            }
            targetAllowed = true;
        }
        if (i.amount > a.coSignPerTxCap) return (TIER_FORBIDDEN, "AboveCoSignCap");

        if (!targetAllowed) return (TIER_COSIGN, "TargetNotAllowed");
        if (i.amount > a.autonomousPerTxCap) return (TIER_COSIGN, "AbovePerTxCap");
        (uint128 spent,) =
            MandateMath.roll(a.spentInWindow, a.windowStart, a.windowSeconds, block.timestamp);
        if (uint256(spent) + i.amount > a.autonomousWindowCap) {
            return (TIER_COSIGN, "AboveWindowCap");
        }
        return (TIER_AUTONOMOUS, "WithinMandate");
    }
}
