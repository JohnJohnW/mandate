// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {MandateVault} from "../src/MandateVault.sol";

contract FuzzTest is BaseTest {
    /// @dev Any amount inside the per-tx cap and the remaining window succeeds; any amount above the
    ///      per-tx cap reverts, regardless of the exact value.
    function testFuzz_perTxCapIsAHardBoundary(uint256 amount) public {
        amount = bound(amount, 0, ETH_COSIGN);
        MandateVault.Intent memory i = _nativeTo(alice, amount);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        if (amount > ETH_PER_TX) {
            vm.expectRevert(
                abi.encodeWithSelector(MandateVault.AbovePerTxCap.selector, amount, ETH_PER_TX)
            );
            vault.execute(i, NO_DATA, sig);
        } else {
            vault.execute(i, NO_DATA, sig);
            assertEq(vault.getAssetMandate(agent, address(0)).spentInWindow, amount);
        }
    }

    /// @dev Above the co-sign cap nothing works, with or without an owner signature.
    function testFuzz_coSignCapIsAbsolute(uint256 amount) public {
        amount = bound(amount, uint256(ETH_COSIGN) + 1, type(uint128).max);
        MandateVault.Intent memory i = _nativeTo(alice, amount);
        bytes memory sig = _agentSig(i);
        bytes memory os = _ownerSig(i, block.timestamp + 100);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MandateVault.AboveCoSignCap.selector, amount, ETH_COSIGN)
        );
        vault.executeWithApproval(i, NO_DATA, sig, block.timestamp + 100, os);
    }

    /// @dev The window total never exceeds the window cap through Tier 1 alone, whatever the sequence.
    function testFuzz_windowCapHoldsForAnySequence(uint8 n, uint64 seed) public {
        n = uint8(bound(n, 1, 12));
        uint256 total;
        for (uint256 k = 0; k < n; k++) {
            uint256 amount = uint256(keccak256(abi.encode(seed, k))) % (uint256(ETH_PER_TX) + 1);
            MandateVault.Intent memory i = _nativeTo(alice, amount);
            bytes memory sig = _agentSig(i);
            vm.prank(agent);
            if (total + amount > ETH_WINDOW) {
                vm.expectRevert(
                    abi.encodeWithSelector(
                        MandateVault.AboveWindowCap.selector, total, amount, ETH_WINDOW
                    )
                );
                vault.execute(i, NO_DATA, sig);
            } else {
                vault.execute(i, NO_DATA, sig);
                total += amount;
            }
            assertLe(vault.getAssetMandate(agent, address(0)).spentInWindow, ETH_WINDOW);
        }
    }

    /// @dev The window rolls exactly at windowStart + windowSeconds and not a second earlier.
    function testFuzz_windowRollsExactlyOnTime(uint32 elapsed) public {
        for (uint256 k = 0; k < 5; k++) {
            _exec(_nativeTo(alice, ETH_PER_TX)); // fills the window exactly
        }
        uint64 start = vault.getAssetMandate(agent, address(0)).windowStart;
        elapsed = uint32(bound(elapsed, 0, 2 * WINDOW));
        vm.warp(uint256(start) + elapsed);
        (uint8 tier, string memory reason) = vault.classify(agent, _nativeTo(alice, 1 wei), NO_DATA);
        if (elapsed >= WINDOW) {
            assertEq(tier, 1);
            _exec(_nativeTo(alice, 1 wei));
            assertEq(vault.getAssetMandate(agent, address(0)).windowStart, block.timestamp);
            assertEq(vault.getAssetMandate(agent, address(0)).spentInWindow, 1 wei);
        } else {
            assertEq(tier, 2);
            assertEq(reason, "AboveWindowCap");
            assertEq(vault.getAssetMandate(agent, address(0)).windowStart, start);
        }
    }

    /// @dev Expiry is a hard boundary for both paths.
    function testFuzz_expiryBoundary(uint64 skew) public {
        (, uint64 expiry,) = vault.getAgent(agent);
        skew = uint64(bound(skew, 0, 2 days));
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        i.deadline = type(uint256).max;
        bytes memory sig = _agentSig(i);
        vm.warp(uint256(expiry) - 1 days + skew);
        vm.prank(agent);
        if (block.timestamp > expiry) {
            vm.expectRevert(MandateVault.MandateExpired.selector);
        }
        vault.execute(i, NO_DATA, sig);
    }

    /// @dev Signature by any key other than the agent key is rejected.
    function testFuzz_onlyTheAgentKeySigns(uint256 pk) public {
        pk = bound(pk, 1, 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140);
        vm.assume(pk != agentPk);
        MandateVault.Intent memory i = _nativeTo(alice, 1 wei);
        bytes memory sig = _sign(pk, vault.intentHash(i));
        vm.prank(agent);
        vm.expectRevert(MandateVault.BadAgentSignature.selector);
        vault.execute(i, NO_DATA, sig);
    }
}
