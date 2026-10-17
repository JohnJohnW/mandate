import { describe, expect, it } from "vitest";
import {
  INTENT_KIND_HASH,
  MAX_UINT256,
  ZERO_ADDRESS,
  classifyOnChain,
  dataHashOf,
} from "../src/index.js";
import { AGENT, ALICE, NOW, STRANGER, USDC, WETH, asset, intent, mandate } from "./helpers.js";

describe("classifyOnChain mirrors the vault", () => {
  it("is Tier 1 inside the mandate", () => {
    expect(classifyOnChain(intent(), mandate(), NOW)).toEqual({ tier: 1, reason: "WithinMandate" });
  });
  it("is Tier 3 when paused, inactive, expired, or the nonce is wrong", () => {
    expect(classifyOnChain(intent(), mandate({ paused: true }), NOW).reason).toBe("EnforcedPause");
    expect(classifyOnChain(intent(), mandate({ active: false }), NOW).reason).toBe(
      "AgentNotActive",
    );
    expect(classifyOnChain(intent(), mandate({ expiry: NOW - 1n }), NOW).reason).toBe(
      "MandateExpired",
    );
    expect(classifyOnChain(intent({ deadline: NOW - 1n }), mandate(), NOW).reason).toBe(
      "IntentExpired",
    );
    expect(classifyOnChain(intent({ nonce: 5n }), mandate(), NOW).reason).toBe("BadNonce");
  });
  it("is Tier 2 for a non-allowlisted target within the co-sign cap", () => {
    expect(classifyOnChain(intent({ target: STRANGER }), mandate(), NOW)).toEqual({
      tier: 2,
      reason: "TargetNotAllowed",
    });
  });
  it("is Tier 2 above the per-tx cap and Tier 3 above the co-sign cap", () => {
    expect(classifyOnChain(intent({ amount: 2n * 10n ** 16n }), mandate(), NOW).reason).toBe(
      "AbovePerTxCap",
    );
    expect(classifyOnChain(intent({ amount: 2n * 10n ** 18n }), mandate(), NOW)).toEqual({
      tier: 3,
      reason: "AboveCoSignCap",
    });
  });
  it("is Tier 2 when the window would be exhausted", () => {
    const m = mandate();
    m.assets[ZERO_ADDRESS] = asset({ spentInWindow: 46n * 10n ** 15n });
    expect(classifyOnChain(intent(), m, NOW).reason).toBe("AboveWindowCap");
    // and rolls over once the window has elapsed
    m.assets[ZERO_ADDRESS] = asset({ spentInWindow: 46n * 10n ** 15n, windowStart: NOW - 90000n });
    expect(classifyOnChain(intent(), m, NOW).tier).toBe(1);
  });
  it("requires an allowlisted (target, selector) for CALL and never a missing calldata", () => {
    const data = "0xd0e30db0";
    const call = intent({
      kind: INTENT_KIND_HASH.CALL,
      target: WETH,
      dataHash: dataHashOf(data),
      amount: 10n ** 15n,
    });
    expect(classifyOnChain(call, mandate(), NOW, data).tier).toBe(1);
    expect(classifyOnChain(call, mandate(), NOW).reason).toBe("CalldataMissing");
    expect(classifyOnChain(call, mandate(), NOW, "0xa9059cbb").reason).toBe("SelectorNotAllowed");
    expect(classifyOnChain({ ...call, target: STRANGER }, mandate(), NOW, data).reason).toBe(
      "SelectorNotAllowed",
    );
  });
  it("never permits an unlimited approval, even with an approval", () => {
    const i = intent({
      kind: INTENT_KIND_HASH.APPROVE_ERC20,
      token: USDC,
      target: ALICE,
      amount: MAX_UINT256,
    });
    expect(classifyOnChain(i, mandate(), NOW)).toEqual({ tier: 3, reason: "UnlimitedApproval" });
  });
  it("only lets petty cash go to the agent itself", () => {
    const ok = intent({
      kind: INTENT_KIND_HASH.TOPUP_PETTY_CASH,
      token: USDC,
      target: AGENT,
      amount: 1_000_000n,
    });
    expect(classifyOnChain(ok, mandate(), NOW).tier).toBe(1);
    const bad = { ...ok, target: ALICE };
    expect(classifyOnChain(bad, mandate(), NOW).reason).toBe("PettyCashTargetNotAgent");
  });
  it("rejects a disabled asset and a token mismatch", () => {
    expect(
      classifyOnChain(
        intent({ token: WETH, kind: INTENT_KIND_HASH.TRANSFER_ERC20 }),
        mandate(),
        NOW,
      ).reason,
    ).toBe("AssetNotEnabled");
    expect(classifyOnChain(intent({ token: USDC }), mandate(), NOW).reason).toBe("TokenMismatch");
  });
});
