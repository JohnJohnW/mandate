/**
 * Wires the runtime together and performs the startup assertions. Everything
 * fails closed: a wrong chain, a missing vault, a missing key or a stale
 * sanctions list stops the process before it can transact.
 */
import { AuditLog, MemoryAuditStore, type AuditStore } from "@mandate/core";
import { Agent } from "./agent.js";
import { FileAuditStore } from "./audit.js";
import { OwnerAuth } from "./auth.js";
import { createClients, type Clients } from "./chain/clients.js";
import { Executor } from "./chain/executor.js";
import { MandateReader } from "./chain/mandate.js";
import { Simulator } from "./chain/simulator.js";
import type { Config } from "./config.js";
import { Db } from "./db.js";
import { EventBus } from "./events.js";
import { IntentService, type TokenMeta } from "./pipeline/service.js";
import { LivePlanner } from "./planner/live.js";
import { MockPlanner } from "./planner/mock.js";
import type { Planner } from "./planner/types.js";
import { Quarantine } from "./quarantine.js";
import { ScreeningProvider } from "./screening.js";
import { Identity } from "./identity.js";
import { X402Payer } from "./x402.js";

export interface App {
  cfg: Config;
  clients: Clients;
  db: Db;
  audit: AuditLog;
  bus: EventBus;
  mandate: MandateReader;
  executor: Executor;
  simulator: Simulator;
  screening: ScreeningProvider;
  quarantine: Quarantine;
  intents: IntentService;
  agent: Agent;
  auth: OwnerAuth;
  identity: Identity;
  x402: X402Payer;
  tokens: TokenMeta[];
  startupChecks: { name: string; ok: boolean; detail: string }[];
  close(): void;
}

export interface AppOptions {
  planner?: Planner;
  db?: Db;
  auditStore?: AuditStore;
  skipChecks?: boolean;
}

export async function createApp(cfg: Config, opts: AppOptions = {}): Promise<App> {
  if (!cfg.vaultAddress)
    throw new Error(
      "no vault address configured for this chain; run pnpm contracts:deploy (or deploy:anvil)",
    );
  const clients = createClients(cfg);
  const db = opts.db ?? new Db(cfg.databasePath);
  const audit = new AuditLog(
    opts.auditStore ??
      (cfg.databasePath === ":memory:"
        ? new MemoryAuditStore()
        : new FileAuditStore(cfg.auditPath)),
  );
  const bus = new EventBus();
  const tokens: TokenMeta[] = [
    { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18 },
    { symbol: "USDC", address: cfg.usdcAddress, decimals: 6 },
    { symbol: "WETH", address: cfg.wethAddress, decimals: 18 },
  ];
  const mandate = new MandateReader(
    cfg,
    clients.publicClient,
    cfg.vaultAddress,
    clients.agent.address,
    tokens.map((t) => t.address),
  );
  const executor = new Executor(
    clients.publicClient,
    clients.agentClient,
    cfg.vaultAddress,
    cfg.chainId,
  );
  const simulator = new Simulator(
    clients.publicClient,
    cfg.vaultAddress,
    clients.agent.address,
    cfg.wethAddress,
  );
  const screening = new ScreeningProvider(cfg.sanctionsMaxAgeDays);
  const quarantine = new Quarantine(db);
  const intents = new IntentService(
    cfg,
    clients,
    db,
    audit,
    bus,
    mandate,
    executor,
    simulator,
    screening,
    tokens,
  );
  const planner =
    opts.planner ?? (cfg.planner === "live" ? new LivePlanner(cfg) : new MockPlanner());
  const identity = new Identity(cfg, clients);
  const x402 = new X402Payer(cfg, clients, db, bus, intents, screening, identity);
  const agent = new Agent(cfg, clients, db, bus, mandate, intents, quarantine, screening, planner, {
    prices: async () => {
      const r = await x402.pay(`${cfg.oracleUrl}/prices`);
      const flags = r.record.reasons
        .filter((x) => x.severity !== "info")
        .map((x) => `${x.rule}: ${x.message}`)
        .join("; ");
      if (r.record.status !== "paid")
        return {
          ok: false,
          detail: `Price request ${r.record.status}: ${flags || "no reason recorded"}`,
          data: r.record,
        };
      const prices =
        (r.body as { prices?: Record<string, { usd: number; source: string }> } | undefined)
          ?.prices ?? {};
      const lines = Object.entries(prices).map(([k, v]) => `${k}: ${v.usd} USD (${v.source})`);
      const kya =
        r.record.reasons.find((x) => x.rule === "know_your_agent")?.message ?? "payee checked";
      return {
        ok: true,
        detail:
          `Paid ${r.record.amountFormatted} to the oracle agent (${kya})${r.record.txHash ? `, settled in ${r.record.txHash}` : ""}.` +
          "\n" +
          lines.join("\n"),
        data: { record: r.record, body: r.body },
      };
    },
    identity: async () => {
      const c = await identity.ourCard();
      return {
        ok: c.onChain,
        detail: c.onChain
          ? `ERC-8004 agent #${c.agentId} in registry ${c.registry}; owner ${c.owner}; wallet ${c.wallet}${c.vaultBound ? " (the vault, bound with the owner's signature)" : " (not yet bound to the vault)"}; card ${c.agentURI}`
          : c.detail,
        data: c,
      };
    },
    counterparty: async (address, url) => {
      const r = await identity.knowYourAgent(
        url ?? `${cfg.oracleUrl}/prices`,
        address as `0x${string}`,
      );
      return { ok: r.ok, detail: r.detail, data: r };
    },
  });
  const auth = new OwnerAuth(cfg, db);

  const startupChecks = opts.skipChecks ? [] : await runStartupChecks(cfg, clients, screening);
  const failed = startupChecks.filter((c) => !c.ok);
  if (failed.length) {
    db.close();
    throw new Error(
      `startup checks failed: ${failed.map((c) => `${c.name}: ${c.detail}`).join("; ")}`,
    );
  }
  audit.append({
    actor: "system",
    event: "system.startup",
    payload: {
      chainId: cfg.chainId,
      vault: cfg.vaultAddress,
      agent: clients.agent.address,
      planner: planner.name,
      ownerMode: cfg.ownerMode,
      checks: startupChecks,
    },
  });

  return {
    cfg,
    clients,
    db,
    audit,
    bus,
    mandate,
    executor,
    simulator,
    screening,
    quarantine,
    intents,
    agent,
    auth,
    identity,
    x402,
    tokens,
    startupChecks,
    close: () => db.close(),
  };
}

export async function runStartupChecks(
  cfg: Config,
  clients: Clients,
  screening: ScreeningProvider,
) {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  try {
    const id = await clients.publicClient.getChainId();
    checks.push({
      name: "chain id",
      ok: id === cfg.chainId && [84532, 11155111, 31337].includes(id),
      detail: `RPC reports ${id}, configured ${cfg.chainId} (${cfg.chainName})`,
    });
  } catch (err) {
    checks.push({
      name: "chain id",
      ok: false,
      detail: `RPC unreachable: ${err instanceof Error ? err.message : String(err)}`,
    });
    return checks;
  }
  const code = await clients.publicClient.getCode({ address: cfg.vaultAddress! });
  checks.push({
    name: "vault code",
    ok: !!code && code !== "0x",
    detail: `${cfg.vaultAddress}: ${code && code !== "0x" ? `${(code.length - 2) / 2} bytes` : "no code"}`,
  });
  checks.push({ name: "agent key", ok: true, detail: `agent ${clients.agent.address}` });
  checks.push({
    name: "owner key",
    ok: cfg.ownerMode === "metamask" || !!clients.owner,
    detail:
      cfg.ownerMode === "metamask"
        ? "MetaMask owner mode"
        : clients.owner
          ? `local owner ${clients.owner.address}`
          : "OWNER_PRIVATE_KEY missing in local mode",
  });
  const block = await clients.publicClient.getBlock();
  const fresh = screening.freshness(block.timestamp);
  checks.push({ name: "sanctions list", ok: fresh.ok, detail: fresh.detail });
  return checks;
}
