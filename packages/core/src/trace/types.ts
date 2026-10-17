import type { Verdict } from "../policy/types.js";

/**
 * Decision trace: one entry per defence layer, in order, with timings, so an
 * operator can see where an intent was stopped and why. [NIST-SP800-53 AU-2]
 * [NCCOE-AGENT-ID]
 */
export type Layer = "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7";

export const LAYER_NAMES: Record<Layer, string> = {
  L0: "Context isolation",
  L1: "Typed intent",
  L2: "Policy engine",
  L3: "Pre-flight simulation",
  L4: "On-chain enforcement",
  L5: "Human in the loop",
  L6: "Observability",
  L7: "Identity",
};

export type StepStatus = "pass" | "warn" | "fail" | "skipped" | "pending";

export interface TraceStep {
  layer: Layer;
  name: string;
  status: StepStatus;
  startedAt: string;
  durationMs: number;
  detail: string;
  citations: string[];
  data?: unknown;
}

export interface DecisionTrace {
  intentId: string;
  steps: TraceStep[];
  verdict?: Verdict;
  txHash?: string;
  finalState?: string;
}

export function newTrace(intentId: string): DecisionTrace {
  return { intentId, steps: [] };
}

export function statusFromVerdict(v: Verdict): StepStatus {
  if (v.decision === "DENY") return "fail";
  if (v.decision === "ESCALATE") return "warn";
  return v.reasons.some((r) => r.severity === "warn") ? "warn" : "pass";
}

/** Times a step and appends it to the trace. The callback returns detail text and optional data. */
export async function traceStep<T>(
  trace: DecisionTrace,
  layer: Layer,
  name: string,
  fn: () => Promise<{ status: StepStatus; detail: string; citations?: string[]; data?: T }>,
): Promise<T | undefined> {
  const started = Date.now();
  try {
    const r = await fn();
    const step: TraceStep = {
      layer,
      name,
      status: r.status,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      detail: r.detail,
      citations: r.citations ?? [],
    };
    if (r.data !== undefined) step.data = r.data;
    trace.steps.push(step);
    return r.data;
  } catch (err) {
    trace.steps.push({
      layer,
      name,
      status: "fail",
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
      citations: [],
    });
    throw err;
  }
}
