"use client";
import { useEffect, useState } from "react";
import { API_URL, api, type AuditRecord } from "@/lib/api";
import { useLive } from "@/lib/live";
import { Card } from "@/components/ui";

interface VerifyResult {
  ok: boolean;
  length: number;
  brokenAt?: number;
  detail?: string;
}

export default function AuditPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [head, setHead] = useState("");
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [tamper, setTamper] = useState<{ edited: number; result: VerifyResult } | null>(null);
  const [filter, setFilter] = useState("");
  const load = () =>
    api<{ head: string; length: number; records: AuditRecord[] }>("/audit?limit=300")
      .then((r) => {
        setRecords(r.records);
        setHead(r.head);
      })
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  useLive(["audit.appended"], load);

  const runVerify = async () => setVerify(await api<VerifyResult>("/audit/verify"));
  const runTamper = async () => {
    const copy = JSON.parse(JSON.stringify(records)) as AuditRecord[];
    const idx = Math.max(0, copy.length - 3);
    const rec = copy[idx];
    if (!rec) return;
    const p = (rec.payload ?? {}) as Record<string, unknown>;
    rec.payload = { ...p, amount: "999999999999999999", tampered: true };
    const result = await api<VerifyResult>("/audit/verify", {
      method: "POST",
      body: JSON.stringify(copy),
    });
    setTamper({ edited: rec.seq, result });
  };

  const shown = records.filter(
    (r) =>
      !filter ||
      r.event.includes(filter) ||
      r.actor.includes(filter) ||
      JSON.stringify(r.payload).includes(filter),
  );

  return (
    <div className="space-y-4">
      <header className="row justify-between">
        <div>
          <h1 className="text-xl font-semibold">Audit log</h1>
          <p className="text-sm muted">
            Append-only, hash-chained. Each hash covers the previous hash and the canonical JSON of
            the record, so an edit or a dropped record breaks every later hash.
          </p>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={runVerify}>
            Verify chain
          </button>
          <button className="btn" onClick={runTamper}>
            Tamper demo
          </button>
          <a className="btn" href={`${API_URL}/audit/export`}>
            Export JSONL
          </a>
        </div>
      </header>
      <div className="grid grid-cols-3 gap-4">
        <Card title="Chain head">
          <div className="text-xs mono break-all">{head}</div>
          <div className="text-xs muted mt-1">{records.length} records shown</div>
        </Card>
        <Card title="Verification">
          {verify ? (
            <div className={`badge ${verify.ok ? "badge-green" : "badge-red"}`}>
              {verify.ok
                ? `chain intact, ${verify.length} records`
                : `broken at ${verify.brokenAt}: ${verify.detail}`}
            </div>
          ) : (
            <div className="muted text-sm">
              Press Verify chain to recompute every hash from genesis.
            </div>
          )}
        </Card>
        <Card title="Tamper demo">
          {tamper ? (
            <div className={`badge ${tamper.result.ok ? "badge-red" : "badge-green"}`}>
              {tamper.result.ok
                ? "edit went undetected (this should never happen)"
                : `edited record ${tamper.edited} in a copy: verification fails at ${tamper.result.brokenAt}`}
            </div>
          ) : (
            <div className="muted text-sm">
              Edits one record in a copy of the log and asks the server to verify the copy. The
              stored log is untouched.
            </div>
          )}
        </Card>
      </div>
      <Card
        title="Records"
        right={
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="filter by event, actor or text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        }
      >
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Actor</th>
              <th>Event</th>
              <th>Payload</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {[...shown].reverse().map((r) => (
              <tr key={r.seq}>
                <td className="mono">{r.seq}</td>
                <td className="muted whitespace-nowrap">{new Date(r.ts).toLocaleTimeString()}</td>
                <td>{r.actor}</td>
                <td className="mono">{r.event}</td>
                <td className="mono text-[11px] break-all max-w-[560px]">
                  {JSON.stringify(r.payload).slice(0, 300)}
                </td>
                <td className="mono text-[11px]">{r.hash.slice(0, 14)}...</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
