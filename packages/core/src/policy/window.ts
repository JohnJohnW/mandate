import type { AssetMandate } from "./types.js";

/**
 * Fixed-window spend accounting. This mirrors MandateVault exactly:
 * when now >= windowStart + windowSeconds the window restarts at now with
 * zero spent. Fixtures in fixtures/window.json pin both sides to the same
 * answers. See ADR-004 for why a fixed window and not a sliding one.
 */
export interface WindowState {
  spentInWindow: bigint;
  windowStart: bigint;
}

export function rollWindow(asset: AssetMandate, now: bigint): WindowState {
  if (now >= asset.windowStart + asset.windowSeconds) {
    return { spentInWindow: 0n, windowStart: now };
  }
  return { spentInWindow: asset.spentInWindow, windowStart: asset.windowStart };
}

/** Spend remaining for autonomous execution after a window roll. */
export function autonomousRemaining(asset: AssetMandate, now: bigint): bigint {
  const w = rollWindow(asset, now);
  return w.spentInWindow >= asset.autonomousWindowCap
    ? 0n
    : asset.autonomousWindowCap - w.spentInWindow;
}

/** Applies a spend the way the contract does (effects after a successful check). */
export function applySpend(asset: AssetMandate, now: bigint, amount: bigint): AssetMandate {
  const w = rollWindow(asset, now);
  return { ...asset, windowStart: w.windowStart, spentInWindow: w.spentInWindow + amount };
}
