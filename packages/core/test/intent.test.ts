import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import {
  APPROVAL_TYPEHASH,
  INTENT_KIND_HASH,
  INTENT_TYPEHASH,
  INTENT_TYPE_STRING,
  buildIntent,
  intentDraftSchema,
  intentHash,
  intentSchema,
  kindName,
  selectorOf,
} from "../src/index.js";
import { ALICE, VAULT, intent } from "./helpers.js";
import fixture from "../fixtures/eip712.json";

describe("intent kinds", () => {
  it("hashes kind names the way the contract does", () => {
    expect(INTENT_KIND_HASH.TRANSFER_NATIVE).toBe(keccak256(toBytes("TRANSFER_NATIVE")));
    expect(kindName(INTENT_KIND_HASH.CALL)).toBe("CALL");
    expect(kindName(`0x${"1".repeat(64)}`)).toBeUndefined();
  });
});

describe("intent schema", () => {
  it("accepts a well-formed intent and coerces amounts to bigint", () => {
    const parsed = intentSchema.parse({ ...intent(), amount: "123" });
    expect(parsed.amount).toBe(123n);
  });
  it("rejects unknown kinds and bad addresses", () => {
    expect(() => intentSchema.parse({ ...intent(), kind: `0x${"9".repeat(64)}` })).toThrow();
    expect(() => intentSchema.parse({ ...intent(), target: "0x123" })).toThrow();
  });
  it("builds an intent from a draft with the right dataHash per kind", () => {
    const transfer = buildIntent(
      intentDraftSchema.parse({
        kind: "TRANSFER_NATIVE",
        target: ALICE,
        amount: "1",
        rationale: "pay Alice",
      }),
      { nonce: 3n, deadline: 10n },
    );
    expect(transfer.dataHash).toBe(`0x${"0".repeat(64)}`);
    expect(transfer.rationaleHash).toBe(keccak256(toBytes("pay Alice")));
    const call = buildIntent(
      intentDraftSchema.parse({
        kind: "CALL",
        target: ALICE,
        amount: "1",
        data: "0xd0e30db0",
        rationale: "wrap",
      }),
      { nonce: 3n, deadline: 10n },
    );
    expect(call.dataHash).toBe(keccak256("0xd0e30db0"));
    expect(selectorOf("0xd0e30db0abcd")).toBe("0xd0e30db0");
    expect(selectorOf("0x")).toBeUndefined();
  });
});

describe("EIP-712", () => {
  it("has the expected type string and type hash", () => {
    expect(INTENT_TYPE_STRING).toBe(
      "Intent(bytes32 kind,address target,address token,uint256 amount,bytes32 dataHash,uint256 nonce,uint256 deadline,bytes32 rationaleHash)",
    );
    expect(INTENT_TYPEHASH).toBe(keccak256(toBytes(INTENT_TYPE_STRING)));
    expect(APPROVAL_TYPEHASH).toBe(
      keccak256(toBytes("Approval(bytes32 intentHash,uint256 deadline)")),
    );
  });
  it("matches the committed fixture (shared with the Foundry suite)", () => {
    expect(fixture.intentTypeHash).toBe(INTENT_TYPEHASH);
    const s = fixture.sample;
    const h = intentHash(intentSchema.parse(s.intent), s.chainId, s.vault as `0x${string}`);
    expect(h).toBe(s.intentHash);
  });
  it("changes the digest when any field changes", () => {
    const a = intentHash(intent(), 84532, VAULT);
    const b = intentHash(intent({ amount: 1n }), 84532, VAULT);
    const c = intentHash(intent(), 11155111, VAULT);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
