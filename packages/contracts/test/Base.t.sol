// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockWETH} from "../src/MockWETH.sol";

/// @notice Shared fixture: an owner, an agent, a contact, a stranger, a funded vault
///         and a mandate that mirrors packages/core/test/helpers.ts.
abstract contract BaseTest is Test {
    MandateVault internal vault;
    MockERC20 internal usdc;
    MockWETH internal weth;

    uint256 internal ownerPk = 0xA11CE;
    uint256 internal agentPk = 0xB0B;
    uint256 internal strangerPk = 0xC0FFEE;
    address internal owner;
    address internal agent;
    address internal stranger;
    address internal alice = address(0x1234567890AbcdEF1234567890aBcdef12345678);

    uint128 internal constant ETH_PER_TX = 0.01 ether;
    uint128 internal constant ETH_WINDOW = 0.05 ether;
    uint128 internal constant ETH_COSIGN = 1 ether;
    uint128 internal constant USDC_PER_TX = 5_000_000; // 5 USDC
    uint128 internal constant USDC_WINDOW = 20_000_000;
    uint128 internal constant USDC_COSIGN = 1_000_000_000;
    uint32 internal constant WINDOW = 86400;

    bytes internal constant NO_DATA = "";

    function setUp() public virtual {
        owner = vm.addr(ownerPk);
        agent = vm.addr(agentPk);
        stranger = vm.addr(strangerPk);
        vm.warp(1_800_000_000);
        vm.roll(5000);

        vault = new MandateVault(owner);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockWETH();

        vm.deal(address(vault), 10 ether);
        usdc.mint(address(vault), 1_000_000_000);
        vm.deal(agent, 1 ether);
        vm.deal(stranger, 1 ether);

        vm.startPrank(owner);
        vault.setAgent(agent, uint64(block.timestamp + 7 days), true);
        vault.setAssetMandate(agent, address(0), ETH_PER_TX, ETH_WINDOW, ETH_COSIGN, WINDOW, true);
        vault.setAssetMandate(
            agent, address(usdc), USDC_PER_TX, USDC_WINDOW, USDC_COSIGN, WINDOW, true
        );
        vault.setAllowedTarget(agent, alice, true);
        vault.setAllowedTarget(agent, agent, true);
        vault.setAllowedSelector(agent, address(weth), MockWETH.deposit.selector, true);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    function _intent(bytes32 kind, address target, address token, uint256 amount, bytes32 dataHash)
        internal
        view
        returns (MandateVault.Intent memory i)
    {
        (,, uint256 nonce) = vault.getAgent(agent);
        i = MandateVault.Intent({
            kind: kind,
            target: target,
            token: token,
            amount: amount,
            dataHash: dataHash,
            nonce: nonce,
            deadline: block.timestamp + 600,
            rationaleHash: keccak256("test rationale")
        });
    }

    function _nativeTo(address target, uint256 amount)
        internal
        view
        returns (MandateVault.Intent memory)
    {
        return _intent(vault.KIND_TRANSFER_NATIVE(), target, address(0), amount, bytes32(0));
    }

    function _usdcTo(address target, uint256 amount)
        internal
        view
        returns (MandateVault.Intent memory)
    {
        return _intent(vault.KIND_TRANSFER_ERC20(), target, address(usdc), amount, bytes32(0));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _agentSig(MandateVault.Intent memory i) internal view returns (bytes memory) {
        return _sign(agentPk, vault.intentHash(i));
    }

    function _ownerSig(MandateVault.Intent memory i, uint256 approvalDeadline)
        internal
        view
        returns (bytes memory)
    {
        return _sign(ownerPk, vault.approvalHash(vault.intentHash(i), approvalDeadline));
    }

    // Signatures are computed before the prank: the signing helpers make view calls to the vault,
    // and a view call would otherwise consume the single-call prank.
    function _exec(MandateVault.Intent memory i) internal returns (bytes32) {
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        return vault.execute(i, NO_DATA, sig);
    }

    function _execData(MandateVault.Intent memory i, bytes memory data) internal returns (bytes32) {
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        return vault.execute(i, data, sig);
    }

    function _execApproved(MandateVault.Intent memory i, uint256 approvalDeadline)
        internal
        returns (bytes32)
    {
        bytes memory os = _ownerSig(i, approvalDeadline);
        bytes memory sig = _agentSig(i);
        vm.prank(agent);
        return vault.executeWithApproval(i, NO_DATA, sig, approvalDeadline, os);
    }
}
