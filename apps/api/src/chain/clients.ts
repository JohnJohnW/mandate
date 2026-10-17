import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { anvil, baseSepolia, sepolia } from "viem/chains";
import type { Config } from "../config.js";

export interface Clients {
  chain: Chain;
  publicClient: PublicClient;
  agent: PrivateKeyAccount;
  agentClient: WalletClient;
  owner: PrivateKeyAccount | undefined;
  ownerClient: WalletClient | undefined;
}

export function chainFor(cfg: Config): Chain {
  const base = cfg.chainId === 84532 ? baseSepolia : cfg.chainId === 11155111 ? sepolia : anvil;
  return defineChain({ ...base, rpcUrls: { default: { http: [cfg.rpcUrl] } } });
}

export function createClients(cfg: Config): Clients {
  const chain = chainFor(cfg);
  const transport = http(cfg.rpcUrl);
  const agent = privateKeyToAccount(cfg.agentPrivateKey);
  const owner = cfg.ownerPrivateKey ? privateKeyToAccount(cfg.ownerPrivateKey) : undefined;
  return {
    chain,
    publicClient: createPublicClient({ chain, transport }),
    agent,
    agentClient: createWalletClient({ chain, transport, account: agent }),
    owner,
    ownerClient: owner ? createWalletClient({ chain, transport, account: owner }) : undefined,
  };
}
