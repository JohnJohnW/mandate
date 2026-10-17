"use client";
import { useEffect, useState } from "react";
import { api, ensureOwnerSession, type IntentView } from "@/lib/api";
import { useConfig, useLive } from "@/lib/live";
import { Card, IntentSummary, LayerStrip } from "@/components/ui";

interface ApprovalRow {
  id: string;
  intent_id: string;
  created_at: string;
  expires_at: string;
  status: string;
  declined_reason: string | null;
  signer: string | null;
  intent: IntentView;
}

export default function ApprovalsPage() {
  const cfg = useConfig();
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = () =>
    api<ApprovalRow[]>("/approvals")
      .then(setRows)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  useLive(["approval.created", "approval.updated", "intent.updated"], load);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const act = async (id: string, action: "approve" | "decline") => {
    if (!cfg) return;
    setBusy(id);
    setErr(null);
    try {
      await ensureOwnerSession(cfg);
      if (action === "decline") {
        const reason = window.prompt("Reason for declining (recorded in the audit log)") ?? "";
        if (!reason) return;
        await api(
          `/approvals/${id}/decline`,
          { method: "POST", body: JSON.stringify({ reason }) },
          true,
        );
      } else {
        await api(`/approvals/${id}/approve`, { method: "POST", body: JSON.stringify({}) }, true);
      }
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pending = rows.filter((r) => r.status === "pending");
  const past = rows.filter((r) => r.status !== "pending");
  void tick;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="text-sm muted">
          Tier 2 requests. Approving signs an EIP-712 Approval bound to this intent hash and a
          deadline; the vault verifies it on-chain.{" "}
          {cfg?.ownerMode === "local"
            ? "Local owner mode: the server-held owner key signs after you authenticate."
            : "MetaMask owner mode."}
        </p>
      </header>
      {err ? (
        <div className="panel p-3 text-sm" style={{ color: "var(--red)" }}>
          {err}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4">
        {pending.length === 0 ? (
          <Card>
            <div className="muted text-sm">
              Nothing waiting. The agent escalates when an intent is above its autonomous caps or to
              a counterparty outside the allowlist.
            </div>
          </Card>
        ) : null}
        {pending.map((r) => {
          const left = Math.max(0, Math.floor((Date.parse(r.expires_at) - Date.now()) / 1000));
          const v = r.intent;
          return (
            <Card
              key={r.id}
              title={`Approval ${r.id}`}
              right={
                <span className={`badge ${left < 300 ? "badge-red" : "badge-amber"}`}>
                  expires in {Math.floor(left / 60)}m {left % 60}s
                </span>
              }
            >
              <div className="space-y-3">
                <IntentSummary v={v} />
                <div className="text-xs">
                  <div className="muted mb-1">Why it needs you</div>
                  {v.verdict?.reasons
                    .filter((x) => x.severity === "escalate" || x.severity === "warn")
                    .map((x, i) => (
                      <div
                        key={i}
                        className="rounded p-2 mb-1"
                        style={{
                          background: "var(--panel-2)",
                          borderLeft: `3px solid ${x.severity === "escalate" ? "var(--amber)" : "var(--blue)"}`,
                        }}
                      >
                        <span className="font-semibold">{x.rule}</span> {x.message}
                      </div>
                    ))}
                </div>
                <div className="text-xs muted">
                  Chain preview: tier {v.verdict?.chainTier} ({v.verdict?.chainReason}). Intent hash{" "}
                  <span className="mono">{v.intentHash}</span>. Nonce {v.nonce}. The simulation runs
                  on the co-signed path right before sending.
                </div>
                <LayerStrip steps={v.trace?.steps ?? []} />
                <div className="row">
                  <button
                    className="btn btn-primary"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, "approve")}
                  >
                    Approve and co-sign
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, "decline")}
                  >
                    Decline
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {past.length ? (
        <Card title="History">
          <table className="data">
            <thead>
              <tr>
                <th>Approval</th>
                <th>Intent</th>
                <th>Status</th>
                <th>Signer</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {past.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>
                    {r.intent.kind} {r.intent.amountFormatted} to{" "}
                    <span className="mono">{r.intent.target.slice(0, 10)}...</span>
                  </td>
                  <td>
                    {r.status}
                    {r.declined_reason ? `: ${r.declined_reason}` : ""}
                  </td>
                  <td>{r.signer ?? ""}</td>
                  <td>
                    {r.intent.state}
                    {r.intent.txHash ? (
                      <>
                        {" "}
                        <a
                          href={r.intent.explorerUrl ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="mono text-xs"
                        >
                          {r.intent.txHash.slice(0, 12)}...
                        </a>
                      </>
                    ) : null}
                    {r.intent.revertReason ? (
                      <span className="text-xs" style={{ color: "var(--red)" }}>
                        {" "}
                        {r.intent.revertReason}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
