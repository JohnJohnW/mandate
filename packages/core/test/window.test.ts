import { describe, expect, it } from "vitest";
import { applySpend, autonomousRemaining, rollWindow } from "../src/index.js";
import { asset, NOW } from "./helpers.js";
import fixture from "../fixtures/window.json";

describe("fixed window accounting", () => {
  it("keeps spend inside the window", () => {
    const a = asset({ spentInWindow: 5n, windowStart: NOW - 10n, windowSeconds: 100n });
    expect(rollWindow(a, NOW)).toEqual({ spentInWindow: 5n, windowStart: NOW - 10n });
  });
  it("restarts at now once the window has elapsed", () => {
    const a = asset({ spentInWindow: 5n, windowStart: NOW - 100n, windowSeconds: 100n });
    expect(rollWindow(a, NOW)).toEqual({ spentInWindow: 0n, windowStart: NOW });
  });
  it("reports remaining autonomous spend, never negative", () => {
    const a = asset({ spentInWindow: 10n ** 18n, autonomousWindowCap: 5n * 10n ** 16n });
    expect(autonomousRemaining(a, NOW)).toBe(0n);
  });
  it("replays the committed fixture exactly", () => {
    for (const c of fixture.cases) {
      let a = asset({
        autonomousPerTxCap: BigInt(c.autonomousPerTxCap),
        autonomousWindowCap: BigInt(c.autonomousWindowCap),
        windowSeconds: BigInt(c.windowSeconds),
        windowStart: BigInt(c.initialWindowStart),
        spentInWindow: 0n,
      });
      for (const s of c.steps) {
        const now = BigInt(s.now);
        const amount = BigInt(s.amount);
        const w = rollWindow(a, now);
        const allowed =
          amount <= a.autonomousPerTxCap && w.spentInWindow + amount <= a.autonomousWindowCap;
        expect(allowed).toBe(s.allowed);
        a = allowed ? applySpend(a, now, amount) : { ...a, ...w };
        expect(a.spentInWindow.toString()).toBe(s.spentAfter);
        expect(a.windowStart.toString()).toBe(s.windowStartAfter);
      }
    }
  });
});
