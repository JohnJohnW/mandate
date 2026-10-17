import { describe, expect, it } from "vitest";
import {
  AuditLog,
  GENESIS_HASH,
  MemoryAuditStore,
  canonicalJSON,
  parseRecords,
  verifyChain,
} from "../src/index.js";

function makeLog() {
  const store = new MemoryAuditStore();
  let t = 0;
  const log = new AuditLog(store, () => new Date(1_800_000_000_000 + t++ * 1000));
  log.append({ actor: "agent", event: "intent.drafted", payload: { id: "i1", amount: 5n } });
  log.append({
    actor: "policy",
    event: "policy.verdict",
    payload: { id: "i1", decision: "ALLOW" },
  });
  log.append({ actor: "chain", event: "intent.executed", payload: { id: "i1", tx: "0xabc" } });
  return { store, log };
}

describe("canonical JSON", () => {
  it("sorts keys, stringifies bigints and drops undefined", () => {
    expect(canonicalJSON({ b: 1n, a: [{ z: 1, y: undefined }], c: null })).toBe(
      '{"a":[{"z":1}],"b":"1","c":null}',
    );
  });
});

describe("audit log", () => {
  it("chains hashes from genesis and verifies", () => {
    const { log } = makeLog();
    const recs = log.all();
    expect(recs[0]?.prevHash).toBe(GENESIS_HASH);
    expect(recs[1]?.prevHash).toBe(recs[0]?.hash);
    expect(log.verify()).toEqual({ ok: true, length: 3 });
    expect(log.head).toBe(recs[2]?.hash);
  });
  it("detects an edited payload", () => {
    const { store } = makeLog();
    const recs = parseRecords(store.readAll());
    (recs[1]!.payload as { decision: string }).decision = "DENY";
    const r = verifyChain(recs);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(1);
  });
  it("detects a dropped record", () => {
    const { store } = makeLog();
    const recs = parseRecords(store.readAll());
    recs.splice(1, 1);
    const r = verifyChain(recs);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(1);
  });
  it("detects a reordered record", () => {
    const { store } = makeLog();
    const recs = parseRecords(store.readAll());
    [recs[1], recs[2]] = [recs[2]!, recs[1]!];
    expect(verifyChain(recs).ok).toBe(false);
  });
  it("detects an appended forged record with a wrong prevHash", () => {
    const { store } = makeLog();
    const recs = parseRecords(store.readAll());
    recs.push({ ...recs[2]!, seq: 3, prevHash: GENESIS_HASH });
    expect(verifyChain(recs).ok).toBe(false);
  });
  it("reloads from the store and continues the chain", () => {
    const { store, log } = makeLog();
    const again = new AuditLog(store);
    expect(again.length).toBe(3);
    again.append({ actor: "owner", event: "agent.revoked", payload: {} });
    expect(again.verify().ok).toBe(true);
    expect(again.all()[3]?.prevHash).toBe(log.head);
  });
  it("notifies listeners on append", () => {
    const { log } = makeLog();
    const seen: string[] = [];
    const off = log.onAppend((r) => seen.push(r.event));
    log.append({ actor: "x", event: "system.startup", payload: {} });
    off();
    log.append({ actor: "x", event: "system.startup", payload: {} });
    expect(seen).toEqual(["system.startup"]);
  });
});
