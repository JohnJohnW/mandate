/**
 * Runtime configuration. Reads the repository .env (never committed), applies
 * process environment overrides, and refuses to start on anything but a known
 * testnet or a local Anvil chain.
 */
import { existsSync, readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";

export const ROOT = new URL("../../../", import.meta.url).pathname;

const TESTNETS: Record<number, { name: string; explorer: string; rpc: string }> = {
  84532: {
    name: "Base Sepolia",
    explorer: "https://sepolia.basescan.org",
    rpc: "https://sepolia.base.org",
  },
  11155111: {
    name: "Ethereum Sepolia",
    explorer: "https://sepolia.etherscan.io",
    rpc: "https://rpc.sepolia.org",
  },
  31337: { name: "Anvil (local)", explorer: "", rpc: "http://127.0.0.1:8545" },
};

function loadDotEnv(): void {
  const p = `${ROOT}.env`;
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k && process.env[k] === undefined) process.env[k] = v ?? "";
  }
}

export interface Config {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  vaultAddress: Address | undefined;
  usdcAddress: Address;
  wethAddress: Address;
  agentPrivateKey: Hex;
  ownerPrivateKey: Hex | undefined;
  ownerMode: "local" | "metamask";
  ownerApprovalAuth: "passkey" | "dev";
  planner: "live" | "mock";
  llm: { baseUrl: string; apiKey: string; model: string };
  sanctionsMaxAgeDays: number;
  databasePath: string;
  auditPath: string;
  apiPort: number;
  webOrigin: string;
  oracleUrl: string;
  erc8004: { identity: Address; reputation: Address };
  x402: { facilitatorUrl: string; network: string };
  rpId: string;
  rpOrigin: string;
}

function addr(v: string | undefined, fallback?: string): Address {
  const s = v && v.length > 0 ? v : fallback;
  if (!s) throw new Error("missing address in configuration");
  return getAddress(s);
}

export function loadConfig(): Config {
  loadDotEnv();
  const e = process.env;
  const chainId = Number(e.CHAIN_ID ?? 84532);
  const net = TESTNETS[chainId];
  if (!net)
    throw new Error(
      `refusing chain id ${chainId}: only Base Sepolia (84532), Ethereum Sepolia (11155111) and Anvil (31337) are allowed`,
    );
  const local = chainId === 31337;
  const agentPk = e.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!agentPk || !/^0x[0-9a-fA-F]{64}$/.test(agentPk))
    throw new Error("AGENT_PRIVATE_KEY is missing; run pnpm keys:generate");
  const ownerPk =
    e.OWNER_PRIVATE_KEY && /^0x[0-9a-fA-F]{64}$/.test(e.OWNER_PRIVATE_KEY)
      ? (e.OWNER_PRIVATE_KEY as Hex)
      : undefined;
  const vaultRaw = local ? e.ANVIL_VAULT_ADDRESS : e.VAULT_ADDRESS;
  const llm = {
    baseUrl: e.LLM_BASE_URL ?? "",
    apiKey: e.LLM_API_KEY ?? "",
    model: e.LLM_MODEL ?? "",
  };
  const plannerRequested = (e.PLANNER ?? "mock") as "live" | "mock";
  const planner =
    plannerRequested === "live" && llm.baseUrl && llm.apiKey && llm.model ? "live" : "mock";
  const apiPort = Number(e.API_PORT ?? 4010);
  return {
    chainId,
    chainName: net.name,
    rpcUrl: local ? net.rpc : e.RPC_URL || net.rpc,
    explorerUrl: local ? "" : e.EXPLORER_URL || net.explorer,
    vaultAddress: vaultRaw ? getAddress(vaultRaw) : undefined,
    usdcAddress: addr(
      local ? e.ANVIL_USDC_ADDRESS : e.USDC_ADDRESS,
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    ),
    wethAddress: addr(
      local ? e.ANVIL_WETH_ADDRESS : e.WETH_ADDRESS,
      "0x4200000000000000000000000000000000000006",
    ),
    agentPrivateKey: agentPk,
    ownerPrivateKey: ownerPk,
    ownerMode: (e.OWNER_MODE as "local" | "metamask") ?? "local",
    ownerApprovalAuth: (e.OWNER_APPROVAL_AUTH as "passkey" | "dev") ?? "passkey",
    planner,
    llm,
    sanctionsMaxAgeDays: Number(e.SANCTIONS_LIST_MAX_AGE_DAYS ?? 7),
    databasePath: e.DATABASE_PATH
      ? e.DATABASE_PATH.startsWith("/")
        ? e.DATABASE_PATH
        : `${ROOT}apps/api/${e.DATABASE_PATH.replace(/^\.\//, "")}`
      : `${ROOT}apps/api/data/mandate-${chainId}.db`,
    auditPath: `${ROOT}apps/api/data/audit-${chainId}.jsonl`,
    apiPort,
    webOrigin: e.WEB_ORIGIN ?? `http://localhost:${e.WEB_PORT ?? 3000}`,
    oracleUrl: e.ORACLE_URL ?? "http://localhost:4020",
    erc8004: {
      identity: addr(e.ERC8004_IDENTITY_REGISTRY, "0x8004A818BFB912233c491871b3d84c89A494BD9e"),
      reputation: addr(e.ERC8004_REPUTATION_REGISTRY, "0x8004B663056A597Dffe9eCcC1965A193B7388713"),
    },
    x402: {
      facilitatorUrl: e.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
      network: e.X402_NETWORK ?? "eip155:84532",
    },
    rpId: e.RP_ID ?? "localhost",
    rpOrigin: e.RP_ORIGIN ?? e.WEB_ORIGIN ?? `http://localhost:${e.WEB_PORT ?? 3000}`,
  };
}

export function explorerTx(cfg: Config, hash: string): string | undefined {
  return cfg.explorerUrl ? `${cfg.explorerUrl}/tx/${hash}` : undefined;
}

export function explorerAddress(cfg: Config, address: string): string | undefined {
  return cfg.explorerUrl ? `${cfg.explorerUrl}/address/${address}` : undefined;
}
