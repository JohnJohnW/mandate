// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {MandateMath} from "../src/MandateMath.sol";

/// @notice Pins the contract to the fixtures the TypeScript core package generates,
///         so both sides agree on EIP-712 hashes and window accounting.
contract FixturesTest is Test {
    string constant EIP712_FIXTURE = "../core/fixtures/eip712.json";
    string constant WINDOW_FIXTURE = "../core/fixtures/window.json";

    function test_eip712_typeHashesMatchCore() public {
        string memory json = vm.readFile(EIP712_FIXTURE);
        MandateVault vault = new MandateVault(address(this));
        assertEq(vault.INTENT_TYPEHASH(), vm.parseJsonBytes32(json, ".intentTypeHash"));
        assertEq(vault.APPROVAL_TYPEHASH(), vm.parseJsonBytes32(json, ".approvalTypeHash"));
        assertEq(vault.KIND_TRANSFER_NATIVE(), vm.parseJsonBytes32(json, ".kinds.TRANSFER_NATIVE"));
        assertEq(vault.KIND_TRANSFER_ERC20(), vm.parseJsonBytes32(json, ".kinds.TRANSFER_ERC20"));
        assertEq(vault.KIND_CALL(), vm.parseJsonBytes32(json, ".kinds.CALL"));
        assertEq(vault.KIND_APPROVE_ERC20(), vm.parseJsonBytes32(json, ".kinds.APPROVE_ERC20"));
        assertEq(
            vault.KIND_TOPUP_PETTY_CASH(), vm.parseJsonBytes32(json, ".kinds.TOPUP_PETTY_CASH")
        );
    }

    function test_eip712_sampleDigestsMatchCore() public {
        string memory json = vm.readFile(EIP712_FIXTURE);
        uint256 chainId = vm.parseJsonUint(json, ".sample.chainId");
        address vaultAddr = vm.parseJsonAddress(json, ".sample.vault");
        vm.chainId(chainId);
        deployCodeTo("MandateVault.sol:MandateVault", abi.encode(address(this)), vaultAddr);
        MandateVault vault = MandateVault(payable(vaultAddr));

        MandateVault.Intent memory i = MandateVault.Intent({
            kind: vm.parseJsonBytes32(json, ".sample.intent.kind"),
            target: vm.parseJsonAddress(json, ".sample.intent.target"),
            token: vm.parseJsonAddress(json, ".sample.intent.token"),
            amount: vm.parseJsonUint(json, ".sample.intent.amount"),
            dataHash: vm.parseJsonBytes32(json, ".sample.intent.dataHash"),
            nonce: vm.parseJsonUint(json, ".sample.intent.nonce"),
            deadline: vm.parseJsonUint(json, ".sample.intent.deadline"),
            rationaleHash: vm.parseJsonBytes32(json, ".sample.intent.rationaleHash")
        });
        bytes32 ih = vault.intentHash(i);
        assertEq(ih, vm.parseJsonBytes32(json, ".sample.intentHash"));
        uint256 dl = vm.parseJsonUint(json, ".sample.approvalDeadline");
        assertEq(vault.approvalHash(ih, dl), vm.parseJsonBytes32(json, ".sample.approvalHash"));
    }

    struct CaseParams {
        uint128 perTx;
        uint128 windowCap;
        uint32 windowSeconds;
        uint64 start;
        uint128 spent;
    }

    function test_windowAccountingMatchesCore() public view {
        string memory json = vm.readFile(WINDOW_FIXTURE);
        for (uint256 c = 0; c < 8; c++) {
            _runCase(json, string.concat(".cases[", vm.toString(c), "]"));
        }
    }

    function _runCase(string memory json, string memory base) internal view {
        CaseParams memory p = CaseParams({
            perTx: uint128(vm.parseJsonUint(json, string.concat(base, ".autonomousPerTxCap"))),
            windowCap: uint128(vm.parseJsonUint(json, string.concat(base, ".autonomousWindowCap"))),
            windowSeconds: uint32(vm.parseJsonUint(json, string.concat(base, ".windowSeconds"))),
            start: uint64(vm.parseJsonUint(json, string.concat(base, ".initialWindowStart"))),
            spent: 0
        });
        for (uint256 k = 0; k < 24; k++) {
            _runStep(json, string.concat(base, ".steps[", vm.toString(k), "]"), p);
        }
    }

    function _runStep(string memory json, string memory sb, CaseParams memory p) internal view {
        uint256 now_ = vm.parseJsonUint(json, string.concat(sb, ".now"));
        uint256 amount = vm.parseJsonUint(json, string.concat(sb, ".amount"));
        (p.spent, p.start) = MandateMath.roll(p.spent, p.start, p.windowSeconds, now_);
        bool allowed = amount <= p.perTx && uint256(p.spent) + amount <= p.windowCap;
        assertEq(allowed, vm.parseJsonBool(json, string.concat(sb, ".allowed")), "allowed mismatch");
        if (allowed) p.spent += uint128(amount);
        assertEq(
            uint256(p.spent),
            vm.parseJsonUint(json, string.concat(sb, ".spentAfter")),
            "spent mismatch"
        );
        assertEq(
            uint256(p.start),
            vm.parseJsonUint(json, string.concat(sb, ".windowStartAfter")),
            "start mismatch"
        );
    }
}
