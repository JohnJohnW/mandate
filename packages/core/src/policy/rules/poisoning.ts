import type { Rule } from "../types.js";
import { findLookalikes } from "../../address/similarity.js";

/**
 * Address poisoning check. A target that shares the first and last four hex
 * characters with a known contact but is not that contact is denied; near
 * misses are flagged; senders of dust that are not contacts are escalated.
 * [INC-ADDRPOISON]
 */
export const poisoningRule: Rule = (intent, ctx) => {
  const citations = ["INC-ADDRPOISON"];
  const target = intent.target.toLowerCase();
  const known = [
    ...ctx.addressBook.map((c) => ({ address: c.address.toLowerCase(), label: c.name })),
    ...ctx.spendHistory.map((s) => ({
      address: s.target.toLowerCase(),
      label: "past counterparty",
    })),
  ];
  if (known.some((k) => k.address === target)) {
    return [
      {
        rule: "address_poisoning",
        severity: "info",
        message: "target is a known contact or past counterparty",
        citations,
      },
    ];
  }
  const out = [] as ReturnType<Rule>;
  const lookalikes = findLookalikes(target, known);
  for (const l of lookalikes) {
    if (l.kind === "prefix_suffix_4") {
      out.push({
        rule: "address_poisoning",
        severity: "deny",
        message: `target matches the first and last 4 hex characters of ${l.label} (${l.address}) but is a different address: classic poisoning pattern`,
        citations,
      });
    } else {
      out.push({
        rule: "address_poisoning",
        severity: "warn",
        message: `target resembles ${l.label} (${l.address}), edit distance ${l.distance}`,
        citations,
      });
    }
  }
  const dust = ctx.inboundHistory.filter((i) => i.from.toLowerCase() === target);
  for (const d of dust) {
    const threshold = ctx.params.dustThreshold[d.token.toLowerCase()];
    if (threshold !== undefined && d.amount <= threshold) {
      out.push({
        rule: "address_poisoning",
        severity: "escalate",
        message:
          "target previously sent a dust transfer and is not in the address book; owner confirmation required",
        citations,
      });
      break;
    }
  }
  if (out.length === 0)
    out.push({
      rule: "address_poisoning",
      severity: "info",
      message: "no look-alike or dust pattern",
      citations,
    });
  return out;
};
