"use client";
import { useEffect, useState } from "react";
import { api, short } from "@/lib/api";
import { useConfig, useLive } from "@/lib/live";
import { Card } from "@/components/ui";

interface Scenario {
  id: string;
  title: string;
  family: string;
  expected_stop: string[];
  mappings: { owasp_llm: string[]; owasp_asi: string[]; atlas: string[]; incident: string[] };
  notes: string;
}
interface DefenceConfig {
  id: string;
  name: string;
  description: string;
}
interface Result {
  scenario: string;
  config: string;
  outcome: string;
  blockedAt: string | null;
  fundsMoved: boolean;
  txHash: string | null;
  detail: string;
  defended: boolean;
}
interface Report {
  id: string;
  startedAt: string;
  finishedAt: string;
  chainId: number;
  chainName: string;
  plannerMode: string;
  configs: string[];
  scenarios: string[];
  results: Result[];
  methodology: string;
}

const OUTCOME_LABEL: Record<string, string> = {
  funds_moved: "funds moved",
  blocked: "blocked",
  escalated: "escalated",
  reverted_on_chain: "reverted on-chain",
  no_action: "no action",
  error: "error",
  not_applicable: "n/a",
};

function cellClass(r: Result | undefined) {
  if (!r) return "badge-grey";
  if (r.fundsMoved) return "badge-red";
  if (r.outcome === "escalated") return "badge-amber";
  if (r.outcome === "error") return "badge-grey";
  return "badge-green";
}

export default function SecurityLabPage() {
  const cfg = useConfig();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [configs, setConfigs] = useState<DefenceConfig[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [live, setLive] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    api<{ scenarios: Scenario[]; configs: DefenceConfig[] }>("/attacks/catalog")
      .then((d) => {
        setScenarios(d.scenarios);
        setConfigs(d.configs);
      })
      .catch(() => {});
    api<Report | null>("/attacks/latest")
      .then((r) => r && setReport(r))
      .catch(() => {});
  };
  useEffect(() => {
    void load();
  }, []);
  useLive(["attack.progress"], (e) => {
    const r = e.data as Result;
    setLive((prev) => ({ ...prev, [`${r.scenario}:${r.config}`]: r }));
  });

  const run = async () => {
    setRunning(true);
    setErr(null);
    setLive({});
    try {
      const r = await api<Report>("/attacks/run", { method: "POST", body: JSON.stringify({}) });
      setReport(r);
      setLive({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const cell = (scenario: string, config: string): Result | undefined =>
    live[`${scenario}:${config}`] ??
    report?.results.find((r) => r.scenario === scenario && r.config === config);
  const summary = (config: string) => {
    const rs = (report?.results ?? []).filter((r) => r.config === config);
    return {
      total: rs.length,
      defended: rs.filter((r) => r.defended).length,
      moved: rs.filter((r) => r.fundsMoved).length,
    };
  };

  return (
    <div className="space-y-4">
      <header className="row justify-between">
        <div>
          <h1 className="text-xl font-semibold">Security Lab</h1>
          <p className="text-sm muted">
            Fourteen documented attack patterns replayed against four defence configurations.
            Configuration D is the real product and vault; A, B and C are modelled, with C using the
            real policy engine. Measured, not asserted.
          </p>
        </div>
        <button className="btn btn-primary" disabled={running} onClick={run}>
          {running ? "running..." : "Run all against all configurations"}
        </button>
      </header>
      {err ? (
        <div className="panel p-3 text-sm" style={{ color: "var(--red)" }}>
          {err}
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-3">
        {configs.map((c) => {
          const s = summary(c.id);
          return (
            <Card key={c.id} title={`Config ${c.id}: ${c.name}`}>
              <div className="text-xs muted mb-2" style={{ minHeight: 48 }}>
                {c.description}
              </div>
              <div className="row gap-2">
                <span
                  className={`badge ${c.id === "D" ? "badge-green" : s.moved > 0 ? "badge-red" : "badge-amber"}`}
                >
                  {report ? `${s.defended}/${s.total} defended` : "not run"}
                </span>
                {report && s.moved > 0 ? (
                  <span className="badge badge-red">{s.moved} funds moved</span>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <Card
        title="Results matrix"
        right={
          report ? (
            <span className="text-xs muted">
              run {report.id} on {report.chainName}, planner {report.plannerMode}
            </span>
          ) : null
        }
      >
        <table className="data">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Family</th>
              <th>Mappings</th>
              <th>Expected stop</th>
              {configs.map((c) => (
                <th key={c.id}>Config {c.id}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className="font-medium">{s.id}</span> {s.title}
                </td>
                <td className="muted">{s.family}</td>
                <td className="text-xs muted">
                  {[...s.mappings.owasp_llm, ...s.mappings.owasp_asi, ...s.mappings.incident].join(
                    ", ",
                  )}
                </td>
                <td className="text-xs mono">{s.expected_stop.join(", ")}</td>
                {configs.map((c) => {
                  const r = cell(s.id, c.id);
                  return (
                    <td key={c.id}>
                      {r ? (
                        <span className={`badge ${cellClass(r)}`} title={r.detail}>
                          {OUTCOME_LABEL[r.outcome] ?? r.outcome}
                          {r.blockedAt ? ` ${r.blockedAt}` : ""}
                        </span>
                      ) : (
                        <span className="badge badge-grey">-</span>
                      )}
                      {r?.txHash ? (
                        <div className="text-xs mono mt-1">
                          {cfg?.explorerUrl ? (
                            <a
                              href={`${cfg.explorerUrl}/tx/${r.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {short(r.txHash, 6)}
                            </a>
                          ) : (
                            short(r.txHash, 6)
                          )}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {report ? (
          <div className="text-xs muted mt-3">
            Methodology and limitations are written to docs/EVALUATION.md with every run. Raw
            report: /attacks/runs/{report.id}.
          </div>
        ) : (
          <div className="muted text-sm">No run yet. Press the button to replay the catalog.</div>
        )}
      </Card>
    </div>
  );
}
