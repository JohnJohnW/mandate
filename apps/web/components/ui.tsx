"use client";
import type { ReactNode } from "react";
import type { IntentView, TraceStep } from "@/lib/api";

export function Card({
  title,
  children,
  right,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-4 ${className}`}>
      {title ? (
        <div className="row justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase muted">{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StateBadge({ state }: { state: string }) {
  const cls =
    state === "Executed"
      ? "badge-green"
      : state === "AwaitingApproval" ||
          state === "Simulating" ||
          state === "Submitted" ||
          state === "Drafted"
        ? "badge-amber"
        : state === "Blocked" ||
            state === "RevertedOnChain" ||
            state === "Rejected" ||
            state === "Expired"
          ? "badge-red"
          : "badge-grey";
  return <span className={`badge ${cls}`}>{state}</span>;
}

export function DecisionBadge({ decision }: { decision: string }) {
  const cls =
    decision === "ALLOW" ? "badge-green" : decision === "ESCALATE" ? "badge-amber" : "badge-red";
  return <span className={`badge ${cls}`}>{decision}</span>;
}

export function TierBadge({ tier }: { tier: number | null | undefined }) {
  if (tier === null || tier === undefined) return <span className="badge badge-grey">tier ?</span>;
  const label = ["Observe", "Autonomous", "Co-sign", "Forbidden"][tier] ?? "?";
  const cls =
    tier === 1
      ? "badge-green"
      : tier === 2
        ? "badge-amber"
        : tier === 3
          ? "badge-red"
          : "badge-grey";
  return (
    <span className={`badge ${cls}`}>
      Tier {tier}: {label}
    </span>
  );
}

const LAYERS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7"];
const LAYER_NAMES: Record<string, string> = {
  L0: "Context isolation",
  L1: "Typed intent",
  L2: "Policy engine",
  L3: "Simulation",
  L4: "On-chain enforcement",
  L5: "Human in the loop",
  L6: "Observability",
  L7: "Identity",
};

function stepColor(s?: TraceStep) {
  if (!s) return "var(--border)";
  return s.status === "pass"
    ? "var(--green)"
    : s.status === "warn"
      ? "var(--amber)"
      : s.status === "fail"
        ? "var(--red)"
        : "var(--border)";
}

/** The eight defence layers lighting up as the trace arrives. */
export function LayerStrip({ steps }: { steps: TraceStep[] }) {
  const byLayer = new Map<string, TraceStep>();
  for (const s of steps) byLayer.set(s.layer, s); // last step per layer wins
  return (
    <div className="grid grid-cols-8 gap-1">
      {LAYERS.map((l) => {
        const s = byLayer.get(l);
        return (
          <div
            key={l}
            className="rounded-md p-2 text-center"
            style={{ background: "var(--panel-2)", borderTop: `3px solid ${stepColor(s)}` }}
            title={s ? `${s.detail}` : "not reached"}
          >
            <div className="text-xs font-semibold">{l}</div>
            <div className="text-[10px] muted leading-tight">{LAYER_NAMES[l]}</div>
            {s ? (
              <div className="text-[10px] muted">{s.durationMs} ms</div>
            ) : (
              <div className="text-[10px] muted">-</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TraceList({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li
          key={i}
          className="rounded-md p-2 text-xs"
          style={{ background: "var(--panel-2)", borderLeft: `3px solid ${stepColor(s)}` }}
        >
          <div className="row justify-between">
            <span className="font-semibold">
              {s.layer} {s.name}
            </span>
            <span className="muted">
              {s.status} in {s.durationMs} ms
            </span>
          </div>
          <div className="mt-1 break-words">{s.detail}</div>
          {s.citations.length ? (
            <div className="mt-1 muted">cites {s.citations.map((c) => `[${c}]`).join(" ")}</div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function IntentSummary({ v }: { v: IntentView }) {
  return (
    <div className="text-sm space-y-1">
      <div className="row flex-wrap gap-2">
        <StateBadge state={v.state} />
        <TierBadge tier={v.tier} />
        {v.verdict ? <DecisionBadge decision={v.verdict.decision} /> : null}
        {v.verdict ? <span className="badge badge-grey">risk {v.verdict.riskScore}</span> : null}
      </div>
      <div>
        <span className="muted">{v.kind}</span> {v.amountFormatted}{" "}
        <span className="muted">to</span> <span className="mono">{v.target}</span>
      </div>
      <div className="muted text-xs">{v.rationale}</div>
      {v.txHash ? (
        <div className="text-xs mono break-all">
          tx{" "}
          {v.explorerUrl ? (
            <a href={v.explorerUrl} target="_blank" rel="noreferrer">
              {v.txHash}
            </a>
          ) : (
            v.txHash
          )}
        </div>
      ) : null}
      {v.revertReason ? (
        <div className="text-xs" style={{ color: "var(--red)" }}>
          {v.revertReason}
        </div>
      ) : null}
    </div>
  );
}

export function Gauge({
  label,
  value,
  max,
  unit,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = pct >= 100 ? "var(--red)" : pct >= 70 ? "var(--amber)" : "var(--green)";
  return (
    <div>
      <div className="row justify-between text-xs">
        <span>{label}</span>
        <span className="muted">
          {value} / {max} {unit} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full mt-1" style={{ background: "var(--panel-2)" }}>
        <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
