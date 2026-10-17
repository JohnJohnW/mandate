import type { Rule } from "../types.js";

/**
 * Velocity and anomaly flags. Count and value over the last hour and day
 * against the agent's own baseline, novel counterparties and quiet hours.
 * Flags only; this rule never allows anything by itself. [OWASP-ASI02]
 * [NIST-AI-RMF Measure]
 */
export const velocityRule: Rule = (intent, ctx) => {
  const citations = ["OWASP-ASI02", "NIST-AI-RMF"];
  const out = [] as ReturnType<Rule>;
  const hour = 3600n;
  const day = 86400n;
  const lastHour = ctx.spendHistory.filter((s) => ctx.now - s.ts < hour);
  const lastDay = ctx.spendHistory.filter((s) => ctx.now - s.ts < day);
  const older = ctx.spendHistory.filter((s) => ctx.now - s.ts >= day);

  if (lastHour.length + 1 > ctx.params.maxPerHour) {
    out.push({
      rule: "velocity",
      severity: "warn",
      message: `${lastHour.length + 1} intents in the last hour exceeds the ${ctx.params.maxPerHour} per hour flag threshold`,
      citations,
    });
  }
  if (older.length > 0) {
    const span = ctx.now - older.reduce((m, s) => (s.ts < m ? s.ts : m), ctx.now);
    const days = span / day > 0n ? span / day : 1n;
    const baselinePerDay = BigInt(older.length) / days;
    if (baselinePerDay > 0n && BigInt(lastDay.length + 1) > baselinePerDay * 3n) {
      out.push({
        rule: "velocity",
        severity: "warn",
        message: `${lastDay.length + 1} intents today is more than three times the baseline of ${baselinePerDay} per day`,
        citations,
      });
    }
  }
  const target = intent.target.toLowerCase();
  const seen =
    ctx.addressBook.some((c) => c.address.toLowerCase() === target) ||
    ctx.spendHistory.some((s) => s.target.toLowerCase() === target);
  if (!seen) {
    out.push({
      rule: "velocity",
      severity: "warn",
      message: "novel counterparty: never paid before and not in the address book",
      citations,
    });
  }
  const q = ctx.params.quietHoursUtc;
  if (q) {
    const h = Number((ctx.now / hour) % 24n);
    const inQuiet = q.start <= q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end;
    if (inQuiet)
      out.push({
        rule: "velocity",
        severity: "warn",
        message: `intent falls in quiet hours (${q.start}:00 to ${q.end}:00 UTC)`,
        citations,
      });
  }
  if (out.length === 0)
    out.push({
      rule: "velocity",
      severity: "info",
      message: "no velocity or anomaly flags",
      citations,
    });
  return out;
};
