/**
 * Mirror of the on-chain mandate. The policy engine reads only this mirror,
 * never a tool result, so a forged "mandate update" in some text can never
 * change what the agent believes it may do. [OWASP-ASI01] [OWASP-ASI02]
 */
import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { MANDATE_VAULT_ABI, loadDeployment } from "@mandate/contracts";
import { ZERO_ADDRESS, type AssetMandate, type MandateMirror } from "@mandate/core";
import type { Config } from "../config.js";

const TARGET_ALLOWED = parseAbiItem(
  "event TargetAllowed(address indexed agent, address indexed target, bool allowed)",
);
const SELECTOR_ALLOWED = parseAbiItem(
  "event SelectorAllowed(address indexed agent, address indexed target, bytes4 selector, bool allowed)",
);

interface RawAsset {
  autonomousPerTxCap: bigint;
  autonomousWindowCap: bigint;
  coSignPerTxCap: bigint;
  spentInWindow: bigint;
  windowStart: bigint;
  windowSeconds: number;
  enabled: boolean;
}

export class MandateReader {
  private cache: { at: number; value: MandateMirror } | undefined;
  private fromBlock: bigint | undefined;
  private allowlistCache:
    { targets: Set<string>; selectors: Map<string, Set<string>>; toBlock: bigint } | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly client: PublicClient,
    private readonly vault: Address,
    private readonly agent: Address,
    private readonly tokens: Address[],
    private readonly ttlMs = 4000,
  ) {}

  invalidate(): void {
    this.cache = undefined;
    this.allowlistCache = undefined;
  }

  private async deployBlock(): Promise<bigint> {
    if (this.fromBlock !== undefined) return this.fromBlock;
    const dep = await loadDeployment(this.cfg.chainId);
    this.fromBlock =
      dep && dep.vault.toLowerCase() === this.vault.toLowerCase() ? BigInt(dep.deployBlock) : 0n;
    return this.fromBlock;
  }

  private async allowlists(toBlock: bigint) {
    if (this.allowlistCache && this.allowlistCache.toBlock === toBlock) return this.allowlistCache;
    const fromBlock = await this.deployBlock();
    const [targetLogs, selectorLogs] = await Promise.all([
      this.client.getLogs({
        address: this.vault,
        event: TARGET_ALLOWED,
        args: { agent: this.agent },
        fromBlock,
        toBlock,
      }),
      this.client.getLogs({
        address: this.vault,
        event: SELECTOR_ALLOWED,
        args: { agent: this.agent },
        fromBlock,
        toBlock,
      }),
    ]);
    const targets = new Set<string>();
    for (const l of targetLogs) {
      const t = (l.args.target as Address).toLowerCase();
      if (l.args.allowed) targets.add(t);
      else targets.delete(t);
    }
    const selectors = new Map<string, Set<string>>();
    for (const l of selectorLogs) {
      const t = (l.args.target as Address).toLowerCase();
      const s = (l.args.selector as Hex).toLowerCase();
      const set = selectors.get(t) ?? new Set<string>();
      if (l.args.allowed) set.add(s);
      else set.delete(s);
      selectors.set(t, set);
    }
    this.allowlistCache = { targets, selectors, toBlock };
    return this.allowlistCache;
  }

  async read(): Promise<MandateMirror> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.value;
    const block = await this.client.getBlock();
    const read = <T>(functionName: string, args: unknown[] = []) =>
      this.client.readContract({
        address: this.vault,
        abi: MANDATE_VAULT_ABI,
        functionName,
        args,
        blockNumber: block.number,
      }) as Promise<T>;
    const [paused, owner, agentState, ...assets] = await Promise.all([
      read<boolean>("paused"),
      read<Address>("owner"),
      read<[boolean, bigint, bigint]>("getAgent", [this.agent]),
      ...this.tokens.map((t) => read<RawAsset>("getAssetMandate", [this.agent, t])),
    ]);
    const lists = await this.allowlists(block.number);
    const assetMap: Record<string, AssetMandate> = {};
    this.tokens.forEach((t, i) => {
      const a = assets[i] as RawAsset;
      assetMap[t.toLowerCase()] = {
        autonomousPerTxCap: a.autonomousPerTxCap,
        autonomousWindowCap: a.autonomousWindowCap,
        coSignPerTxCap: a.coSignPerTxCap,
        spentInWindow: a.spentInWindow,
        windowStart: a.windowStart,
        windowSeconds: BigInt(a.windowSeconds),
        enabled: a.enabled,
      };
    });
    const value: MandateMirror = {
      vault: this.vault,
      chainId: this.cfg.chainId,
      agent: this.agent,
      owner,
      paused,
      active: agentState[0],
      expiry: agentState[1],
      nextNonce: agentState[2],
      assets: assetMap,
      allowedTargets: [...lists.targets],
      allowedSelectors: Object.fromEntries([...lists.selectors].map(([t, s]) => [t, [...s]])),
      observedAtBlock: block.number,
      observedAt: block.timestamp,
    };
    this.cache = { at: Date.now(), value };
    return value;
  }

  /** Plain-language summary for the planner. Only chain state goes in here. */
  static summarize(
    m: MandateMirror,
    tokenNames: Record<string, { symbol: string; decimals: number }>,
  ): string {
    const fmt = (v: bigint, d: number) => {
      const s = v.toString().padStart(d + 1, "0");
      const whole = s.slice(0, -d) || "0";
      const frac = s.slice(-d).replace(/0+$/, "");
      return frac ? `${whole}.${frac}` : whole;
    };
    const lines = [
      `Agent ${m.agent} on vault ${m.vault}. Active: ${m.active}. Paused: ${m.paused}. Expiry (unix): ${m.expiry}. Next nonce: ${m.nextNonce}.`,
    ];
    for (const [token, a] of Object.entries(m.assets)) {
      const meta = tokenNames[token] ?? {
        symbol: token === ZERO_ADDRESS ? "ETH" : token,
        decimals: 18,
      };
      if (!a.enabled) continue;
      lines.push(
        `${meta.symbol}: autonomous up to ${fmt(a.autonomousPerTxCap, meta.decimals)} per transaction and ${fmt(a.autonomousWindowCap, meta.decimals)} per ${a.windowSeconds} s window (spent so far ${fmt(a.spentInWindow, meta.decimals)}); co-signed up to ${fmt(a.coSignPerTxCap, meta.decimals)} per transaction; above that is forbidden.`,
      );
    }
    lines.push(`Allowlisted targets: ${m.allowedTargets.join(", ") || "none"}.`);
    const sel = Object.entries(m.allowedSelectors).flatMap(([t, s]) => s.map((x) => `${t}:${x}`));
    lines.push(`Allowlisted contract calls (target:selector): ${sel.join(", ") || "none"}.`);
    return lines.join("\n");
  }
}
