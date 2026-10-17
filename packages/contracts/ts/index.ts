/**
 * TypeScript entry point for the contracts package: the vault ABI (regenerated
 * from the compiled artifact by `pnpm --filter @mandate/contracts abi`) and the
 * recorded deployments.
 */
import mandateVaultAbi from "./abi/MandateVault.json" with { type: "json" };
import mockErc20Abi from "./abi/MockERC20.json" with { type: "json" };
import mockWethAbi from "./abi/MockWETH.json" with { type: "json" };

export const MANDATE_VAULT_ABI = mandateVaultAbi;
export const MOCK_ERC20_ABI = mockErc20Abi;
export const MOCK_WETH_ABI = mockWethAbi;

export interface Deployment {
  chainId: number;
  vault: `0x${string}`;
  owner: `0x${string}`;
  agent: `0x${string}`;
  usdc: `0x${string}`;
  weth: `0x${string}`;
  contact: `0x${string}`;
  deployedAt: number;
  deployBlock: number;
}

export async function loadDeployment(chainId: number): Promise<Deployment | undefined> {
  try {
    const mod = (await import(`../deployments/${chainId}.json`, { with: { type: "json" } })) as {
      default: Deployment;
    };
    return mod.default;
  } catch {
    return undefined;
  }
}

export const EXPLORERS: Record<
  number,
  { name: string; tx: (h: string) => string; address: (a: string) => string }
> = {
  84532: {
    name: "Basescan (Base Sepolia)",
    tx: (h) => `https://sepolia.basescan.org/tx/${h}`,
    address: (a) => `https://sepolia.basescan.org/address/${a}`,
  },
  11155111: {
    name: "Etherscan (Sepolia)",
    tx: (h) => `https://sepolia.etherscan.io/tx/${h}`,
    address: (a) => `https://sepolia.etherscan.io/address/${a}`,
  },
  31337: { name: "Anvil (local)", tx: (h) => h, address: (a) => a },
};
