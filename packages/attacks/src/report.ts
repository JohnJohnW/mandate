import type { ConfigId, RunReport, Scenario, ScenarioResult } from "./types.js";
import { DEFENCE_CONFIGS } from "./types.js";

function cell(r: ScenarioResult | undefined, explorer: string | null): string {
  if (!r) return "not run";
  const mark =
    r.outcome === "funds_moved"
      ? "FUNDS MOVED"
      : r.outcome === "error"
        ? "error"
        : r.outcome === "no_action"
          ? "no action"
          : r.outcome === "reverted_on_chain"
            ? "reverted on-chain"
            : r.outcome === "escalated"
              ? "escalated"
              : "blocked";
  const where = r.blockedAt ? ` at ${r.blockedAt}` : "";
  const tx = r.txHash
    ? explorer
      ? ` [tx](${explorer}/tx/${r.txHash})`
      : ` tx ${r.txHash.slice(0, 10)}...`
    : "";
  return `${mark}${where}${tx}`;
}

/** Renders docs/EVALUATION.md from a run report. Never edited by hand. */
export function renderEvaluation(
  report: RunReport,
  catalog: Scenario[],
  explorer: string | null,
): string {
  const by = (s: string, c: ConfigId) =>
    report.results.find((r) => r.scenario === s && r.config === c);
  const lines: string[] = [];
  lines.push("# Evaluation");
  lines.push("");
  lines.push(
    "Why read this: it is the measured result of replaying documented attack patterns against four defence configurations. The numbers come straight from the harness; we do not edit them.",
  );
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push(report.methodology);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Run id | ${report.id} |`);
  lines.push(`| Chain | ${report.chainId} (${report.chainName}) |`);
  lines.push(
    `| Planner | ${report.plannerMode === "live" ? "live LLM (OpenAI-compatible endpoint)" : "MockPlanner (deterministic); configurations A and B use a scripted naive planner, see methodology"} |`,
  );
  lines.push(`| Started | ${report.startedAt} |`);
  lines.push(`| Finished | ${report.finishedAt} |`);
  lines.push(`| Repository commit | ${report.commit} |`);
  lines.push("");
  lines.push("## Defence configurations");
  lines.push("");
  lines.push(
    "| Id | Name | Planner sees raw content | Quarantine | Policy engine | Simulation | Vault enforcement | In the product |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const c of DEFENCE_CONFIGS.filter((c) => report.configs.includes(c.id))) {
    lines.push(
      `| ${c.id} | ${c.name} | ${c.quarantine ? "no" : "yes"} | ${c.quarantine ? "yes" : "no"} | ${c.policy ? "yes" : "no"} | ${c.simulation ? "yes" : "no"} | ${c.vault ? "yes" : "no"} | ${c.harnessOnly ? "harness only" : "yes"} |`,
    );
  }
  lines.push("");
  lines.push("## Results matrix");
  lines.push("");
  lines.push(
    `| Scenario | Family | Expected stop | ${report.configs.map((c) => `Config ${c}`).join(" | ")} |`,
  );
  lines.push(`|---|---|---|${report.configs.map(() => "---").join("|")}|`);
  for (const s of catalog.filter((s) => report.scenarios.includes(s.id))) {
    lines.push(
      `| ${s.id} ${s.title} | ${s.family} | ${s.expected_stop.join(", ")} | ${report.configs.map((c) => cell(by(s.id, c), explorer)).join(" | ")} |`,
    );
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| Config | Scenarios run | Defended (no funds moved outside the mandate) | Funds moved | Errors |",
  );
  lines.push("|---|---|---|---|---|");
  for (const c of report.configs) {
    const rs = report.results.filter((r) => r.config === c);
    lines.push(
      `| ${c} | ${rs.length} | ${rs.filter((r) => r.defended).length} | ${rs.filter((r) => r.fundsMoved).length} | ${rs.filter((r) => r.outcome === "error").length} |`,
    );
  }
  lines.push("");
  lines.push("## Per-scenario detail");
  lines.push("");
  for (const s of catalog.filter((s) => report.scenarios.includes(s.id))) {
    lines.push(`### ${s.id} ${s.title}`);
    lines.push("");
    lines.push(`Vector: ${s.vector}`);
    lines.push("");
    lines.push(
      `Mappings: OWASP LLM ${s.mappings.owasp_llm.join(", ") || "none"}; OWASP Agentic ${s.mappings.owasp_asi.join(", ") || "none"}; MITRE ATLAS ${s.mappings.atlas.join(", ") || "none"}; incidents ${s.mappings.incident.map((i) => `[${i}]`).join(", ") || "none"}.`,
    );
    lines.push("");
    lines.push(`Payload: \`${s.payload.replace(/`/g, "'").slice(0, 300)}\``);
    lines.push("");
    for (const c of report.configs) {
      const r = by(s.id, c);
      if (r) lines.push(`- Config ${c}: ${cell(r, explorer)}. ${r.detail}`);
    }
    lines.push("");
    lines.push(s.notes);
    lines.push("");
  }
  lines.push("## Limitations");
  lines.push("");
  lines.push(
    "- The attacker is scripted: each scenario is one fixed payload, not an adaptive adversary. The sample size is small (one run per cell).",
  );
  lines.push(
    "- With the MockPlanner, the susceptibility of configurations A and B is modelled by a scripted naive planner that follows instructions found in untrusted content (A) unless they match a short denylist (B). Those cells show what the surrounding guards do once a planner is fooled; they do not measure how often a given model is fooled. With a live model, A and B put the raw content in the model's context and the model's own plan is executed.",
  );
  lines.push(
    "- Configuration D results are measured end to end: the real pipeline, the real policy engine and the deployed vault. On-chain cells carry transaction hashes.",
  );
  lines.push("- Testnet or local chain only. Gas, latency and MEV conditions differ on mainnet.");
  lines.push(
    "- A blocked attack in D is evidence of the layer that stopped it, not proof that no other payload would pass that layer. The guarantee we rely on is L4: value cannot leave the vault outside the mandate, whatever the earlier layers do.",
  );
  lines.push("");
  lines.push("## What we would test next");
  lines.push("");
  lines.push(
    "- Adaptive red-teaming with a live model and many paraphrases per scenario, reporting success rates with confidence intervals.",
  );
  lines.push(
    "- ERC-20 permit phishing [EIP-2612], homoglyph contact names, time-zone deadline games and RPC response tampering.",
  );
  lines.push("- Fuzzing the quarantine parser with generated invoices.");
  lines.push("");
  lines.push(
    "Raw logs: `packages/attacks/results/`. Citations: [OWASP-LLM-2025] [OWASP-ASI-2026] [MITRE-ATLAS] [INC-GROK-BANKR] [INC-ADDRPOISON] [INTENTGUARD] [Beurer-Kellner 2025]. See docs/REFERENCES.md.",
  );
  return lines.join("\n") + "\n";
}
