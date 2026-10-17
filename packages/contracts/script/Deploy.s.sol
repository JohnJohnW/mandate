// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys MandateVault and, on local chains, mock tokens. Sets the initial
///         mandate for the agent and funds the vault with a little ETH and USDC.
/// @dev Environment: OWNER_PRIVATE_KEY (broadcaster and owner), AGENT_ADDRESS,
///      USDC_ADDRESS and WETH_ADDRESS (absent on Anvil, so mocks are deployed),
///      DEMO_CONTACT (an allowlisted contact), VAULT_FUNDING_WEI, VAULT_USDC_FUNDING.
///      Caps are deliberately tiny so a faucet balance covers the whole evidence run.
contract Deploy is Script {
    uint128 constant ETH_PER_TX = 0.0002 ether;
    uint128 constant ETH_WINDOW = 0.001 ether;
    uint128 constant ETH_COSIGN = 0.005 ether;
    uint128 constant USDC_PER_TX = 1_000_000; // 1 USDC
    uint128 constant USDC_WINDOW = 5_000_000;
    uint128 constant USDC_COSIGN = 50_000_000;

    function run() external {
        uint256 ownerPk = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(ownerPk);
        address agent = vm.envAddress("AGENT_ADDRESS");
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        address weth = vm.envOr("WETH_ADDRESS", address(0));
        address contact =
            vm.envOr("DEMO_CONTACT", address(0x1234567890AbcdEF1234567890aBcdef12345678));
        uint256 vaultFunding = vm.envOr("VAULT_FUNDING_WEI", uint256(0.003 ether));
        uint256 usdcFunding = vm.envOr("VAULT_USDC_FUNDING", uint256(10_000_000));

        vm.startBroadcast(ownerPk);

        if (usdc == address(0)) {
            usdc = address(new MockERC20("Mock USD Coin", "USDC", 6));
            MockERC20(usdc).mint(owner, 1_000_000_000_000);
            console.log("MockERC20 (USDC) deployed:", usdc);
        }
        if (weth == address(0)) {
            weth = address(new MockWETH());
            console.log("MockWETH deployed:", weth);
        }

        MandateVault vault = new MandateVault(owner);
        console.log("MandateVault deployed:", address(vault));

        vault.setAgent(agent, uint64(block.timestamp + 7 days), true);
        vault.setAssetMandate(agent, address(0), ETH_PER_TX, ETH_WINDOW, ETH_COSIGN, 86400, true);
        vault.setAssetMandate(agent, usdc, USDC_PER_TX, USDC_WINDOW, USDC_COSIGN, 86400, true);
        vault.setAllowedTarget(agent, contact, true);
        vault.setAllowedTarget(agent, agent, true); // petty cash top-ups
        vault.setAllowedSelector(agent, weth, bytes4(keccak256("deposit()")), true);

        if (vaultFunding > 0) {
            (bool ok,) = address(vault).call{value: vaultFunding}("");
            require(ok, "funding failed");
        }
        uint256 ownerUsdc = IERC20(usdc).balanceOf(owner);
        if (ownerUsdc < usdcFunding) usdcFunding = ownerUsdc;
        if (usdcFunding > 0) IERC20(usdc).transfer(address(vault), usdcFunding);
        else console.log("owner holds no USDC; vault not funded with USDC");

        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "vault", address(vault));
        vm.serializeAddress(json, "owner", owner);
        vm.serializeAddress(json, "agent", agent);
        vm.serializeAddress(json, "usdc", usdc);
        vm.serializeAddress(json, "weth", weth);
        vm.serializeAddress(json, "contact", contact);
        vm.serializeUint(json, "deployedAt", block.timestamp);
        string memory out = vm.serializeUint(json, "deployBlock", block.number);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console.log("wrote", path);
    }
}
