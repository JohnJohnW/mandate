import { concatHex, keccak256, stringToHex, type Hex } from "viem";
import { canonicalJSON } from "./canonical.js";

/**
 * Hash-chained, append-only audit log. Each record's hash covers the previous
 * hash and the canonical JSON of the record, so editing or dropping any
 * record breaks every later hash. [NIST-SP800-53 AU-2] [NIST-SP800-53 AU-10]
 * [NIST-SP800-92]
 */
export const GENESIS_HASH: Hex = `0x${"0".repeat(64)}`;

export type AuditEvent =
  | "intent.drafted"
  | "intent.blocked"
  | "intent.simulating"
  | "intent.awaiting_approval"
  | "intent.approved"
  | "intent.rejected"
  | "intent.expired"
  | "intent.submitted"
  | "intent.executed"
  | "intent.reverted"
  | "policy.verdict"
  | "approval.signed"
  | "approval.declined"
  | "chain.receipt"
  | "mandate.changed"
  | "agent.revoked"
  | "vault.paused"
  | "vault.unpaused"
  | "attack.run"
  | "system.startup"
  | "system.error";

export interface AuditRecordInput {
  actor: string;
  event: AuditEvent | string;
  payload: unknown;
}

export interface AuditRecord extends AuditRecordInput {
  seq: number;
  ts: string; // ISO-8601
  prevHash: Hex;
  hash: Hex;
}

export interface AuditStore {
  readAll(): string[];
  append(line: string): void;
}

export class MemoryAuditStore implements AuditStore {
  lines: string[] = [];
  readAll(): string[] {
    return [...this.lines];
  }
  append(line: string): void {
    this.lines.push(line);
  }
}

export function recordHash(prevHash: Hex, record: Omit<AuditRecord, "hash">): Hex {
  return keccak256(concatHex([prevHash, stringToHex(canonicalJSON(record))]));
}

export interface VerifyResult {
  ok: boolean;
  length: number;
  brokenAt?: number;
  detail?: string;
}

export function verifyChain(records: AuditRecord[]): VerifyResult {
  let prev: Hex = GENESIS_HASH;
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.seq !== i)
      return {
        ok: false,
        length: records.length,
        brokenAt: i,
        detail: `sequence gap: expected ${i}, found ${r.seq}`,
      };
    if (r.prevHash.toLowerCase() !== prev.toLowerCase())
      return {
        ok: false,
        length: records.length,
        brokenAt: i,
        detail: "prevHash does not match the previous record",
      };
    const { hash, ...rest } = r;
    const expected = recordHash(prev, rest);
    if (expected.toLowerCase() !== hash.toLowerCase())
      return {
        ok: false,
        length: records.length,
        brokenAt: i,
        detail: "record content does not match its hash",
      };
    prev = hash;
  }
  return { ok: true, length: records.length };
}

export function parseRecords(lines: string[]): AuditRecord[] {
  return lines.filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as AuditRecord);
}

export class AuditLog {
  private records: AuditRecord[];
  private listeners = new Set<(r: AuditRecord) => void>();

  constructor(
    private readonly store: AuditStore,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.records = parseRecords(store.readAll());
  }

  get length(): number {
    return this.records.length;
  }

  get head(): Hex {
    return this.records.length ? this.records[this.records.length - 1]!.hash : GENESIS_HASH;
  }

  all(): AuditRecord[] {
    return [...this.records];
  }

  onAppend(fn: (r: AuditRecord) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  append(input: AuditRecordInput): AuditRecord {
    const prevHash = this.head;
    const body: Omit<AuditRecord, "hash"> = {
      seq: this.records.length,
      ts: this.clock().toISOString(),
      actor: input.actor,
      event: input.event,
      payload: JSON.parse(canonicalJSON(input.payload)) as unknown,
      prevHash,
    };
    const record: AuditRecord = { ...body, hash: recordHash(prevHash, body) };
    this.store.append(JSON.stringify(record));
    this.records.push(record);
    for (const fn of this.listeners) fn(record);
    return record;
  }

  verify(): VerifyResult {
    return verifyChain(this.records);
  }
}
