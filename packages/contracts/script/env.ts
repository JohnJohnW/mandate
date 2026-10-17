/**
 * Shared environment loading for the contracts scripts. Reads the repo .env,
 * refuses non-testnet chains, and returns typed clients for owner and agent.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia, anvil } from "viem/chains";

export const ROOT = new URL("../../../", import.meta.url).pathname;
export const CONTRACTS_DIR = new URL("..", import.meta.url).pathname;
export const ENV_PATH = `${ROOT}.env`;
export const ALLOWED_CHAINS = new Set([84532, 11155111, 31337]);

export class EnvFile {
  private text: string;
  constructor(public readonly path = ENV_PATH) {
    if (!existsSync(path)) throw new Error(".env not found; run pnpm keys:generate first");
    this.text = readFileSync(path, "utf8");
  }
  get(k: string): string {
    return this.text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  }
  set(k: string, v: string): void {
    this.text = this.text.match(new RegExp(`^${k}=`, "m"))
      ? this.text.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`)
      : `${this.text}\n${k}=${v}\n`;
  }
  save(): void {
    writeFileSync(this.path, this.text, { mode: 0o600 });
  }
}

export function chainFor(chainId: number, rpcUrl: string): Chain {
  const base = chainId === 84532 ? baseSepolia : chainId === 11155111 ? sepolia : anvil;
  return defineChain({ ...base, rpcUrls: { default: { http: [rpcUrl] } } });
}

export async function connect(opts: { anvil: boolean }) {
  const env = new EnvFile();
  const rpcUrl = opts.anvil ? "http://127.0.0.1:8545" : env.get("RPC_URL");
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();
  if (!ALLOWED_CHAINS.has(chainId))
    throw new Error(`refusing chain ${chainId}: testnets and Anvil only`);
  if (!opts.anvil && String(chainId) !== env.get("CHAIN_ID")) {
    throw new Error(`RPC chain ${chainId} does not match CHAIN_ID=${env.get("CHAIN_ID")} in .env`);
  }
  const ownerPk = env.get("OWNER_PRIVATE_KEY") as Hex;
  const agentPk = env.get("AGENT_PRIVATE_KEY") as Hex;
  if (!ownerPk || !agentPk)
    throw new Error("OWNER_PRIVATE_KEY and AGENT_PRIVATE_KEY must be set in .env");
  const chain = chainFor(chainId, rpcUrl);
  const owner = privateKeyToAccount(ownerPk);
  const agent = privateKeyToAccount(agentPk);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const ownerClient = createWalletClient({ chain, transport: http(rpcUrl), account: owner });
  const agentClient = createWalletClient({ chain, transport: http(rpcUrl), account: agent });
  return { env, rpcUrl, chainId, chain, owner, agent, publicClient, ownerClient, agentClient };
}

export type Connection = Awaited<ReturnType<typeof connect>>;

export function short(a: Address | string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
