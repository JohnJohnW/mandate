/** Oracle configuration: reads the repository .env and refuses non-testnet chains. */
import { existsSync, readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";

export const ROOT = new URL("../../../", import.meta.url).pathname;

function loadDotEnv(): void {
  const p = `${ROOT}.env`;
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
  }
}

export interface OracleConfig {
  chainId: number;
  network: string; // CAIP-2
  rpcUrl: string;
  port: number;
  publicUrl: string;
  oraclePrivateKey: Hex;
  usdcAddress: Address;
  facilitatorUrl: string;
  localFacilitator: boolean;
  priceUsdc: string; // human units, for example "0.001"
  identityRegistry: Address | undefined;
  apiPublicUrl: string;
}

export function loadOracleConfig(): OracleConfig {
  loadDotEnv();
  const e = process.env;
  const chainId = Number(e.CHAIN_ID ?? 84532);
  if (![84532, 11155111, 31337].includes(chainId))
    throw new Error(`refusing chain id ${chainId}: testnets and Anvil only`);
  const local = chainId === 31337;
  const pk = e.ORACLE_PRIVATE_KEY as Hex | undefined;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk))
    throw new Error("ORACLE_PRIVATE_KEY is missing; run pnpm keys:generate");
  const usdcRaw = local
    ? e.ANVIL_USDC_ADDRESS
    : e.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  if (!usdcRaw) throw new Error("USDC address missing for this chain");
  const registryRaw = local ? e.ANVIL_ERC8004_IDENTITY_REGISTRY : e.ERC8004_IDENTITY_REGISTRY;
  const port = Number(e.ORACLE_PORT ?? 4020);
  return {
    chainId,
    network: `eip155:${chainId}`,
    rpcUrl: local ? "http://127.0.0.1:8545" : e.RPC_URL || "https://sepolia.base.org",
    port,
    publicUrl: e.ORACLE_URL ?? `http://localhost:${port}`,
    oraclePrivateKey: pk,
    usdcAddress: getAddress(usdcRaw),
    facilitatorUrl: e.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    localFacilitator: local,
    priceUsdc: e.ORACLE_PRICE_USDC ?? "0.001",
    identityRegistry: registryRaw ? getAddress(registryRaw) : undefined,
    apiPublicUrl: e.API_PUBLIC_URL ?? "http://localhost:4010",
  };
}
