import type { Rule } from "../types.js";

/**
 * Counterparty screening against the OFAC SDN digital-currency address set and,
 * where available, an on-chain sanctions oracle. Fails closed: a missing or
 * stale list denies. [OFAC-SDN] [FATF-R15] [NIST-SP800-53 SI-10]
 */
export const screeningRule: Rule = (_intent, ctx) => {
  const s = ctx.screening;
  const citations = ["OFAC-SDN", "FATF-R15"];
  if (!s.loaded || s.listFetchedAt === undefined) {
    return [
      {
        rule: "screening",
        severity: "deny",
        message: "sanctions list failed to load; refusing to transact (fail closed)",
        citations,
      },
    ];
  }
  const age = ctx.now - s.listFetchedAt;
  if (age > s.maxAgeSeconds) {
    return [
      {
        rule: "screening",
        severity: "deny",
        message: `sanctions list is ${Number(age / 86400n)} days old, older than the ${Number(s.maxAgeSeconds / 86400n)} day limit; refusing to transact (fail closed)`,
        citations,
      },
    ];
  }
  if (s.hits.length > 0) {
    return [
      {
        rule: "screening",
        severity: "deny",
        message: `counterparty matches the sanctions list: ${s.hits.join(", ")}`,
        citations,
      },
    ];
  }
  if (s.oracleSanctioned === true) {
    return [
      {
        rule: "screening",
        severity: "deny",
        message: "on-chain sanctions oracle reports the counterparty as sanctioned",
        citations: [...citations, "CHAINALYSIS-ORACLE"],
      },
    ];
  }
  return [
    {
      rule: "screening",
      severity: "info",
      message: `no sanctions match (${s.listSize} addresses, list ${Number(age / 3600n)} h old)`,
      citations,
    },
  ];
};
