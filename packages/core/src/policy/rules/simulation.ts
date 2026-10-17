import type { Rule } from "../types.js";

/**
 * Pre-flight simulation result. A missing simulation is fine for a draft
 * verdict, but a deviation between expected and observed asset deltas denies.
 * [OWASP-LLM05]
 */
export const simulationRule: Rule = (_intent, ctx) => {
  const citations = ["OWASP-LLM05"];
  const s = ctx.simulation;
  if (!s)
    return [{ rule: "simulation", severity: "info", message: "not yet simulated", citations }];
  if (s.method === "none")
    return [
      {
        rule: "simulation",
        severity: "deny",
        message: "simulation unavailable; refusing to transact (fail closed)",
        citations,
      },
    ];
  if (!s.ok)
    return [
      {
        rule: "simulation",
        severity: "deny",
        message: `simulation reverted: ${s.revertReason ?? "unknown reason"}`,
        citations,
      },
    ];
  if (s.deviation)
    return [
      {
        rule: "simulation",
        severity: "deny",
        message: "simulated asset deltas deviate from the intent",
        citations,
      },
    ];
  return [
    {
      rule: "simulation",
      severity: "info",
      message: `simulation (${s.method}) matches the intent`,
      citations,
    },
  ];
};
