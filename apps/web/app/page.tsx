"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, formatUnits, short, type IntentView, type Mandate } from "@/lib/api";
import { useConfig, useLive } from "@/lib/live";
import { Card, Gauge, IntentSummary } from "@/components/ui";

const ZERO = "0x0000000000000000000000000000000000000000";

export default function Overview() {
  const cfg = useConfig();
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [portfolio, setPortfolio] = useState<Record<string, Record<string, string>> | null>(null);
  const [intents, setIntents] = useState<IntentView[]>([]);

  const load = () => {
    api<Mandate>("/mandate")
      .then(setMandate)
      .catch(() => {});
    api<Record<string, Record<string, string>>>("/portfolio")
      .then(setPortfolio)
      .catch(() => {});
    api<IntentView[]>("/intents?limit=8")
      .then(setIntents)
      .catch(() => {});
  };
  useEffect(() => {
    void load();
  }, []);
  useLive(["intent.updated", "mandate.updated"], load);

  // chain time at which the mirror was read, so local chains with a shifted clock still show the right window
  const now = mandate ? Number(mandate.observedAt) : Math.floor(Date.now() / 1000);
  const tokenMeta = (addr: string) =>
    cfg?.tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase()) ??
    (addr === ZERO ? { symbol: "ETH", decimals: 18, address: ZERO } : undefined);

  return (
    <div className="space-y-4">
      <header className="row justify-between">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm muted">
            What the agent holds, what it may do, and what it did last.
          </p>
        </div>
        {mandate ? (
          <div className="row gap-2">
            <span
              className={`badge ${mandate.paused ? "badge-red" : mandate.active ? "badge-green" : "badge-red"}`}
            >
              {mandate.paused ? "PAUSED" : mandate.active ? "agent active" : "agent revoked"}
            </span>
            <span className="badge badge-grey">
              expires {new Date(Number(mandate.expiry) * 1000).toLocaleString()}
            </span>
            <span className="badge badge-grey">nonce {mandate.nextNonce}</span>
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Portfolio">
          {portfolio ? (
            <div className="space-y-3 text-sm">
              {Object.entries(portfolio).map(([holder, bals]) => (
                <div key={holder}>
                  <div className="row justify-between">
                    <span className="font-medium capitalize">
                      {holder === "agent" ? "agent petty cash" : holder}
                    </span>
                    <span className="mono text-xs muted">{short(bals.address)}</span>
                  </div>
                  <ul className="mt-1 text-xs space-y-0.5">
                    {Object.entries(bals)
                      .filter(([k]) => k !== "address")
                      .map(([sym, v]) => {
                        const t = cfg?.tokens.find((x) => x.symbol === sym);
                        return (
                          <li key={sym} className="row justify-between">
                            <span className="muted">{sym}</span>
                            <span className="mono">
                              {v === "unavailable" ? v : formatUnits(v, t?.decimals ?? 18)}
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted text-sm">loading...</div>
          )}
        </Card>

        <Card title="Mandate window usage" className="col-span-2">
          {mandate ? (
            <div className="space-y-3">
              {Object.entries(mandate.assets)
                .filter(([, a]) => a.enabled)
                .map(([addr, a]) => {
                  const t = tokenMeta(addr);
                  const d = t?.decimals ?? 18;
                  const rolled = now >= Number(a.windowStart) + Number(a.windowSeconds);
                  const spent = rolled ? 0 : Number(formatUnits(a.spentInWindow, d, 8));
                  return (
                    <div key={addr}>
                      <Gauge
                        label={`${t?.symbol ?? short(addr)} spent this window${rolled ? " (window rolled)" : ""}`}
                        value={spent}
                        max={Number(formatUnits(a.autonomousWindowCap, d, 8))}
                        unit={t?.symbol ?? ""}
                      />
                      <div className="text-xs muted mt-1">
                        per tx {formatUnits(a.autonomousPerTxCap, d)} autonomous, up to{" "}
                        {formatUnits(a.coSignPerTxCap, d)} with co-signature, window{" "}
                        {Number(a.windowSeconds) / 3600} h
                      </div>
                    </div>
                  );
                })}
              <div className="text-xs muted">
                Allowlisted targets: {mandate.allowedTargets.length} | allowlisted calls:{" "}
                {Object.values(mandate.allowedSelectors).reduce((n, s) => n + s.length, 0)} | read
                from chain at block {mandate.observedAtBlock}
              </div>
            </div>
          ) : (
            <div className="muted text-sm">loading...</div>
          )}
        </Card>
      </div>

      <Card
        title="Last decisions"
        right={
          <Link href="/agent" className="text-xs">
            open agent
          </Link>
        }
      >
        {intents.length === 0 ? (
          <div className="muted text-sm">No intents yet. Talk to the agent to create one.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {intents.map((v) => (
              <div key={v.id} className="rounded-md p-3" style={{ background: "var(--panel-2)" }}>
                <div className="text-xs muted mb-1">
                  {v.id} at {new Date(v.createdAt).toLocaleTimeString()}
                </div>
                <IntentSummary v={v} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Identity">
        <div className="text-sm">
          <div className="row gap-2">
            <span className="badge badge-grey">agent</span>
            <span className="mono">{cfg?.agent}</span>
          </div>
          <div className="row gap-2 mt-1">
            <span className="badge badge-grey">vault</span>
            <span className="mono">{cfg?.vault}</span>
            {cfg?.vaultExplorer ? (
              <a className="text-xs" href={cfg.vaultExplorer} target="_blank" rel="noreferrer">
                explorer
              </a>
            ) : null}
          </div>
          <div className="text-xs muted mt-2">
            ERC-8004 registration is part of the identity phase and is shown on the Identity page
            once registered.
          </div>
        </div>
      </Card>
    </div>
  );
}
