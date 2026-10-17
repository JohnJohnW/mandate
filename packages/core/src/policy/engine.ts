import type { Intent } from "../intent/schema.js";
import type { Decision, PolicyContext, Reason, Rule, Tier, Verdict } from "./types.js";
import { classifyOnChain } from "./classify.js";
import { mandateBoundsRule } from "./rules/mandate.js";
import { screeningRule } from "./rules/screening.js";
import { poisoningRule } from "./rules/poisoning.js";
import { contractRiskRule } from "./rules/contractRisk.js";
import { provenanceRule } from "./rules/provenance.js";
import { velocityRule } from "./rules/velocity.js";
import { simulationRule } from "./rules/simulation.js";

export const RULES: readonly Rule[] = [
  mandateBoundsRule,
  screeningRule,
  poisoningRule,
  contractRiskRule,
  provenanceRule,
  velocityRule,
  simulationRule,
];

const WEIGHT: Record<Reason["severity"], number> = { info: 0, warn: 10, escalate: 25, deny: 60 };

/**
 * The policy decision point. Pure and deterministic: same intent and context,
 * same verdict. Any DENY wins, then any ESCALATE, then ALLOW. The tier in the
 * verdict is the effective tier: DENY is Tier 3 (forbidden), ESCALATE is
 * Tier 2 (co-sign), ALLOW is Tier 1 (autonomous). [NIST-SP800-207]
 */
export function evaluate(
  intent: Intent,
  ctx: PolicyContext,
  rules: readonly Rule[] = RULES,
): Verdict {
  const chain = classifyOnChain(intent, ctx.mandate, ctx.now, ctx.calldata);
  const reasons: Reason[] = [];
  for (const rule of rules) {
    try {
      reasons.push(...rule(intent, ctx));
    } catch (err) {
      reasons.push({
        rule: rule.name || "unknown_rule",
        severity: "deny",
        message: `rule threw (${err instanceof Error ? err.message : String(err)}); failing closed`,
        citations: [],
      });
    }
  }
  let decision: Decision = "ALLOW";
  if (reasons.some((r) => r.severity === "deny")) decision = "DENY";
  else if (reasons.some((r) => r.severity === "escalate")) decision = "ESCALATE";
  const tier: Tier = decision === "DENY" ? 3 : decision === "ESCALATE" ? 2 : 1;
  const riskScore = Math.min(
    100,
    reasons.reduce((n, r) => n + WEIGHT[r.severity], 0),
  );
  const citations = [...new Set(reasons.flatMap((r) => r.citations))];
  return {
    tier,
    decision,
    reasons,
    riskScore,
    citations,
    chainTier: chain.tier,
    chainReason: chain.reason,
  };
}
