import type { Rule } from "../types.js";
import type { Provenance } from "../../provenance/types.js";

/**
 * Provenance rule. Values that came out of untrusted content may fill a slot
 * only if the owner stated them; otherwise the owner must confirm. Decoded or
 * translated content can never fill a slot. Content that looked like
 * instructions denies outright. [OWASP-LLM01] [OWASP-ASI01] [OWASP-ASI06]
 * [Beurer-Kellner 2025] [CaMeL] [INC-GROK-BANKR]
 */
export const provenanceRule: Rule = (intent, ctx) => {
  const citations = ["OWASP-LLM01", "OWASP-ASI01", "OWASP-ASI06", "Beurer-Kellner 2025", "CaMeL"];
  const out = [] as ReturnType<Rule>;

  const injected = ctx.untrustedInputs.filter((u) => u.suspectedInjection);
  if (injected.length > 0) {
    out.push({
      rule: "provenance",
      severity: "deny",
      message: `untrusted content contained instruction-like patterns (${injected.map((u) => `${u.origin}: ${u.matches.join("/")}`).join("; ")}); intent discarded`,
      citations: [...citations, "INC-GROK-BANKR"],
    });
  }

  const check = (field: string, p: Provenance, matchesOwner: boolean) => {
    if (p.source === "decoded") {
      out.push({
        rule: "decoded_content",
        severity: "deny",
        message: `${field} was produced by decoding or translating content (${p.origin}); decoded content is data, never an instruction`,
        citations: ["INC-GROK-BANKR", "OWASP-LLM01"],
      });
      return;
    }
    if (p.suspectedInjection) {
      out.push({
        rule: "provenance",
        severity: "deny",
        message: `${field} came from content flagged as instruction-like (${p.origin})`,
        citations,
      });
      return;
    }
    if (p.source === "untrusted" || p.source === "memory") {
      if (matchesOwner) {
        out.push({
          rule: "provenance",
          severity: "info",
          message: `${field} came from ${p.source} content (${p.origin}) and matches what the owner stated`,
          citations,
        });
      } else {
        out.push({
          rule: "provenance",
          severity: "escalate",
          message: `${field} came from ${p.source} content (${p.origin}) and the owner did not state it; owner confirmation required`,
          citations,
        });
      }
    }
  };

  const os = ctx.ownerStatement;
  check(
    "target",
    ctx.provenance.target,
    os?.targets.includes(intent.target.toLowerCase()) ?? false,
  );
  check("amount", ctx.provenance.amount, os?.amounts.some((a) => a === intent.amount) ?? false);
  if (ctx.provenance.data) check("calldata", ctx.provenance.data, false);

  if (out.length === 0)
    out.push({
      rule: "provenance",
      severity: "info",
      message: "target and amount come from the owner or chain state",
      citations,
    });
  return out;
};
