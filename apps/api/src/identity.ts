/**
 * ERC-8004 identity. Our agent is registered in the Identity Registry and its
 * wallet metadata points at the vault (bound with the owner's ERC-1271
 * signature). Before paying a counterparty we check that its agent card and
 * the registry agree on the wallet we are about to pay. [ERC-8004]
 * [NCCOE-AGENT-ID] [NIST-AGENT-INIT]
 */
import { existsSync, readFileSync } from "node:fs";
import { getAddress, type Address } from "viem";
import { IDENTITY_REGISTRY_ABI } from "@mandate/contracts";
import type { Clients } from "./chain/clients.js";
import { ROOT, type Config } from "./config.js";

export interface IdentityRecord {
  chainId: number;
  registry: Address;
  agent: {
    agentId: string;
    owner: Address;
    agentURI: string;
    registerTx: string;
    setWalletTx: string | null;
  };
  oracle?: { agentId: string; owner: Address; agentURI: string; registerTx: string };
}

export interface AgentCardView {
  agentId: string | null;
  owner: Address | null;
  wallet: Address | null;
  agentURI: string | null;
  registry: Address | null;
  onChain: boolean;
  detail: string;
}

export class Identity {
  readonly record: IdentityRecord | undefined;
  readonly registry: Address | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly clients: Clients,
  ) {
    const p = `${ROOT}packages/contracts/deployments/identity-${cfg.chainId}.json`;
    this.record = existsSync(p)
      ? (JSON.parse(readFileSync(p, "utf8")) as IdentityRecord)
      : undefined;
    const envReg =
      cfg.chainId === 31337 ? process.env.ANVIL_ERC8004_IDENTITY_REGISTRY : cfg.erc8004.identity;
    this.registry = this.record?.registry ?? (envReg ? getAddress(envReg) : undefined);
  }

  private async read<T>(functionName: string, args: unknown[]): Promise<T | undefined> {
    if (!this.registry) return undefined;
    try {
      return (await this.clients.publicClient.readContract({
        address: this.registry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName,
        args,
      })) as T;
    } catch {
      return undefined;
    }
  }

  async card(agentId: string | undefined): Promise<AgentCardView> {
    if (!this.registry)
      return {
        agentId: null,
        owner: null,
        wallet: null,
        agentURI: null,
        registry: null,
        onChain: false,
        detail: "no identity registry configured for this chain",
      };
    if (agentId === undefined)
      return {
        agentId: null,
        owner: null,
        wallet: null,
        agentURI: null,
        registry: this.registry,
        onChain: false,
        detail: "not registered yet (run the identity registration script)",
      };
    const id = BigInt(agentId);
    const [owner, wallet, uri] = await Promise.all([
      this.read<Address>("ownerOf", [id]),
      this.read<Address>("getAgentWallet", [id]),
      this.read<string>("tokenURI", [id]),
    ]);
    return {
      agentId,
      owner: owner ?? null,
      wallet: wallet ?? null,
      agentURI: uri ?? null,
      registry: this.registry,
      onChain: !!owner,
      detail: owner
        ? `agent #${agentId} owned by ${owner}, wallet ${wallet}`
        : `agent #${agentId} not found on-chain`,
    };
  }

  async ourCard(): Promise<AgentCardView & { vaultBound: boolean }> {
    const c = await this.card(this.record?.agent.agentId);
    return {
      ...c,
      vaultBound:
        !!c.wallet &&
        !!this.cfg.vaultAddress &&
        c.wallet.toLowerCase() === this.cfg.vaultAddress.toLowerCase(),
    };
  }

  /** The registration JSON we serve at /.well-known/agent.json. */
  async registrationFile(): Promise<Record<string, unknown>> {
    const c = await this.ourCard();
    return {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Mandate wallet agent",
      description:
        "A policy-bound autonomous wallet agent. Holds a mandate enforced by MandateVault, not a key to the funds. Testnet demonstration.",
      image: null,
      services: [
        {
          name: "mandate-api",
          endpoint: `${process.env.API_PUBLIC_URL ?? `http://localhost:${this.cfg.apiPort}`}/openapi.json`,
          version: "0.1.0",
        },
      ],
      supportedTrust: ["reputation"],
      registrations: c.agentId
        ? [
            {
              agentId: Number(c.agentId),
              agentRegistry: `eip155:${this.cfg.chainId}:${this.registry}`,
              agentWallet: c.wallet,
            },
          ]
        : [],
      vault: this.cfg.vaultAddress,
      agentAddress: this.clients.agent.address,
      active: true,
    };
  }

  /**
   * Know Your Agent: fetch the counterparty's agent card at its origin, read the
   * agentId it claims, and confirm on-chain that the registry's wallet for that
   * id is the address we are about to pay.
   */
  async knowYourAgent(
    resourceUrl: string,
    payTo: Address,
  ): Promise<{ ok: boolean; detail: string; agentId?: string; wallet?: Address }> {
    let origin: string;
    try {
      origin = new URL(resourceUrl).origin;
    } catch {
      return { ok: false, detail: "invalid resource url" };
    }
    let card: {
      registrations?: { agentId: number; agentRegistry: string; agentWallet?: string }[];
      payTo?: string;
    };
    try {
      const res = await fetch(`${origin}/.well-known/agent.json`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return { ok: false, detail: `counterparty has no agent card (${res.status})` };
      card = (await res.json()) as typeof card;
    } catch (err) {
      return {
        ok: false,
        detail: `could not fetch the counterparty agent card: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const reg = card.registrations?.[0];
    if (!reg)
      return { ok: false, detail: "counterparty agent card carries no ERC-8004 registration" };
    const expectedRegistry = `eip155:${this.cfg.chainId}:${this.registry}`.toLowerCase();
    if (reg.agentRegistry.toLowerCase() !== expectedRegistry)
      return {
        ok: false,
        detail: `counterparty is registered in ${reg.agentRegistry}, not in ${expectedRegistry}`,
      };
    const wallet = await this.read<Address>("getAgentWallet", [BigInt(reg.agentId)]);
    if (!wallet) return { ok: false, detail: `agent #${reg.agentId} not found in the registry` };
    if (wallet.toLowerCase() !== payTo.toLowerCase())
      return {
        ok: false,
        detail: `invoice payee ${payTo} is not the registered wallet ${wallet} of agent #${reg.agentId}`,
      };
    return {
      ok: true,
      detail: `payee matches the registered wallet of ERC-8004 agent #${reg.agentId}`,
      agentId: String(reg.agentId),
      wallet,
    };
  }
}
