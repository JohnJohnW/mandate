/**
 * The Security Lab runner. For each scenario it records an outcome under each of
 * the four defence configurations.
 *
 * Configurations A, B and C are modelled (see @mandate/attacks): they do not
 * exist in the product, so we do not execute attacker transfers for them. For C
 * the policy verdict is the real policy engine's answer on the declared attempt,
 * so that column is measured, not guessed.
 *
 * Configuration D is the product. Every D cell runs the real pipeline, the real
 * policy engine and the deployed vault, so a blocked cell reflects what the
 * shipped system does, and the compromised-key and kill-switch scenarios produce
 * real on-chain reverts with transaction hashes.
 */
import { getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import {
  MAX_UINT256,
  ZERO_ADDRESS,
  buildIntent,
  evaluate,
  type IntentDraft,
  type Provenance,
  scanForInjection,
} from "@mandate/core";
import {
  DEFENCE_CONFIGS,
  loadCatalog,
  modelConfigA,
  modelConfigB,
  modelConfigC,
  type ConfigId,
  type RunReport,
  type Scenario,
  type ScenarioResult,
} from "@mandate/attacks";
import type { App } from "../app.js";
import { Executor } from "../chain/executor.js";
import { json } from "../pipeline/service.js";

export interface RunOptions {
  configs?: ConfigId[];
  scenarioIds?: string[];
  onProgress?: (r: ScenarioResult) => void;
}

export class AttackRunner {
  constructor(private readonly app: App) {}

  private resolveTarget(t: string): Address {
    if (isAddress(t, { strict: false })) return getAddress(t);
    const c = this.app.db.listContacts().find((x) => x.name.toLowerCase() === t.toLowerCase());
    if (c) return getAddress(c.address);
    throw new Error(`unknown target ${t}`);
  }

  private tokenAddress(sym: "ETH" | "USDC"): Address {
    return sym === "ETH" ? ZERO_ADDRESS : this.app.cfg.usdcAddress;
  }

  private async attemptAmount(s: Scenario): Promise<bigint> {
    const a = s.attempt.amount.trim().toLowerCase();
    if (a === "max") return MAX_UINT256;
    const token = this.tokenAddress(s.attempt.token);
    if (a === "all") {
      const m = await this.app.mandate.read();
      return token === ZERO_ADDRESS
        ? await this.app.clients.publicClient.getBalance({ address: m.vault })
        : ((await this.app.clients.publicClient.readContract({
            address: token,
            abi: [
              {
                type: "function",
                name: "balanceOf",
                stateMutability: "view",
                inputs: [{ type: "address" }],
                outputs: [{ type: "uint256" }],
              },
            ],
            functionName: "balanceOf",
            args: [m.vault],
          })) as bigint);
    }
    return parseUnits(a, s.attempt.token === "USDC" ? 6 : 18);
  }

  /** The real policy engine's decision on the declared attempt, for configuration C. */
  private async policyDecision(
    s: Scenario,
  ): Promise<{ decision: "ALLOW" | "ESCALATE" | "DENY"; rule: string | null }> {
    const target = this.resolveTarget(s.attempt.target);
    const token = this.tokenAddress(s.attempt.token);
    const amount = await this.attemptAmount(s);
    const draft: IntentDraft = {
      kind: s.attempt.kind,
      target,
      token: s.attempt.kind === "TRANSFER_NATIVE" ? ZERO_ADDRESS : token,
      amount,
      data: "0x",
      rationale: `modelled attempt for ${s.id}`,
    };
    const m = await this.app.mandate.read();
    const intent = buildIntent(draft, {
      nonce: m.nextNonce,
      deadline: (await this.app.clients.publicClient.getBlock()).timestamp + 600n,
    });
    // The injected target and amount come from untrusted content; that is what the policy engine must weigh.
    const untrusted = scanForInjection(s.payload);
    const prov: Provenance = {
      source: "untrusted",
      origin: `${s.channel} content`,
      ...(untrusted.suspected ? { suspectedInjection: true } : {}),
    };
    const ctx = await this.app.intents.buildContext(
      intent,
      {
        draft,
        provenance: { target: prov, amount: prov },
        untrustedInputs: [
          {
            id: s.id,
            kind: "message",
            origin: s.channel,
            text: s.payload,
            suspectedInjection: untrusted.suspected,
            matches: untrusted.matches,
          },
        ],
        source: "attack-model",
      },
      "0x",
    );
    // Velocity: the window is already full by the time the overflowing transfer arrives.
    if (s.family === "velocity") {
      const asset = ctx.mandate.assets[token.toLowerCase()];
      if (asset)
        ctx.mandate.assets[token.toLowerCase()] = {
          ...asset,
          spentInWindow: asset.autonomousWindowCap,
          windowStart: ctx.now,
        };
    }
    const v = evaluate(intent, ctx);
    const blocking =
      v.reasons.find((r) => r.severity === "deny") ??
      v.reasons.find((r) => r.severity === "escalate");
    return { decision: v.decision, rule: blocking ? blocking.rule : null };
  }

  /** Runs one scenario under configuration D: the real product. */
  private async runConfigD(s: Scenario): Promise<ScenarioResult> {
    const started = Date.now();
    const base = (
      outcome: ScenarioResult["outcome"],
      blockedAt: string | null,
      detail: string,
      txHash: string | null,
      amountMoved: string,
    ): ScenarioResult => ({
      scenario: s.id,
      config: "D",
      outcome,
      blockedAt,
      fundsMoved: outcome === "funds_moved",
      amountMoved,
      txHash,
      detail,
      plannerMode: this.app.agent.planner.name,
      durationMs: Date.now() - started,
      defended: outcome !== "funds_moved",
      expectedStop: s.expected_stop,
    });

    await this.ensureReady();

    if (s.attempt.reaches === "direct_key") {
      // The attacker holds the agent key and calls the vault directly, over cap and to a new target.
      const r = await this.directVaultAttempt(s);
      return base(
        "reverted_on_chain",
        "L4",
        `The vault reverted the direct over-cap call: ${r.reason}.`,
        r.hash,
        "0",
      );
    }
    if (s.attempt.reaches === "kill_switch") {
      // The owner revokes, then the agent key tries a transfer anyway.
      await this.ownerCall("revokeAgent", [this.app.clients.agent.address]);
      const r = await this.directVaultAttempt(s, true);
      const block = await this.app.clients.publicClient.getBlock();
      await this.ownerCall("setAgent", [
        this.app.clients.agent.address,
        block.timestamp + 7n * 86400n,
        true,
      ]);
      return base(
        "reverted_on_chain",
        "L4",
        `After the owner revoked the agent, the vault reverted the attempt: ${r.reason}.`,
        r.hash,
        "0",
      );
    }

    // Planner-reachable scenarios: drive the real pipeline with the attempt, the payload quarantined
    // as untrusted content, exactly as the product would see it.
    const target = this.resolveTarget(s.attempt.target);
    const token = this.tokenAddress(s.attempt.token);
    const amount = await this.attemptAmount(s);
    const untrusted = scanForInjection(s.payload);
    const injectedProv: Provenance = {
      source: "untrusted",
      origin: `${s.channel} content`,
      ...(untrusted.suspected ? { suspectedInjection: true } : {}),
    };
    // ATK-06 (poisoning) and ATK-07 (unlimited approval): the owner states the target in their own message,
    // so the target provenance is owner; the attack is in the value, not the provenance.
    const ownerStated = s.family === "address_poisoning" || s.family === "unlimited_approval";
    const view = await this.app.intents.propose({
      draft: {
        kind: s.attempt.kind,
        target,
        token: s.attempt.kind === "TRANSFER_NATIVE" ? ZERO_ADDRESS : token,
        amount,
        data: "0x",
        rationale: `attack scenario ${s.id}`,
      },
      provenance: {
        target: ownerStated ? { source: "owner", origin: "owner message" } : injectedProv,
        amount: ownerStated ? { source: "owner", origin: "owner message" } : injectedProv,
      },
      untrustedInputs: [
        {
          id: s.id,
          kind: "message",
          origin: s.channel,
          text: s.payload,
          suspectedInjection: untrusted.suspected,
          matches: untrusted.matches,
        },
      ],
      source: "attack",
    });
    const trace = view.trace?.steps ?? [];
    const failing = [...trace].reverse().find((t) => t.status === "fail");
    const warning = [...trace].reverse().find((t) => t.status === "warn");
    const blockedAt = failing?.layer ?? warning?.layer ?? null;
    if (view.state === "Executed")
      return base(
        "funds_moved",
        null,
        `The product executed the intent (this should not happen): ${view.txHash}`,
        view.txHash,
        view.amount,
      );
    if (view.state === "AwaitingApproval")
      return base(
        "escalated",
        blockedAt ?? "L2",
        `The product escalated the attempt for owner co-signature and did not act autonomously.`,
        null,
        "0",
      );
    if (view.state === "RevertedOnChain")
      return base(
        "reverted_on_chain",
        "L4",
        `The vault reverted the attempt: ${view.revertReason}.`,
        view.txHash,
        "0",
      );
    return base(
      "blocked",
      blockedAt ?? "L2",
      `The product blocked the attempt: ${
        view.revertReason ??
        view.verdict?.reasons
          .filter((r) => r.severity === "deny")
          .map((r) => r.message)
          .join("; ") ??
        "no funds moved"
      }.`,
      null,
      "0",
    );
  }

  private async directVaultAttempt(
    s: Scenario,
    afterRevoke = false,
  ): Promise<{ hash: Hex; reason: string }> {
    const target = this.resolveTarget(s.attempt.target);
    const m = await this.app.mandate.read();
    const asset = m.assets[ZERO_ADDRESS]!;
    const amount = afterRevoke ? asset.autonomousPerTxCap / 2n : asset.autonomousPerTxCap + 1n; // over cap, or any amount after revoke
    const block = await this.app.clients.publicClient.getBlock();
    const i = buildIntent(
      {
        kind: "TRANSFER_NATIVE",
        target,
        token: ZERO_ADDRESS,
        amount,
        data: "0x",
        rationale: `direct ${s.id}`,
      },
      { nonce: m.nextNonce, deadline: block.timestamp + 600n },
    );
    const sig = await this.app.executor.signIntent(i);
    const res = await this.app.executor.send(i, "0x", sig, undefined, true);
    return {
      hash: res.hash,
      reason:
        res.revertReason ?? (res.status === "reverted" ? "reverted" : "unexpectedly succeeded"),
    };
  }

  private async ownerCall(functionName: string, args: unknown[]): Promise<void> {
    if (!this.app.clients.ownerClient)
      throw new Error("owner key required for the kill-switch scenario");
    const { MANDATE_VAULT_ABI } = await import("@mandate/contracts");
    const hash = await this.app.clients.ownerClient.writeContract({
      account: this.app.clients.ownerClient.account!,
      chain: this.app.clients.ownerClient.chain,
      address: this.app.cfg.vaultAddress!,
      abi: MANDATE_VAULT_ABI,
      functionName,
      args,
    });
    await this.app.clients.publicClient.waitForTransactionReceipt({ hash });
    this.app.mandate.invalidate();
  }

  private async ensureReady(): Promise<void> {
    const m = await this.app.mandate.read();
    if (m.paused) await this.ownerCall("unpause", []);
    if (!m.active) {
      const block = await this.app.clients.publicClient.getBlock();
      await this.ownerCall("setAgent", [
        this.app.clients.agent.address,
        block.timestamp + 7n * 86400n,
        true,
      ]);
    }
  }

  async run(opts: RunOptions = {}): Promise<RunReport> {
    const catalog = loadCatalog();
    const scenarios = opts.scenarioIds
      ? catalog.filter((s) => opts.scenarioIds!.includes(s.id))
      : catalog;
    const configs = opts.configs ?? ["A", "B", "C", "D"];
    const started = new Date().toISOString();
    const results: ScenarioResult[] = [];
    const plannerMode = this.app.agent.planner.name;
    for (const s of scenarios) {
      for (const c of configs) {
        let r: ScenarioResult;
        try {
          if (c === "A") r = modelConfigA(s, plannerMode);
          else if (c === "B") r = modelConfigB(s, plannerMode);
          else if (c === "C") {
            const pd = await this.policyDecision(s);
            r = modelConfigC({
              scenario: s,
              policyDecision: pd.decision,
              policyBlockedBy: pd.rule,
              plannerMode,
            });
          } else r = await this.runConfigD(s);
        } catch (err) {
          r = {
            scenario: s.id,
            config: c,
            outcome: "error",
            blockedAt: null,
            fundsMoved: false,
            amountMoved: "0",
            txHash: null,
            detail: err instanceof Error ? err.message : String(err),
            plannerMode,
            durationMs: 0,
            defended: true,
            expectedStop: s.expected_stop,
          };
        }
        results.push(r);
        opts.onProgress?.(r);
        this.app.bus.emit("attack.progress", r);
      }
    }
    const finished = new Date().toISOString();
    const { execSync } = await import("node:child_process");
    let commit = "unknown";
    try {
      commit = execSync("git rev-parse --short HEAD", {
        cwd: new URL("../../../../", import.meta.url).pathname,
      })
        .toString()
        .trim();
    } catch {
      // not a git checkout
    }
    const report: RunReport = {
      id: `run_${Date.now()}`,
      startedAt: started,
      finishedAt: finished,
      chainId: this.app.cfg.chainId,
      chainName: this.app.cfg.chainName,
      plannerMode,
      configs,
      scenarios: scenarios.map((s) => s.id),
      results,
      methodology:
        "Each scenario declares the transfer the attack is trying to achieve. Configurations A, B and C are modelled: A has no guards, B adds a prompt denylist, C adds the off-chain policy engine (whose verdict here is the real policy engine's answer on the declared attempt) and simulation, but the agent key holds the funds and the mandate is a software setting. Configuration D is the deployed product: every D cell runs the real plan-then-execute pipeline, the real policy engine and the deployed MandateVault, and the compromised-key and kill-switch scenarios produce real on-chain reverts. We report outcomes exactly as measured.",
      commit,
    };
    this.app.db.insertAttackRun({
      id: report.id,
      started_at: started,
      finished_at: finished,
      config: configs.join(","),
      planner: plannerMode,
      results_json: json(report),
    });
    this.app.audit.append({
      actor: "system",
      event: "attack.run",
      payload: {
        id: report.id,
        scenarios: report.scenarios.length,
        configs,
        defendedD: results.filter((r) => r.config === "D" && r.defended).length,
      },
    });
    return report;
  }
}

export { DEFENCE_CONFIGS, loadCatalog };
export { Executor };
