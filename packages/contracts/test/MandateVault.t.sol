// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract MandateVaultTest is BaseTest {
    // ------------------------------------------------------------ Tier 1 success

    function test_execute_nativeTransfer_withinCaps() public {
        uint256 before = alice.balance;
        MandateVault.Intent memory i = _nativeTo(alice, 0.005 ether);
        bytes32 ih = _exec(i);
        assertEq(alice.balance, before + 0.005 ether);
        assertEq(ih, vault.intentHash(i));
        (,, uint256 nonce) = vault.getAgent(agent);
        assertEq(nonce, 1);
        assertEq(vault.getAssetMandate(agent, address(0)).spentInWindow, 0.005 ether);
    }

    function test_execute_erc20Transfer_withinCaps() public {
        _exec(_usdcTo(alice, 1_000_000));
        assertEq(usdc.balanceOf(alice), 1_000_000);
        assertEq(vault.getAssetMandate(agent, address(usdc)).spentInWindow, 1_000_000);
    }

    function test_execute_call_wethDeposit() public {
        bytes memory data = abi.encodeCall(MockWETH.deposit, ());
        MandateVault.Intent memory i =
            _intent(vault.KIND_CALL(), address(weth), address(0), 0.004 ether, keccak256(data));
        _execData(i, data);
        assertEq(weth.balanceOf(address(vault)), 0.004 ether);
        assertEq(vault.getAssetMandate(agent, address(0)).spentInWindow, 0.004 ether);
    }

    function test_execute_pettyCashTopup_toAgent() public {
        MandateVault.Intent memory i =
            _intent(vault.KIND_TOPUP_PETTY_CASH(), agent, address(usdc), 2_000_000, bytes32(0));
        _exec(i);
        assertEq(usdc.balanceOf(agent), 2_000_000);
    }

    function test_execute_boundedApproval() public {
        MandateVault.Intent memory i =
            _intent(vault.KIND_APPROVE_ERC20(), alice, address(usdc), 3_000_000, bytes32(0));
        _exec(i);
        assertEq(usdc.allowance(address(vault), alice), 3_000_000);
    }

    function test_execute_emitsIntentExecuted() public {
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes32 ih = vault.intentHash(i);
        vm.expectEmit(true, true, false, true);
        emit MandateVault.IntentExecuted(
            agent, ih, vault.KIND_TRANSFER_NATIVE(), alice, address(0), 1 wei, 1
        );
        _exec(i);
    }

    // ------------------------------------------------------------ Tier 1 reverts

    function test_revert_whenPaused() public {
        vm.prank(owner);
        vault.pause();
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_agentNotActive() public {
        vm.prank(owner);
        vault.setAgent(agent, uint64(block.timestamp + 1 days), false);
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.AgentNotActive.selector);
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_mandateExpired() public {
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        i.deadline = block.timestamp + 30 days;
        bytes memory sig = _agentSig(i);
        vm.warp(block.timestamp + 8 days);
        vm.prank(agent);
        vm.expectRevert(MandateVault.MandateExpired.selector);
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_intentExpired() public {
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        i.deadline = block.timestamp - 1;
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.IntentExpired.selector);
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_badNonce() public {
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        i.nonce = 5;
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.BadNonce.selector, 0, 5));
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_signatureFromSomeoneElse() public {
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _sign(strangerPk, vault.intentHash(i));
        vm.prank(agent);
        vm.expectRevert(MandateVault.BadAgentSignature.selector);
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_relayerSubmitsAgentSignature() public {
        // A valid agent signature submitted by another account is rejected: msg.sender must be the agent.
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _agentSig(i);
        vm.prank(stranger);
        vm.expectRevert(MandateVault.AgentNotActive.selector);
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_tamperedIntentAfterSigning() public {
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _agentSig(i);
        i.amount = 2 wei;
        vm.prank(agent);
        vm.expectRevert(MandateVault.BadAgentSignature.selector);
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_unknownKind() public {
        MandateVault.Intent memory i =
            _intent(keccak256("SELFDESTRUCT"), alice, address(0), 1 wei, bytes32(0));
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateVault.UnknownKind.selector, keccak256("SELFDESTRUCT"))
        );
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_tokenMismatch() public {
        MandateVault.Intent memory i =
            _intent(vault.KIND_TRANSFER_NATIVE(), alice, address(usdc), 1 wei, bytes32(0));
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.TokenMismatch.selector);
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_assetNotEnabled() public {
        MandateVault.Intent memory i =
            _intent(vault.KIND_TRANSFER_ERC20(), alice, address(weth), 1, bytes32(0));
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateVault.AssetNotEnabled.selector, address(weth))
        );
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_pettyCashToSomeoneElse() public {
        MandateVault.Intent memory i =
            _intent(vault.KIND_TOPUP_PETTY_CASH(), alice, address(usdc), 1, bytes32(0));
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.PettyCashTargetNotAgent.selector);
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_unlimitedApproval_bothPaths() public {
        MandateVault.Intent memory i = _intent(
            vault.KIND_APPROVE_ERC20(), alice, address(usdc), type(uint256).max, bytes32(0)
        );
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.UnlimitedApproval.selector);
        vault.execute(i, NO_DATA, sig);
        bytes memory os = _ownerSig(i, block.timestamp + 100);
        vm.prank(agent);
        vm.expectRevert(MandateVault.UnlimitedApproval.selector);
        vault.executeWithApproval(i, NO_DATA, sig, block.timestamp + 100, os);
    }

    function test_revert_targetNotAllowed() public {
        MandateVault.Intent memory i = _nativeTo(stranger, 1 wei);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.TargetNotAllowed.selector, stranger));
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_selectorNotAllowed() public {
        bytes memory data = abi.encodeCall(MockWETH.withdraw, (1));
        MandateVault.Intent memory i =
            _intent(vault.KIND_CALL(), address(weth), address(0), 0, keccak256(data));
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateVault.SelectorNotAllowed.selector, address(weth), MockWETH.withdraw.selector
            )
        );
        vault.execute(i, data, sig);
    }

    function test_revert_callToNonAllowlistedContract_evenWithAllowedSelectorElsewhere() public {
        bytes memory data = abi.encodeCall(MockWETH.deposit, ());
        MandateVault.Intent memory i =
            _intent(vault.KIND_CALL(), address(usdc), address(0), 0, keccak256(data));
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateVault.SelectorNotAllowed.selector, address(usdc), MockWETH.deposit.selector
            )
        );
        vault.execute(i, data, sig);
    }

    function test_revert_calldataDoesNotMatchHash() public {
        bytes memory data = abi.encodeCall(MockWETH.deposit, ());
        MandateVault.Intent memory i =
            _intent(vault.KIND_CALL(), address(weth), address(0), 0, keccak256("other"));
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.CalldataMismatch.selector);
        vault.execute(i, data, sig);
    }

    function test_revert_calldataOnTransfer() public {
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.CalldataMismatch.selector);
        vault.execute(i, hex"deadbeef", sig);
    }

    function test_revert_abovePerTxCap() public {
        MandateVault.Intent memory i = _nativeTo(alice, ETH_PER_TX + 1);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateVault.AbovePerTxCap.selector, ETH_PER_TX + 1, ETH_PER_TX)
        );
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_aboveCoSignCap_bothPaths() public {
        MandateVault.Intent memory i = _nativeTo(alice, ETH_COSIGN + 1);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateVault.AboveCoSignCap.selector, ETH_COSIGN + 1, ETH_COSIGN)
        );
        vault.execute(i, NO_DATA, sig);
        bytes memory os = _ownerSig(i, block.timestamp + 100);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateVault.AboveCoSignCap.selector, ETH_COSIGN + 1, ETH_COSIGN)
        );
        vault.executeWithApproval(i, NO_DATA, sig, block.timestamp + 100, os);
    }

    function test_windowCap_exhaustedByManySmallTransfers_thenRollsOver() public {
        for (uint256 k = 0; k < 5; k++) {
            _exec(_nativeTo(alice, ETH_PER_TX));
        }
        assertEq(vault.getAssetMandate(agent, address(0)).spentInWindow, ETH_WINDOW);
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateVault.AboveWindowCap.selector, ETH_WINDOW, 1, ETH_WINDOW)
        );
        vault.execute(i, NO_DATA, sig);

        vm.warp(block.timestamp + WINDOW);
        _exec(_nativeTo(alice, 1 wei));
        MandateVault.AssetMandate memory a = vault.getAssetMandate(agent, address(0));
        assertEq(a.spentInWindow, 1 wei);
        assertEq(a.windowStart, block.timestamp);
    }

    function test_revert_nativeTransferToRejectingContract() public {
        Rejecter r = new Rejecter();
        vm.prank(owner);
        vault.setAllowedTarget(agent, address(r), true);
        MandateVault.Intent memory i = _nativeTo(address(r), 1 wei);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.NativeTransferFailed.selector);
        vault.execute(i, NO_DATA, sig);
    }

    // ------------------------------------------------------------ Tier 2

    function test_approval_nonAllowlistedTarget_succeeds() public {
        MandateVault.Intent memory i = _nativeTo(stranger, 0.5 ether);
        uint256 before = stranger.balance;
        _execApproved(i, block.timestamp + 300);
        assertEq(stranger.balance, before + 0.5 ether);
        assertTrue(vault.consumedApprovals(vault.intentHash(i)));
        assertEq(vault.getAssetMandate(agent, address(0)).spentInWindow, 0.5 ether);
    }

    function test_approval_abovePerTxCap_succeeds_andCountsTowardWindow() public {
        _execApproved(_nativeTo(alice, 0.5 ether), block.timestamp + 300);
        // the window is now well above the autonomous window cap, so Tier 1 is blocked until it rolls
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateVault.AboveWindowCap.selector, 0.5 ether, 1, ETH_WINDOW)
        );
        vault.execute(i, NO_DATA, sig);
    }

    function test_revert_approval_badOwnerSignature() public {
        MandateVault.Intent memory i = _nativeTo(stranger, 0.5 ether);
        bytes memory os =
            _sign(strangerPk, vault.approvalHash(vault.intentHash(i), block.timestamp + 300));
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.BadOwnerSignature.selector);
        vault.executeWithApproval(i, NO_DATA, sig, block.timestamp + 300, os);
    }

    function test_revert_approval_expired() public {
        MandateVault.Intent memory i = _nativeTo(stranger, 0.5 ether);
        uint256 dl = block.timestamp - 1;
        bytes memory os = _ownerSig(i, dl);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.ApprovalExpired.selector);
        vault.executeWithApproval(i, NO_DATA, sig, dl, os);
    }

    function test_revert_approval_deadlineTamperedAfterSigning() public {
        MandateVault.Intent memory i = _nativeTo(stranger, 0.5 ether);
        bytes memory os = _ownerSig(i, block.timestamp + 300);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.BadOwnerSignature.selector);
        vault.executeWithApproval(i, NO_DATA, sig, block.timestamp + 3000, os);
    }

    function test_revert_approval_replayedForAnotherIntent() public {
        MandateVault.Intent memory i = _nativeTo(stranger, 0.5 ether);
        uint256 dl = block.timestamp + 300;
        bytes memory os = _ownerSig(i, dl);
        _execApproved(i, dl);
        // same owner signature, new intent (the nonce moved on so the hash differs)
        MandateVault.Intent memory j = _nativeTo(stranger, 0.5 ether);
        bytes memory sig = _agentSig(j);
        vm.prank(agent);
        vm.expectRevert(MandateVault.BadOwnerSignature.selector);
        vault.executeWithApproval(j, NO_DATA, sig, dl, os);
    }

    function test_revert_approval_consumedTwice() public {
        // Force the same intent hash twice by resetting the nonce via a fresh agent mandate is not
        // possible, so we check the consumed flag directly through a second submission attempt.
        MandateVault.Intent memory i = _nativeTo(stranger, 0.5 ether);
        uint256 dl = block.timestamp + 300;
        _execApproved(i, dl);
        bytes memory os = _ownerSig(i, dl);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.BadNonce.selector, 1, 0));
        vault.executeWithApproval(i, NO_DATA, sig, dl, os);
        assertTrue(vault.consumedApprovals(vault.intentHash(i)));
    }

    function test_approval_doesNotBypassSelectorAllowlist() public {
        bytes memory data = abi.encodeCall(MockWETH.withdraw, (1));
        MandateVault.Intent memory i =
            _intent(vault.KIND_CALL(), address(weth), address(0), 0, keccak256(data));
        bytes memory os = _ownerSig(i, block.timestamp + 300);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateVault.SelectorNotAllowed.selector, address(weth), MockWETH.withdraw.selector
            )
        );
        vault.executeWithApproval(i, data, sig, block.timestamp + 300, os);
    }

    // ------------------------------------------------------------ Kill switch

    function test_revokeAgent_thenEveryCallReverts() public {
        _exec(_nativeTo(alice, 1 wei));
        vm.prank(owner);
        vault.revokeAgent(agent);
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert(MandateVault.AgentNotActive.selector);
        vault.execute(i, NO_DATA, sig);
        bytes memory os = _ownerSig(i, block.timestamp + 300);
        vm.prank(agent);
        vm.expectRevert(MandateVault.AgentNotActive.selector);
        vault.executeWithApproval(i, NO_DATA, sig, block.timestamp + 300, os);
    }

    function test_pause_blocksBothPaths_unpauseRestores() public {
        vm.prank(owner);
        vault.pause();
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _agentSig(i);
        bytes memory os = _ownerSig(i, block.timestamp + 300);
        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.executeWithApproval(i, NO_DATA, sig, block.timestamp + 300, os);
        vm.prank(owner);
        vault.unpause();
        _exec(i);
    }

    // ------------------------------------------------------------ Owner functions

    function test_agentCannotCallOwnerFunctions() public {
        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setAgent(agent, type(uint64).max, true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setAssetMandate(
            agent, address(0), type(uint128).max, type(uint128).max, type(uint128).max, 1, true
        );
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setAllowedTarget(agent, stranger, true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setAllowedSelector(agent, address(usdc), bytes4(0), true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.revokeAgent(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.withdraw(address(0), agent, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.ownerExecute(agent, 1 ether, "");
        vm.stopPrank();
    }

    function test_agentCannotChangeItsOwnMandateThroughCall() public {
        // Even if the owner allowlisted a selector on the vault itself, the call comes from the vault
        // (msg.sender == vault, not owner), so onlyOwner rejects it.
        bytes memory data = abi.encodeCall(MandateVault.setAgent, (agent, type(uint64).max, true));
        vm.prank(owner);
        vault.setAllowedSelector(agent, address(vault), MandateVault.setAgent.selector, true);
        MandateVault.Intent memory i =
            _intent(vault.KIND_CALL(), address(vault), address(0), 0, keccak256(data));
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        vm.expectRevert();
        vault.execute(i, data, sig);
    }

    function test_ownerWithdraw_andExecute() public {
        vm.startPrank(owner);
        vault.withdraw(address(0), owner, 1 ether);
        assertEq(owner.balance, 1 ether);
        vault.withdraw(address(usdc), owner, 5);
        assertEq(usdc.balanceOf(owner), 5);
        vault.ownerExecute(address(weth), 1 ether, abi.encodeCall(MockWETH.deposit, ()));
        assertEq(weth.balanceOf(address(vault)), 1 ether);
        vm.stopPrank();
    }

    function test_setAssetMandate_keepsWindowAccounting() public {
        _exec(_nativeTo(alice, 0.005 ether));
        vm.prank(owner);
        vault.setAssetMandate(
            agent, address(0), ETH_PER_TX * 2, ETH_WINDOW, ETH_COSIGN, WINDOW, true
        );
        assertEq(vault.getAssetMandate(agent, address(0)).spentInWindow, 0.005 ether);
    }

    function test_setters_rejectZeroAddressAndZeroWindow() public {
        vm.startPrank(owner);
        vm.expectRevert(MandateVault.ZeroAddress.selector);
        vault.setAgent(address(0), 1, true);
        vm.expectRevert(MandateVault.WindowTooShort.selector);
        vault.setAssetMandate(agent, address(0), 1, 1, 1, 0, true);
        vm.stopPrank();
    }

    function test_receive_emitsDeposited() public {
        vm.expectEmit(true, false, false, true);
        emit MandateVault.Deposited(stranger, 1 wei);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 1 wei}("");
        assertTrue(ok);
    }

    // ------------------------------------------------------------ classify

    function test_classify_matchesExecutionPaths() public {
        (uint8 t, string memory r) = vault.classify(agent, _nativeTo(alice, 0.005 ether), NO_DATA);
        assertEq(t, 1);
        assertEq(r, "WithinMandate");
        (t, r) = vault.classify(agent, _nativeTo(stranger, 0.005 ether), NO_DATA);
        assertEq(t, 2);
        assertEq(r, "TargetNotAllowed");
        (t, r) = vault.classify(agent, _nativeTo(alice, 0.5 ether), NO_DATA);
        assertEq(t, 2);
        assertEq(r, "AbovePerTxCap");
        (t, r) = vault.classify(agent, _nativeTo(alice, 2 ether), NO_DATA);
        assertEq(t, 3);
        assertEq(r, "AboveCoSignCap");
        MandateVault.Intent memory bad = _nativeTo(alice, 1);
        bad.nonce = 9;
        (t, r) = vault.classify(agent, bad, NO_DATA);
        assertEq(t, 3);
        assertEq(r, "BadNonce");
        vm.prank(owner);
        vault.pause();
        (t, r) = vault.classify(agent, _nativeTo(alice, 1), NO_DATA);
        assertEq(t, 3);
        assertEq(r, "EnforcedPause");
    }
}

contract Rejecter {
    receive() external payable {
        revert("no");
    }
}
