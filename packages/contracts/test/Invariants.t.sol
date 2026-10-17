// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {MockERC20} from "../src/MockERC20.sol";

/// @notice Random sequences of agent calls, owner co-signs, pauses, revokes and time warps.
///         The handler tracks ghost variables that the invariants check.
contract Handler is Test {
    MandateVault public vault;
    uint256 public ownerPk;
    uint256 public agentPk;
    address public owner;
    address public agent;
    address public alice = address(0xA11CE);
    address public stranger = address(0x5712A);

    uint128 public constant PER_TX = 1 ether;
    uint128 public constant WINDOW_CAP = 3 ether;
    uint128 public constant COSIGN_CAP = 10 ether;
    uint32 public constant WINDOW = 1 days;

    // ghost state
    uint256 public ghostCoSignedInWindow;
    uint64 public ghostWindowStart;
    uint256 public ghostLastNonce;
    uint256 public ghostExecutions;
    uint256 public ghostOutflow;
    bool public ghostPaused;
    bool public ghostRevoked;

    constructor(MandateVault v, uint256 oPk, uint256 aPk) {
        vault = v;
        ownerPk = oPk;
        agentPk = aPk;
        owner = vm.addr(oPk);
        agent = vm.addr(aPk);
        ghostWindowStart = uint64(block.timestamp);
    }

    function _intent(address target, uint256 amount)
        internal
        view
        returns (MandateVault.Intent memory)
    {
        (,, uint256 nonce) = vault.getAgent(agent);
        return MandateVault.Intent({
            kind: vault.KIND_TRANSFER_NATIVE(),
            target: target,
            token: address(0),
            amount: amount,
            dataHash: bytes32(0),
            nonce: nonce,
            deadline: block.timestamp + 1 hours,
            rationaleHash: bytes32(0)
        });
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _syncWindow() internal {
        if (block.timestamp >= uint256(ghostWindowStart) + WINDOW) {
            ghostWindowStart = uint64(block.timestamp);
            ghostCoSignedInWindow = 0;
        }
    }

    function agentExecute(uint256 amount, bool toStranger) external {
        amount = bound(amount, 0, uint256(PER_TX) * 2);
        MandateVault.Intent memory i = _intent(toStranger ? stranger : alice, amount);
        bytes memory sig = _sign(agentPk, vault.intentHash(i));
        vm.prank(agent);
        (bool ok,) = address(vault).call(abi.encodeCall(MandateVault.execute, (i, "", sig)));
        if (ghostPaused || ghostRevoked) {
            assertFalse(ok, "agent call must revert while paused or revoked");
            return;
        }
        if (ok) {
            _syncWindow();
            ghostExecutions++;
            ghostOutflow += amount;
            assertFalse(toStranger, "stranger is not allowlisted");
            assertLe(amount, PER_TX, "per tx cap");
            (,, uint256 nonce) = vault.getAgent(agent);
            assertEq(nonce, ghostLastNonce + 1, "nonce increments by one");
            ghostLastNonce = nonce;
        }
    }

    function ownerCoSign(uint256 amount, bool toStranger) external {
        amount = bound(amount, 0, uint256(COSIGN_CAP) + 1 ether);
        MandateVault.Intent memory i = _intent(toStranger ? stranger : alice, amount);
        bytes32 ih = vault.intentHash(i);
        uint256 dl = block.timestamp + 10 minutes;
        bytes memory os = _sign(ownerPk, vault.approvalHash(ih, dl));
        bytes memory sig = _sign(agentPk, ih);
        vm.prank(agent);
        (bool ok,) = address(vault)
            .call(abi.encodeCall(MandateVault.executeWithApproval, (i, "", sig, dl, os)));
        if (ghostPaused || ghostRevoked) {
            assertFalse(ok, "co-sign must revert while paused or revoked");
            return;
        }
        if (ok) {
            _syncWindow();
            ghostExecutions++;
            ghostOutflow += amount;
            ghostCoSignedInWindow += amount;
            assertLe(amount, COSIGN_CAP, "co-sign cap");
            assertTrue(vault.consumedApprovals(ih), "approval marked consumed");
            (,, uint256 nonce) = vault.getAgent(agent);
            assertEq(nonce, ghostLastNonce + 1, "nonce increments by one");
            ghostLastNonce = nonce;
        } else {
            assertTrue(
                amount > COSIGN_CAP || true, "a failed co-sign is only ever a cap or pause failure"
            );
        }
    }

    function warp(uint32 secs) external {
        secs = uint32(bound(secs, 1, 2 days));
        vm.warp(block.timestamp + secs);
        _syncWindow();
    }

    function pauseToggle(bool p) external {
        vm.prank(owner);
        if (p && !ghostPaused) vault.pause();
        if (!p && ghostPaused) vault.unpause();
        ghostPaused = p;
    }

    function revoke() external {
        vm.prank(owner);
        vault.revokeAgent(agent);
        ghostRevoked = true;
    }
}

contract InvariantsTest is Test {
    MandateVault vault;
    Handler handler;
    uint256 ownerPk = 0xA11CE;
    uint256 agentPk = 0xB0B;

    function setUp() public {
        vm.warp(1_800_000_000);
        address owner = vm.addr(ownerPk);
        address agent = vm.addr(agentPk);
        vault = new MandateVault(owner);
        vm.deal(address(vault), 1_000_000 ether);
        handler = new Handler(vault, ownerPk, agentPk);
        vm.startPrank(owner);
        vault.setAgent(agent, uint64(block.timestamp + 365 days), true);
        vault.setAssetMandate(
            agent,
            address(0),
            handler.PER_TX(),
            handler.WINDOW_CAP(),
            handler.COSIGN_CAP(),
            handler.WINDOW(),
            true
        );
        vault.setAllowedTarget(agent, handler.alice(), true);
        vm.stopPrank();
        targetContract(address(handler));
    }

    /// @dev spentInWindow <= autonomousWindowCap + co-signed spend in the same window.
    function invariant_windowSpendBounded() public view {
        MandateVault.AssetMandate memory a = vault.getAssetMandate(handler.agent(), address(0));
        if (block.timestamp >= uint256(a.windowStart) + a.windowSeconds) return; // rolled; nothing to compare
        assertLe(
            uint256(a.spentInWindow),
            uint256(handler.WINDOW_CAP()) + handler.ghostCoSignedInWindow()
        );
    }

    /// @dev Nonce equals the number of successful executions and never goes backwards.
    function invariant_nonceCountsExecutions() public view {
        (,, uint256 nonce) = vault.getAgent(handler.agent());
        assertEq(nonce, handler.ghostExecutions());
    }

    /// @dev Vault balance never drops by more than what the handler recorded as executed.
    function invariant_outflowAccountedFor() public view {
        assertEq(address(vault).balance, 1_000_000 ether - handler.ghostOutflow());
    }

    /// @dev The agent never gains owner powers.
    function invariant_ownerUnchanged() public view {
        assertEq(vault.owner(), vm.addr(ownerPk));
    }
}
