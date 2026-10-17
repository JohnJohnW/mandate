import { describe, expect, it } from "vitest";
import { findLookalikes, levenshtein, parseSanctionsFile, screenAddresses } from "../src/index.js";

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });
});

describe("findLookalikes", () => {
  const alice = { address: "0x1234567890abcdef1234567890abcdef12345678", label: "Alice" };
  it("flags the prefix and suffix match", () => {
    const r = findLookalikes("0x1234000000000000000000000000000000005678", [alice]);
    expect(r[0]?.kind).toBe("prefix_suffix_4");
  });
  it("flags a partial match on six characters", () => {
    const r = findLookalikes("0x123456000000000000000000000000000000ffff", [alice]);
    expect(r[0]?.kind).toBe("prefix_suffix_6_partial");
  });
  it("ignores the contact itself and unrelated addresses", () => {
    expect(findLookalikes(alice.address, [alice])).toHaveLength(0);
    expect(findLookalikes("0xffffffffffffffffffffffffffffffffffffffff", [alice])).toHaveLength(0);
  });
});

describe("sanctions screening", () => {
  const file = JSON.stringify({
    source: "t",
    fetchedAt: "2026-10-17T00:00:00Z",
    count: 1,
    addresses: ["0xBAD0000000000000000000000000000000000BAD"],
  });
  it("parses and matches case-insensitively", () => {
    const list = parseSanctionsFile(file);
    const r = screenAddresses(list, ["0xbad0000000000000000000000000000000000bad"], 7n * 86400n);
    expect(r.loaded).toBe(true);
    expect(r.hits).toHaveLength(1);
    expect(r.listFetchedAt).toBe(1_792_195_200n);
  });
  it("reports a missing list as not loaded", () => {
    expect(screenAddresses(undefined, ["0x1"], 1n).loaded).toBe(false);
  });
  it("rejects malformed files", () => {
    expect(() => parseSanctionsFile("{}")).toThrow();
  });
});
