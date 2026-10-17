/**
 * SQLite persistence using the Node built-in driver. Schema is documented in
 * docs/DATA_MODEL.md. BigInts are stored as decimal strings.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type IntentState =
  | "Drafted"
  | "Blocked"
  | "Simulating"
  | "AwaitingApproval"
  | "Rejected"
  | "Expired"
  | "Submitted"
  | "Executed"
  | "RevertedOnChain";

export interface IntentRow {
  id: string;
  created_at: string;
  updated_at: string;
  state: IntentState;
  kind: string;
  target: string;
  token: string;
  amount: string;
  data: string;
  data_hash: string;
  nonce: string;
  deadline: string;
  rationale: string;
  rationale_hash: string;
  intent_hash: string | null;
  verdict_json: string | null;
  trace_json: string | null;
  simulation_json: string | null;
  tx_hash: string | null;
  revert_reason: string | null;
  owner_message: string | null;
  source: string;
  tier: number | null;
  agent_sig: string | null;
}

export interface ApprovalRow {
  id: string;
  intent_id: string;
  created_at: string;
  expires_at: string;
  status: "pending" | "approved" | "declined" | "expired" | "consumed";
  owner_sig: string | null;
  approval_deadline: string | null;
  declined_reason: string | null;
  signer: string | null;
}

export interface ContactRow {
  name: string;
  address: string;
  added_at: string;
}

export interface MemoryRow {
  key: string;
  value: string;
  provenance: string;
  origin: string;
  added_at: string;
}

export interface SpendRow {
  id: number;
  ts: string;
  token: string;
  amount: string;
  target: string;
  tier: number;
  intent_id: string;
}

export interface InboundRow {
  id: number;
  ts: string;
  from_addr: string;
  token: string;
  amount: string;
}

export interface QuarantineRow {
  id: string;
  kind: string;
  origin: string;
  text: string;
  parsed_json: string;
  suspected: number;
  matches_json: string;
  created_at: string;
}

export interface PasskeyRow {
  id: string;
  public_key: string;
  counter: number;
  transports: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, state TEXT NOT NULL,
  kind TEXT NOT NULL, target TEXT NOT NULL, token TEXT NOT NULL, amount TEXT NOT NULL, data TEXT NOT NULL,
  data_hash TEXT NOT NULL, nonce TEXT NOT NULL, deadline TEXT NOT NULL, rationale TEXT NOT NULL, rationale_hash TEXT NOT NULL,
  intent_hash TEXT, verdict_json TEXT, trace_json TEXT, simulation_json TEXT, tx_hash TEXT, revert_reason TEXT,
  owner_message TEXT, source TEXT NOT NULL DEFAULT 'chat', tier INTEGER, agent_sig TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES intents(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  status TEXT NOT NULL, owner_sig TEXT, approval_deadline TEXT, declined_reason TEXT, signer TEXT
);
CREATE TABLE IF NOT EXISTS contacts (name TEXT PRIMARY KEY, address TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, value TEXT NOT NULL, provenance TEXT NOT NULL, origin TEXT NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spend (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, token TEXT NOT NULL, amount TEXT NOT NULL, target TEXT NOT NULL, tier INTEGER NOT NULL, intent_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbound (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, from_addr TEXT NOT NULL, token TEXT NOT NULL, amount TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quarantine (id TEXT PRIMARY KEY, kind TEXT NOT NULL, origin TEXT NOT NULL, text TEXT NOT NULL, parsed_json TEXT NOT NULL, suspected INTEGER NOT NULL, matches_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, purpose TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, intent_ids TEXT);
CREATE TABLE IF NOT EXISTS attack_runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, config TEXT NOT NULL, planner TEXT NOT NULL, results_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_intents_state ON intents(state);
CREATE INDEX IF NOT EXISTS idx_spend_ts ON spend(ts);
`;

export class Db {
  readonly sql: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec("PRAGMA journal_mode = WAL;");
    this.sql.exec(SCHEMA);
  }

  // ---- intents
  insertIntent(row: IntentRow): void {
    const cols = Object.keys(row);
    this.sql
      .prepare(
        `INSERT INTO intents (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`,
      )
      .run(row as never);
  }
  updateIntent(id: string, patch: Partial<IntentRow>): void {
    const entries = Object.entries({ ...patch, updated_at: new Date().toISOString() });
    this.sql
      .prepare(
        `UPDATE intents SET ${entries.map(([k]) => `${k} = @${k}`).join(", ")} WHERE id = @id`,
      )
      .run({ ...Object.fromEntries(entries), id } as never);
  }
  getIntent(id: string): IntentRow | undefined {
    return this.sql.prepare("SELECT * FROM intents WHERE id = ?").get(id) as IntentRow | undefined;
  }
  listIntents(limit = 100): IntentRow[] {
    return this.sql
      .prepare("SELECT * FROM intents ORDER BY created_at DESC LIMIT ?")
      .all(limit) as unknown as IntentRow[];
  }

  // ---- approvals
  insertApproval(row: ApprovalRow): void {
    const cols = Object.keys(row);
    this.sql
      .prepare(
        `INSERT INTO approvals (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`,
      )
      .run(row as never);
  }
  updateApproval(id: string, patch: Partial<ApprovalRow>): void {
    const entries = Object.entries(patch);
    this.sql
      .prepare(
        `UPDATE approvals SET ${entries.map(([k]) => `${k} = @${k}`).join(", ")} WHERE id = @id`,
      )
      .run({ ...Object.fromEntries(entries), id } as never);
  }
  getApproval(id: string): ApprovalRow | undefined {
    return this.sql.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as
      ApprovalRow | undefined;
  }
  getApprovalByIntent(intentId: string): ApprovalRow | undefined {
    return this.sql
      .prepare("SELECT * FROM approvals WHERE intent_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(intentId) as ApprovalRow | undefined;
  }
  listApprovals(): ApprovalRow[] {
    return this.sql
      .prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200")
      .all() as unknown as ApprovalRow[];
  }

  // ---- contacts
  upsertContact(name: string, address: string): void {
    this.sql
      .prepare(
        "INSERT INTO contacts (name, address, added_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET address = excluded.address",
      )
      .run(name, address.toLowerCase(), new Date().toISOString());
  }
  listContacts(): ContactRow[] {
    return this.sql
      .prepare("SELECT * FROM contacts ORDER BY name")
      .all() as unknown as ContactRow[];
  }
  deleteContact(name: string): void {
    this.sql.prepare("DELETE FROM contacts WHERE name = ?").run(name);
  }

  // ---- memory
  setMemory(key: string, value: string, provenance: string, origin: string): void {
    this.sql
      .prepare(
        "INSERT INTO memory (key, value, provenance, origin, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, provenance = excluded.provenance, origin = excluded.origin, added_at = excluded.added_at",
      )
      .run(key, value, provenance, origin, new Date().toISOString());
  }
  listMemory(): MemoryRow[] {
    return this.sql.prepare("SELECT * FROM memory ORDER BY key").all() as unknown as MemoryRow[];
  }
  deleteMemory(key: string): void {
    this.sql.prepare("DELETE FROM memory WHERE key = ?").run(key);
  }

  // ---- spend and inbound
  insertSpend(row: Omit<SpendRow, "id">): void {
    this.sql
      .prepare(
        "INSERT INTO spend (ts, token, amount, target, tier, intent_id) VALUES (@ts, @token, @amount, @target, @tier, @intent_id)",
      )
      .run(row as never);
  }
  listSpend(limit = 500): SpendRow[] {
    return this.sql
      .prepare("SELECT * FROM spend ORDER BY ts DESC LIMIT ?")
      .all(limit) as unknown as SpendRow[];
  }
  insertInbound(row: Omit<InboundRow, "id">): void {
    this.sql
      .prepare(
        "INSERT INTO inbound (ts, from_addr, token, amount) VALUES (@ts, @from_addr, @token, @amount)",
      )
      .run(row as never);
  }
  listInbound(limit = 500): InboundRow[] {
    return this.sql
      .prepare("SELECT * FROM inbound ORDER BY ts DESC LIMIT ?")
      .all(limit) as unknown as InboundRow[];
  }

  // ---- quarantine
  insertQuarantine(row: QuarantineRow): void {
    const cols = Object.keys(row);
    this.sql
      .prepare(
        `INSERT INTO quarantine (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`,
      )
      .run(row as never);
  }
  getQuarantine(id: string): QuarantineRow | undefined {
    return this.sql.prepare("SELECT * FROM quarantine WHERE id = ?").get(id) as
      QuarantineRow | undefined;
  }

  // ---- passkeys
  insertPasskey(row: PasskeyRow): void {
    this.sql
      .prepare(
        "INSERT INTO passkeys (id, public_key, counter, transports, created_at) VALUES (@id, @public_key, @counter, @transports, @created_at)",
      )
      .run(row as never);
  }
  listPasskeys(): PasskeyRow[] {
    return this.sql.prepare("SELECT * FROM passkeys").all() as unknown as PasskeyRow[];
  }
  updatePasskeyCounter(id: string, counter: number): void {
    this.sql.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").run(counter, id);
  }
  setChallenge(id: string, challenge: string, purpose: string): void {
    this.sql
      .prepare(
        "INSERT INTO challenges (id, challenge, purpose, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET challenge = excluded.challenge, purpose = excluded.purpose, created_at = excluded.created_at",
      )
      .run(id, challenge, purpose, new Date().toISOString());
  }
  takeChallenge(id: string): { challenge: string; purpose: string } | undefined {
    const row = this.sql
      .prepare("SELECT challenge, purpose, created_at FROM challenges WHERE id = ?")
      .get(id) as { challenge: string; purpose: string; created_at: string } | undefined;
    if (!row) return undefined;
    this.sql.prepare("DELETE FROM challenges WHERE id = ?").run(id);
    if (Date.now() - Date.parse(row.created_at) > 5 * 60_000) return undefined;
    return row;
  }

  // ---- chat
  insertChat(role: string, text: string, intentIds: string[] = []): void {
    this.sql
      .prepare("INSERT INTO chat (ts, role, text, intent_ids) VALUES (?, ?, ?, ?)")
      .run(new Date().toISOString(), role, text, JSON.stringify(intentIds));
  }
  listChat(
    limit = 200,
  ): { id: number; ts: string; role: string; text: string; intent_ids: string }[] {
    return this.sql
      .prepare("SELECT * FROM chat ORDER BY id DESC LIMIT ?")
      .all(limit)
      .reverse() as never;
  }

  // ---- attack runs
  insertAttackRun(row: {
    id: string;
    started_at: string;
    finished_at: string | null;
    config: string;
    planner: string;
    results_json: string;
  }): void {
    this.sql
      .prepare(
        "INSERT INTO attack_runs (id, started_at, finished_at, config, planner, results_json) VALUES (@id, @started_at, @finished_at, @config, @planner, @results_json) ON CONFLICT(id) DO UPDATE SET finished_at = excluded.finished_at, results_json = excluded.results_json",
      )
      .run(row as never);
  }
  listAttackRuns(): {
    id: string;
    started_at: string;
    finished_at: string | null;
    config: string;
    planner: string;
    results_json: string;
  }[] {
    return this.sql
      .prepare("SELECT * FROM attack_runs ORDER BY started_at DESC LIMIT 50")
      .all() as never;
  }

  close(): void {
    this.sql.close();
  }
}
