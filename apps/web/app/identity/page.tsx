"use client";
import { useEffect, useState } from "react";
import { api, short } from "@/lib/api";
import { useLive } from "@/lib/live";
import { Card } from "@/components/ui";

interface CardView {
  agentId: string | null;
  owner: string | null;
  wallet: string | null;
  agentURI: string | null;
  registry: string | null;
  onChain: boolean;
  detail: string;
  vaultBound?: boolean;
}
interface IdentityResponse {
  ours: CardView;
  oracle: CardView & { card?: unknown; kya?: { ok: boolean; detail: string } };
  registry: string | null;
  explorer: string | null;
}
interface Payment {
  at: string;
  resource: string;
  payTo: string;
  amountFormatted: string;
  txHash: string | null;
  status: string;
  reasons: { rule: string; severity: string; message: string }[];
}

export default function IdentityPage() {
  const [data, setData] = useState<IdentityResponse | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    api<IdentityResponse>("/identity")
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    api<Payment[]>("/x402/history")
      .then(setPayments)
      .catch(() => {});
  };
  useEffect(() => {
    void load();
  }, []);
  useLive(["system", "audit.appended"], load);

  const AgentCard = ({
    title,
    c,
    extra,
  }: {
    title: string;
    c: CardView;
    extra?: React.ReactNode;
  }) => (
    <Card title={title}>
      <div className="text-sm space-y-1">
        <div className="row gap-2">
          {c.onChain ? (
            <span className="badge badge-green">registered on-chain</span>
          ) : (
            <span className="badge badge-grey">not registered</span>
          )}
          {c.agentId ? <span className="badge badge-blue">agent #{c.agentId}</span> : null}
        </div>
        <div>
          <span className="muted">registry</span>{" "}
          <span className="mono text-xs">{c.registry ?? "none"}</span>
        </div>
        <div>
          <span className="muted">owner (NFT holder)</span>{" "}
          <span className="mono text-xs">{c.owner ?? "-"}</span>
        </div>
        <div>
          <span className="muted">agent wallet</span>{" "}
          <span className="mono text-xs">{c.wallet ?? "-"}</span>
        </div>
        <div>
          <span className="muted">agent card</span>{" "}
          {c.agentURI ? (
            <a className="text-xs" href={c.agentURI} target="_blank" rel="noreferrer">
              {c.agentURI}
            </a>
          ) : (
            "-"
          )}
        </div>
        <div className="text-xs muted">{c.detail}</div>
        {extra}
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Identity</h1>
        <p className="text-sm muted">
          ERC-8004 agent identities. Our agent's wallet in the registry is the vault, bound with the
          owner's signature. Before paying another agent we check that its card and the registry
          agree on the wallet we are paying (Know Your Agent).
        </p>
      </header>
      {err ? (
        <div className="panel p-3 text-sm" style={{ color: "var(--red)" }}>
          {err}
        </div>
      ) : null}
      {data ? (
        <div className="grid grid-cols-2 gap-4">
          <AgentCard
            title="Our agent"
            c={data.ours}
            extra={
              data.ours.vaultBound ? (
                <span className="badge badge-green">wallet is the vault</span>
              ) : (
                <span className="badge badge-amber">wallet is not the vault yet</span>
              )
            }
          />
          <AgentCard
            title="Oracle agent (counterparty)"
            c={data.oracle}
            extra={
              data.oracle.kya ? (
                <span className={`badge ${data.oracle.kya.ok ? "badge-green" : "badge-red"}`}>
                  Know Your Agent: {data.oracle.kya.detail}
                </span>
              ) : null
            }
          />
        </div>
      ) : (
        <Card>
          <div className="muted text-sm">loading...</div>
        </Card>
      )}
      <Card title="Machine-to-machine payments (x402)">
        {payments.length === 0 ? (
          <div className="muted text-sm">
            No payments yet. Ask the agent for prices to trigger one.
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Resource</th>
                <th>Pay to</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Settlement</th>
                <th>Checks</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i}>
                  <td className="muted whitespace-nowrap">{new Date(p.at).toLocaleTimeString()}</td>
                  <td className="mono text-xs">{p.resource.replace(/^https?:\/\//, "")}</td>
                  <td className="mono text-xs">{short(p.payTo)}</td>
                  <td>{p.amountFormatted}</td>
                  <td>
                    <span className={`badge ${p.status === "paid" ? "badge-green" : "badge-red"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="mono text-xs">
                    {p.txHash ? (
                      data?.explorer ? (
                        <a
                          href={`${data.explorer}/tx/${p.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(p.txHash, 8)}
                        </a>
                      ) : (
                        short(p.txHash, 8)
                      )
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="text-xs">
                    {p.reasons.map((r, j) => (
                      <div
                        key={j}
                        style={{ color: r.severity === "deny" ? "var(--red)" : "var(--muted)" }}
                      >
                        {r.rule}: {r.message}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
