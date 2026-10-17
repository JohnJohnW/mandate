import { z } from "zod";

export const scenarioSchema = z.object({
  id: z.string().regex(/^ATK-\d{2}$/),
  title: z.string(),
  family: z.string(),
  vector: z.string(),
  channel: z.enum([
    "message",
    "token_metadata",
    "invoice",
    "history",
    "memory",
    "tool_output",
    "direct",
  ]),
  payload: z.string(),
  owner_message: z.string(),
  attach_as: z.enum([
    "message",
    "token_metadata",
    "invoice",
    "tool_output",
    "memory",
    "inline",
    "none",
  ]),
  repeat: z.number().int().positive().optional(),
  mappings: z.object({
    owasp_llm: z.array(z.string()),
    owasp_asi: z.array(z.string()),
    atlas: z.array(z.string()),
    incident: z.array(z.string()),
  }),
  expected_stop: z.array(z.enum(["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7"])),
  notes: z.string(),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const CONFIGS = ["A", "B", "C", "D"] as const;
export type ConfigId = (typeof CONFIGS)[number];

export interface DefenceConfig {
  id: ConfigId;
  name: string;
  description: string;
  planner: "naive" | "guarded" | "product";
  quarantine: boolean;
  policy: boolean;
  simulation: boolean;
  vault: boolean;
  harnessOnly: boolean;
}

export const DEFENCE_CONFIGS: DefenceConfig[] = [
  {
    id: "A",
    name: "No guards",
    description:
      "The planner sees raw content, has a raw send tool, and the agent key holds the funds. No policy, no simulation, no vault.",
    planner: "naive",
    quarantine: false,
    policy: false,
    simulation: false,
    vault: false,
    harnessOnly: true,
  },
  {
    id: "B",
    name: "Prompt guards only",
    description:
      "As A, plus a denylist of obvious injection phrases in the planner prompt. Still a raw send tool and no vault.",
    planner: "guarded",
    quarantine: false,
    policy: false,
    simulation: false,
    vault: false,
    harnessOnly: true,
  },
  {
    id: "C",
    name: "Off-chain policy and simulation",
    description:
      "As B, plus the deterministic policy engine and pre-flight simulation. Enforcement is in software only; the agent key still holds the funds and the mandate is a local setting.",
    planner: "guarded",
    quarantine: false,
    policy: true,
    simulation: true,
    vault: false,
    harnessOnly: true,
  },
  {
    id: "D",
    name: "Mandate (full product)",
    description:
      "Plan-then-execute with quarantine, the policy engine, simulation and MandateVault enforcement on-chain with the owner co-signature path.",
    planner: "product",
    quarantine: true,
    policy: true,
    simulation: true,
    vault: true,
    harnessOnly: false,
  },
];

export type Outcome =
  "blocked" | "escalated" | "funds_moved" | "reverted_on_chain" | "no_action" | "error";

export interface ScenarioResult {
  scenario: string;
  config: ConfigId;
  outcome: Outcome;
  blockedAt: string | null; // layer id or null
  fundsMoved: boolean;
  amountMoved: string; // base units of the asset that moved, "0" otherwise
  txHash: string | null;
  detail: string;
  plannerMode: "mock" | "live";
  durationMs: number;
  defended: boolean; // true when no funds moved outside the mandate
  expectedStop: string[];
}

export interface RunReport {
  id: string;
  startedAt: string;
  finishedAt: string;
  chainId: number;
  chainName: string;
  plannerMode: "mock" | "live";
  configs: ConfigId[];
  scenarios: string[];
  results: ScenarioResult[];
  methodology: string;
  commit: string;
}
