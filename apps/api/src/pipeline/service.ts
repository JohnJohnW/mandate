/**
 * The intent pipeline: draft -> typed intent -> policy -> simulation ->
 * execution or approval, with an audit record and a trace step for every
 * transition. State names match docs/ARCHITECTURE.md section 4.5.
 */
import { randomUUID } from "node:crypto";
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  type AuditLog,
  DEFAULT_POLICY_PARAMS,
  INTENT_KIND_HASH,
  ZERO_ADDRESS,
  buildIntent,
  evaluate,
  intentDraftSchema,
  intentHash,
  kindName,
  statusFromVerdict,
  traceStep,
  newTrace,
  type DecisionTrace,
  type Intent,
  type IntentDraft,
  type OwnerStatement,
  type PolicyContext,
  type Provenance,
  type SimulationResult,
  type TargetInfo,
  type UntrustedInput,
  type Verdict,
} from "@mandate/core";
import type { Config } from "../config.js";
import { explorerTx } from "../config.js";
import type { Clients } from "../chain/clients.js";
import type { MandateReader } from "../chain/mandate.js";
import { Executor } from "../chain/executor.js";
import type { Simulator } from "../chain/simulator.js";
import type { Db, IntentRow, IntentState } from "../db.js";
import type { EventBus } from "../events.js";
import type { ScreeningProvider } from "../screening.js";

export interface TokenMeta {
  symbol: string;
  address: Address;
  decimals: number;
}

export interface ProposeInput {
  draft: IntentDraft;
  provenance: { target: Provenance; amount: Provenance; data?: Provenance };
  untrustedInputs: UntrustedInput[];
  ownerStatement?: OwnerStatement;
  ownerMessage?: string;
  source: string;
  /** Security Lab only: send even when policy or simulation would stop it, so the chain's answer is recorded. */
  forceOnChain?: boolean;
}

export interface IntentView {
  id: string;
  state: IntentState;
  kind: string;
  target: string;
  token: string;
  tokenSymbol: string;
  amount: string;
  amountFormatted: string;
  rationale: string;
  intentHash: string | null;
  nonce: string;
  deadline: string;
  verdict: Verdict | null;
  trace: DecisionTrace | null;
  simulation: SimulationResult | null;
  txHash: string | null;
  explorerUrl: string | undefined;
  revertReason: string | null;
  createdAt: string;
  updatedAt: string;
  tier: number | null;
  approval?: { id: string; status: string; expiresAt: string } | undefined;
}

export class IntentService {
  readonly audit: AuditLog;

  constructor(
    private readonly cfg: Config,
    private readonly clients: Clients,
    private readonly db: Db,
    audit: AuditLog,
    private readonly bus: EventBus,
    private readonly mandate: MandateReader,
    private readonly executor: Executor,
    private readonly simulator: Simulator,
    private readonly screening: ScreeningProvider,
    readonly tokens: TokenMeta[],
  ) {
    this.audit = audit;
    audit.onAppend((r) => bus.emit("audit.appended", r));
  }

  // ------------------------------------------------------------------ lookups

  tokenBySymbol(symbol: string): TokenMeta | undefined {
    return this.tokens.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
  }

  tokenByAddress(address: string): TokenMeta | undefined {
    return this.tokens.find((t) => t.address.toLowerCase() === address.toLowerCase());
  }

  resolveTarget(nameOrAddress: string): { address: Address; provenance: Provenance } | undefined {
    if (isAddress(nameOrAddress, { strict: false }))
      return {
        address: getAddress(nameOrAddress),
        provenance: { source: "owner", origin: "owner message (literal address)" },
      };
    const c = this.db
      .listContacts()
      .find((x) => x.name.toLowerCase() === nameOrAddress.toLowerCase());
    if (c)
      return {
        address: getAddress(c.address),
        provenance: { source: "address_book", origin: `contact "${c.name}"` },
      };
    if (nameOrAddress.toUpperCase() === "WETH")
      return {
        address: this.cfg.wethAddress,
        provenance: { source: "chain", origin: "configured WETH address" },
      };
    return undefined;
  }

  // ------------------------------------------------------------------ propose and run

  async propose(input: ProposeInput): Promise<IntentView> {
    const draft = intentDraftSchema.parse(input.draft);
    const m = await this.mandate.read();
    const block = await this.clients.publicClient.getBlock();
    const intent = buildIntent(draft, { nonce: m.nextNonce, deadline: block.timestamp + 1800n });
    const id = `int_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const row: IntentRow = {
      id,
      created_at: now,
      updated_at: now,
      state: "Drafted",
      kind: draft.kind,
      target: intent.target,
      token: intent.token,
      amount: intent.amount.toString(),
      data: draft.data,
      data_hash: intent.dataHash,
      nonce: intent.nonce.toString(),
      deadline: intent.deadline.toString(),
      rationale: draft.rationale,
      rationale_hash: intent.rationaleHash,
      intent_hash: intentHash(intent, this.cfg.chainId, m.vault),
      verdict_json: null,
      trace_json: JSON.stringify(newTrace(id)),
      simulation_json: null,
      tx_hash: null,
      revert_reason: null,
      owner_message: input.ownerMessage ?? null,
      source: input.source,
      tier: null,
      agent_sig: null,
    };
    this.db.insertIntent(row);
    this.record(id, "intent.drafted", {
      kind: draft.kind,
      target: intent.target,
      token: intent.token,
      amount: intent.amount,
      nonce: intent.nonce,
      rationale: draft.rationale,
      source: input.source,
    });
    this.emitIntent(id);
    return this.run(id, intent, input);
  }

  private async run(id: string, intent: Intent, input: ProposeInput): Promise<IntentView> {
    const trace = newTrace(id);
    const row = this.db.getIntent(id)!;
    const data = row.data as Hex;

    // L0: context isolation
    await traceStep(trace, "L0", "Context isolation", async () => {
      const injected = input.untrustedInputs.filter((u) => u.suspectedInjection);
      const srcs = [input.provenance.target.source, input.provenance.amount.source];
      const status = injected.length
        ? "fail"
        : srcs.some((s) => s === "untrusted" || s === "memory" || s === "decoded")
          ? "warn"
          : "pass";
      return {
        status,
        detail: `target from ${input.provenance.target.source} (${input.provenance.target.origin}); amount from ${input.provenance.amount.source} (${input.provenance.amount.origin}); ${input.untrustedInputs.length} untrusted input(s), ${injected.length} flagged as instruction-like`,
        citations: ["OWASP-LLM01", "OWASP-ASI01", "Beurer-Kellner 2025", "CaMeL"],
      };
    });
    this.saveTrace(id, trace);

    // L1: typed intent, signed by the agent
    const agentSig = await traceStep(trace, "L1", "Typed intent", async () => {
      const sig = await this.executor.signIntent(intent);
      return {
        status: "pass",
        detail: `EIP-712 Intent signed by agent ${this.executor.agentAddress}; hash ${row.intent_hash}`,
        citations: ["EIP-712"],
        data: sig,
      };
    });
    this.db.updateIntent(id, { agent_sig: agentSig ?? null });
    this.saveTrace(id, trace);

    // L2: policy
    const ctx = await this.buildContext(intent, input, data);
    const verdict = evaluate(intent, ctx);
    await traceStep(trace, "L2", "Policy engine", async () => ({
      status: statusFromVerdict(verdict),
      detail: `${verdict.decision} (tier ${verdict.tier}, chain tier ${verdict.chainTier}: ${verdict.chainReason}); risk ${verdict.riskScore}; ${
        verdict.reasons
          .filter((r) => r.severity !== "info")
          .map((r) => `${r.rule}: ${r.message}`)
          .join(" | ") || "no flags"
      }`,
      citations: verdict.citations,
      data: verdict,
    }));
    this.db.updateIntent(id, { verdict_json: json(verdict), tier: verdict.tier });
    this.record(id, "policy.verdict", {
      decision: verdict.decision,
      tier: verdict.tier,
      chainTier: verdict.chainTier,
      riskScore: verdict.riskScore,
      reasons: verdict.reasons,
    });
    this.saveTrace(id, trace);

    if (verdict.decision === "DENY" && !input.forceOnChain) {
      return this.finish(id, "Blocked", trace, {
        reason: verdict.reasons
          .filter((r) => r.severity === "deny")
          .map((r) => r.message)
          .join("; "),
      });
    }

    if (verdict.decision === "ESCALATE" && !input.forceOnChain) {
      const expires = new Date(Date.now() + 30 * 60_000).toISOString();
      const approvalId = `apr_${randomUUID().slice(0, 8)}`;
      this.db.insertApproval({
        id: approvalId,
        intent_id: id,
        created_at: new Date().toISOString(),
        expires_at: expires,
        status: "pending",
        owner_sig: null,
        approval_deadline: null,
        declined_reason: null,
        signer: null,
      });
      // Pre-flight simulation of the Tier 1 path is not meaningful here; a co-signed path is simulated at approval time.
      await traceStep(trace, "L5", "Human in the loop", async () => ({
        status: "warn",
        detail: `approval ${approvalId} created; owner co-signature required before the vault will accept this intent`,
        citations: ["NIST-AI-RMF", "OWASP-ASI09"],
      }));
      this.record(id, "intent.awaiting_approval", {
        approvalId,
        expires,
        reasons: verdict.reasons.filter((r) => r.severity === "escalate").map((r) => r.message),
      });
      this.setState(id, "AwaitingApproval", trace);
      this.bus.emit("approval.created", { id: approvalId, intentId: id });
      return this.view(id)!;
    }

    // L3 + L4 for Tier 1 (or forced Security Lab sends)
    return this.simulateAndSend(
      id,
      intent,
      data,
      agentSig as Hex,
      trace,
      undefined,
      input.forceOnChain ?? false,
    );
  }

  private async simulateAndSend(
    id: string,
    intent: Intent,
    data: Hex,
    agentSig: Hex,
    trace: DecisionTrace,
    approval: { deadline: bigint; ownerSig: Hex } | undefined,
    forceOnChain: boolean,
  ): Promise<IntentView> {
    this.setState(id, "Simulating", trace);
    const sim = await this.simulator.simulate(intent, data, agentSig, approval);
    await traceStep(trace, "L3", "Pre-flight simulation", async () => ({
      status:
        sim.method === "none"
          ? "fail"
          : !sim.ok
            ? "fail"
            : sim.deviation
              ? "fail"
              : sim.method === "eth_call"
                ? "warn"
                : "pass",
      detail:
        sim.method === "none"
          ? (sim.revertReason ?? "unavailable")
          : !sim.ok
            ? `would revert: ${sim.revertReason}`
            : sim.deviation
              ? "asset deltas deviate from the intent"
              : `${sim.method}: ${sim.method === "eth_call" ? "call succeeds (balance deltas not measurable with eth_call)" : `deltas match (${Object.keys(sim.observedDeltas).length} balances checked)`}`,
      citations: ["OWASP-LLM05"],
      data: sim,
    }));
    this.db.updateIntent(id, { simulation_json: json(sim) });
    this.saveTrace(id, trace);
    if ((!sim.ok || sim.deviation || sim.method === "none") && !forceOnChain) {
      this.record(id, "intent.blocked", {
        stage: "simulation",
        reason: sim.revertReason ?? (sim.deviation ? "deviation" : "unavailable"),
      });
      return this.finish(id, "Blocked", trace, {
        reason: `simulation: ${sim.revertReason ?? (sim.deviation ? "asset deltas deviate from the intent" : "unavailable")}`,
      });
    }

    this.setState(id, "Submitted", trace);
    let result;
    try {
      result = await this.executor.send(intent, data, agentSig, approval, forceOnChain);
    } catch (err) {
      const reason = Executor.describeError(err);
      await traceStep(trace, "L4", "On-chain enforcement", async () => ({
        status: "fail",
        detail: `not broadcast: ${reason}`,
        citations: ["MM-SEC-AUG26"],
      }));
      this.record(id, "intent.reverted", { stage: "send", reason });
      return this.finish(id, "RevertedOnChain", trace, { reason });
    }
    this.record(id, "chain.receipt", {
      txHash: result.hash,
      status: result.status,
      block: result.blockNumber,
      gasUsed: result.gasUsed,
      revertReason: result.revertReason,
    });
    this.mandate.invalidate();
    if (result.status === "success") {
      await traceStep(trace, "L4", "On-chain enforcement", async () => ({
        status: "pass",
        detail: `IntentExecuted in block ${result.blockNumber}, tx ${result.hash}`,
        citations: ["MM-SEC-AUG26"],
        data: { txHash: result.hash },
      }));
      this.db.insertSpend({
        ts: new Date().toISOString(),
        token: intent.token,
        amount: intent.amount.toString(),
        target: intent.target,
        tier: approval ? 2 : 1,
        intent_id: id,
      });
      this.db.updateIntent(id, { tx_hash: result.hash });
      trace.txHash = result.hash;
      this.record(id, "intent.executed", { txHash: result.hash, tier: approval ? 2 : 1 });
      return this.finish(id, "Executed", trace, {});
    }
    await traceStep(trace, "L4", "On-chain enforcement", async () => ({
      status: "fail",
      detail: `vault reverted: ${result.revertReason} (tx ${result.hash})`,
      citations: ["MM-SEC-AUG26"],
      data: { txHash: result.hash },
    }));
    this.db.updateIntent(id, { tx_hash: result.hash });
    trace.txHash = result.hash;
    this.record(id, "intent.reverted", { txHash: result.hash, reason: result.revertReason });
    return this.finish(id, "RevertedOnChain", trace, { reason: result.revertReason ?? "reverted" });
  }

  // ------------------------------------------------------------------ approvals

  /**
   * An intent that waited for approval may have lost its nonce to a later Tier 1
   * intent. Before the owner signs, the intent is rebuilt with the current nonce
   * and re-signed by the agent, so the owner's approval binds the hash the vault
   * will actually see.
   */
  async refreshNonce(
    intentId: string,
  ): Promise<{ intent: Intent; intentHash: Hex; changed: boolean }> {
    const row = this.db.getIntent(intentId)!;
    const m = await this.mandate.read();
    const intent = rowToIntent(row);
    if (intent.nonce === m.nextNonce)
      return { intent, intentHash: row.intent_hash as Hex, changed: false };
    const block = await this.clients.publicClient.getBlock();
    const fresh: Intent = { ...intent, nonce: m.nextNonce, deadline: block.timestamp + 1800n };
    const ih = intentHash(fresh, this.cfg.chainId, m.vault);
    const agentSig = await this.executor.signIntent(fresh);
    this.db.updateIntent(intentId, {
      nonce: fresh.nonce.toString(),
      deadline: fresh.deadline.toString(),
      intent_hash: ih,
      agent_sig: agentSig,
    });
    this.record(intentId, "intent.renonced", {
      from: intent.nonce,
      to: fresh.nonce,
      intentHash: ih,
    });
    return { intent: fresh, intentHash: ih, changed: true };
  }

  /** Local owner mode: the server-held owner key signs after the owner authenticated (passkey). */
  async approveLocal(approvalId: string, signer: string): Promise<IntentView> {
    const a = this.db.getApproval(approvalId);
    if (!a || a.status !== "pending") throw new Error("approval not pending");
    if (Date.parse(a.expires_at) < Date.now()) {
      this.db.updateApproval(approvalId, { status: "expired" });
      this.record(a.intent_id, "intent.expired", { approvalId });
      this.setState(a.intent_id, "Expired", this.loadTrace(a.intent_id));
      throw new Error("approval expired");
    }
    if (!this.clients.ownerClient) throw new Error("local owner key not configured");
    const { intentHash: ih } = await this.refreshNonce(a.intent_id);
    const m = await this.mandate.read();
    const block = await this.clients.publicClient.getBlock();
    const deadline = block.timestamp + 900n;
    const ownerSig = await Executor.signApproval(
      this.clients.ownerClient,
      this.cfg.chainId,
      m.vault,
      ih,
      deadline,
    );
    return this.approveWithSignature(approvalId, ownerSig, deadline, signer);
  }

  /** MetaMask owner mode: the dashboard supplies the owner's EIP-712 signature. */
  async approveWithSignature(
    approvalId: string,
    ownerSig: Hex,
    deadline: bigint,
    signer: string,
  ): Promise<IntentView> {
    const a = this.db.getApproval(approvalId);
    if (!a || a.status !== "pending") throw new Error("approval not pending");
    const row = this.db.getIntent(a.intent_id)!;
    const intent = rowToIntent(row);
    const trace = this.loadTrace(a.intent_id);
    this.db.updateApproval(approvalId, {
      status: "approved",
      owner_sig: ownerSig,
      approval_deadline: deadline.toString(),
      signer,
    });
    this.record(a.intent_id, "approval.signed", {
      approvalId,
      signer,
      deadline,
      intentHash: row.intent_hash,
    });
    await traceStep(trace, "L5", "Human in the loop", async () => ({
      status: "pass",
      detail: `owner approval signed by ${signer}, bound to intent hash ${row.intent_hash} with deadline ${deadline}`,
      citations: ["EIP-712", "NIST-AI-RMF"],
    }));
    this.saveTrace(a.intent_id, trace);
    this.bus.emit("approval.updated", { id: approvalId, status: "approved" });
    const view = await this.simulateAndSend(
      a.intent_id,
      intent,
      row.data as Hex,
      row.agent_sig as Hex,
      trace,
      { deadline, ownerSig },
      false,
    );
    this.db.updateApproval(approvalId, { status: "consumed" });
    this.bus.emit("approval.updated", { id: approvalId, status: "consumed" });
    return view;
  }

  decline(approvalId: string, reason: string, signer: string): IntentView {
    const a = this.db.getApproval(approvalId);
    if (!a || a.status !== "pending") throw new Error("approval not pending");
    this.db.updateApproval(approvalId, { status: "declined", declined_reason: reason, signer });
    this.record(a.intent_id, "approval.declined", { approvalId, reason, signer });
    const trace = this.loadTrace(a.intent_id);
    trace.steps.push({
      layer: "L5",
      name: "Human in the loop",
      status: "fail",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      detail: `owner declined: ${reason}`,
      citations: ["NIST-AI-RMF"],
    });
    this.finish(a.intent_id, "Rejected", trace, { reason });
    this.bus.emit("approval.updated", { id: approvalId, status: "declined" });
    return this.view(a.intent_id)!;
  }

  expireStale(): void {
    for (const a of this.db.listApprovals()) {
      if (a.status === "pending" && Date.parse(a.expires_at) < Date.now()) {
        this.db.updateApproval(a.id, { status: "expired" });
        this.record(a.intent_id, "intent.expired", { approvalId: a.id });
        this.finish(a.intent_id, "Expired", this.loadTrace(a.intent_id), {
          reason: "approval window elapsed",
        });
        this.bus.emit("approval.updated", { id: a.id, status: "expired" });
      }
    }
  }

  // ------------------------------------------------------------------ context

  async buildContext(intent: Intent, input: ProposeInput, data: Hex): Promise<PolicyContext> {
    const m = await this.mandate.read();
    const block = await this.clients.publicClient.getBlock();
    const now = block.timestamp;
    const contacts = this.db.listContacts().map((c) => ({
      name: c.name,
      address: getAddress(c.address),
      addedAt: BigInt(Math.floor(Date.parse(c.added_at) / 1000)),
      source: "owner" as const,
    }));
    const spendHistory = this.db.listSpend().map((s) => ({
      ts: BigInt(Math.floor(Date.parse(s.ts) / 1000)),
      token: getAddress(s.token),
      amount: BigInt(s.amount),
      target: getAddress(s.target),
      tier: s.tier as 0 | 1 | 2 | 3,
    }));
    const inboundHistory = this.db.listInbound().map((i) => ({
      ts: BigInt(Math.floor(Date.parse(i.ts) / 1000)),
      from: getAddress(i.from_addr),
      token: getAddress(i.token),
      amount: BigInt(i.amount),
    }));
    const screening = this.screening.screen([intent.target], now);
    const ctx: PolicyContext = {
      now,
      currentBlock: block.number,
      mandate: m,
      addressBook: contacts,
      spendHistory,
      inboundHistory,
      screening,
      provenance: input.provenance,
      untrustedInputs: input.untrustedInputs,
      calldata: data,
      params: {
        ...DEFAULT_POLICY_PARAMS,
        dustThreshold: {
          [ZERO_ADDRESS]: 10n ** 13n,
          [this.cfg.usdcAddress.toLowerCase()]: 10_000n,
        },
      },
    };
    if (input.ownerStatement) ctx.ownerStatement = input.ownerStatement;
    if (kindName(intent.kind) === "CALL") ctx.targetInfo = await this.targetInfo(intent.target);
    return ctx;
  }

  private async targetInfo(target: Address): Promise<TargetInfo> {
    const code = await this.clients.publicClient.getCode({ address: target });
    const info: TargetInfo = { isContract: !!code && code !== "0x", sourceVerified: null };
    if (this.cfg.chainId === 31337) {
      // local chain: no explorer; the allowlisted WETH mock counts as known
      info.sourceVerified =
        target.toLowerCase() === this.cfg.wethAddress.toLowerCase() ? true : null;
      return info;
    }
    if (target.toLowerCase() === this.cfg.wethAddress.toLowerCase()) {
      info.sourceVerified = true; // canonical predeploy
      return info;
    }
    try {
      const base =
        process.env.BLOCKSCOUT_API?.replace(/\/api\/?$/, "") ??
        "https://base-sepolia.blockscout.com";
      const res = await fetch(`${base}/api/v2/smart-contracts/${target}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const j = (await res.json()) as { is_verified?: boolean };
        info.sourceVerified = j.is_verified === true;
      }
    } catch {
      info.sourceVerified = null;
    }
    return info;
  }

  // ------------------------------------------------------------------ views and helpers

  view(id: string): IntentView | undefined {
    const r = this.db.getIntent(id);
    if (!r) return undefined;
    const tok = this.tokenByAddress(r.token) ?? {
      symbol: r.token === ZERO_ADDRESS ? "ETH" : "?",
      decimals: 18,
      address: r.token as Address,
    };
    const a = this.db.getApprovalByIntent(id);
    const v: IntentView = {
      id: r.id,
      state: r.state,
      kind: r.kind,
      target: r.target,
      token: r.token,
      tokenSymbol: tok.symbol,
      amount: r.amount,
      amountFormatted: `${formatUnits(BigInt(r.amount), tok.decimals)} ${tok.symbol}`,
      rationale: r.rationale,
      intentHash: r.intent_hash,
      nonce: r.nonce,
      deadline: r.deadline,
      verdict: r.verdict_json ? (JSON.parse(r.verdict_json) as Verdict) : null,
      trace: r.trace_json ? (JSON.parse(r.trace_json) as DecisionTrace) : null,
      simulation: r.simulation_json ? (JSON.parse(r.simulation_json) as SimulationResult) : null,
      txHash: r.tx_hash,
      explorerUrl: r.tx_hash ? explorerTx(this.cfg, r.tx_hash) : undefined,
      revertReason: r.revert_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      tier: r.tier,
    };
    if (a) v.approval = { id: a.id, status: a.status, expiresAt: a.expires_at };
    return v;
  }

  list(limit = 100): IntentView[] {
    return this.db.listIntents(limit).map((r) => this.view(r.id)!);
  }

  lastVerdict(): IntentView | undefined {
    return this.list(1)[0];
  }

  private finish(
    id: string,
    state: IntentState,
    trace: DecisionTrace,
    extra: { reason?: string | undefined },
  ): IntentView {
    trace.finalState = state;
    trace.steps.push({
      layer: "L6",
      name: "Observability",
      status: "pass",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      detail: `final state ${state}; ${this.audit.length} audit records, chain head ${this.audit.head.slice(0, 10)}...`,
      citations: ["NIST-SP800-53 AU-2", "NIST-SP800-53 AU-10"],
    });
    if (extra.reason) this.db.updateIntent(id, { revert_reason: extra.reason });
    if (state === "Blocked") this.record(id, "intent.blocked", { reason: extra.reason });
    this.setState(id, state, trace);
    return this.view(id)!;
  }

  private setState(id: string, state: IntentState, trace: DecisionTrace): void {
    this.db.updateIntent(id, { state, trace_json: json(trace) });
    this.emitIntent(id);
  }

  private saveTrace(id: string, trace: DecisionTrace): void {
    this.db.updateIntent(id, { trace_json: json(trace) });
    const last = trace.steps[trace.steps.length - 1];
    if (last) this.bus.emit("trace.step", { intentId: id, step: JSON.parse(json(last)) });
  }

  private loadTrace(id: string): DecisionTrace {
    const r = this.db.getIntent(id);
    return r?.trace_json ? (JSON.parse(r.trace_json) as DecisionTrace) : newTrace(id);
  }

  private emitIntent(id: string): void {
    this.bus.emit("intent.updated", this.view(id));
  }

  private record(intentId: string, event: string, payload: unknown): void {
    this.audit.append({
      actor: event.startsWith("approval")
        ? "owner"
        : event.startsWith("chain")
          ? "chain"
          : event.startsWith("policy")
            ? "policy"
            : "agent",
      event,
      payload: { intentId, ...(payload as object) },
    });
  }
}

export function json(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
}

export function rowToIntent(r: IntentRow): Intent {
  return {
    kind: INTENT_KIND_HASH[r.kind as keyof typeof INTENT_KIND_HASH],
    target: getAddress(r.target),
    token: getAddress(r.token),
    amount: BigInt(r.amount),
    dataHash: r.data_hash as Hex,
    nonce: BigInt(r.nonce),
    deadline: BigInt(r.deadline),
    rationaleHash: r.rationale_hash as Hex,
  };
}

export function parseAmount(amount: string, token: TokenMeta, available?: bigint): bigint {
  const a = amount.trim().toLowerCase();
  if (a === "all" || a === "everything") return available ?? 0n;
  if (a === "max" || a === "unlimited") return 2n ** 256n - 1n;
  return parseUnits(a, token.decimals);
}

export function depositCalldata(): Hex {
  return encodeFunctionData({
    abi: [
      { type: "function", name: "deposit", inputs: [], outputs: [], stateMutability: "payable" },
    ],
    functionName: "deposit",
  });
}
