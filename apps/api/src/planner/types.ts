/**
 * Plan-then-execute. The planner sees the owner's message, the mandate summary
 * read from chain, the address book, memory entries with their provenance, the
 * tool catalogue and the ids and field names of quarantined content. It never
 * sees raw tool output or the text of untrusted content. It emits a fixed plan
 * whose steps are executed in order; results flow to the owner, not back into
 * the planner. [Beurer-Kellner 2025] [CaMeL]
 */
import { z } from "zod";

export const quarantineRefSchema = z.object({ ref: z.string(), field: z.string() });
export type QuarantineRef = z.infer<typeof quarantineRefSchema>;

export const planArgSchema = z.union([z.string(), z.number(), z.boolean(), quarantineRefSchema]);
export type PlanArg = z.infer<typeof planArgSchema>;

export const planStepSchema = z.object({
  id: z.string().min(1).max(32),
  tool: z.string().min(1).max(64),
  args: z.record(z.string(), planArgSchema).default({}),
  why: z.string().max(400).default(""),
});
export type PlanStep = z.infer<typeof planStepSchema>;

export const planSchema = z.object({
  summary: z.string().max(600),
  steps: z.array(planStepSchema).max(6),
  reply: z.string().max(1200),
});
export type Plan = z.infer<typeof planSchema>;

export interface ToolDescription {
  name: string;
  description: string;
  tier: 0 | 1 | 2;
  sideEffects: boolean;
  args: string;
}

export interface PlannerInput {
  ownerMessage: string;
  mandateSummary: string;
  contacts: { name: string; address: string }[];
  memory: { key: string; value: string; provenance: string }[];
  tools: ToolDescription[];
  quarantined: { id: string; kind: string; origin: string; fields: string[] }[];
  tokens: { symbol: string; address: string; decimals: number }[];
}

export interface Planner {
  readonly name: "mock" | "live";
  plan(input: PlannerInput): Promise<Plan>;
  /** The exact input of the last call, kept so tests can prove what the planner saw. */
  lastInput(): PlannerInput | undefined;
}
