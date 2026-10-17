import type { Rule } from "../types.js";
import { classifyOnChain } from "../classify.js";

const ALLOWLIST_REASONS = new Set(["TargetNotAllowed", "SelectorNotAllowed", "AssetNotEnabled"]);

/**
 * Mandate bounds and allowlists, mirrored from the contract. The chain is the
 * authority; this rule exists so the agent stops early and explains itself.
 * [NIST-SP800-53 AC-3] [NIST-SP800-53 AC-6] [NIST-SP800-207] [OWASP-ASI03]
 */
export const mandateBoundsRule: Rule = (intent, ctx) => {
  const c = classifyOnChain(intent, ctx.mandate, ctx.now, ctx.calldata);
  const rule = ALLOWLIST_REASONS.has(c.reason) ? "allowlists" : "mandate_bounds";
  const citations = ["NIST-SP800-53 AC-3", "NIST-SP800-53 AC-6", "NIST-SP800-207", "OWASP-ASI03"];
  if (c.tier === 3) {
    return [
      {
        rule,
        severity: "deny",
        message: `the vault has no code path for this intent (${c.reason})`,
        citations,
      },
    ];
  }
  if (c.tier === 2) {
    return [
      {
        rule,
        severity: "escalate",
        message: `outside the autonomous mandate (${c.reason}); an owner co-signature is required`,
        citations,
      },
    ];
  }
  return [
    {
      rule,
      severity: "info",
      message: "within the autonomous mandate on current chain state",
      citations,
    },
  ];
};
