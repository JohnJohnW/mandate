/**
 * The agent loop: assemble the planner input from trusted sources only, get a
 * fixed plan, execute its steps in order through the tool catalogue, and
 * compose the owner-facing reply from the results. Tool results never go back
 * to the planner. [Beurer-Kellner 2025, Plan-Then-Execute]
 */
import { ZERO_ADDRESS } from "@mandate/core";
import type { Clients } from "./chain/clients.js";
import { MandateReader } from "./chain/mandate.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { EventBus } from "./events.js";
import type { IntentService } from "./pipeline/service.js";
import type { Plan, Planner, PlannerInput } from "./planner/types.js";
import type { Quarantine } from "./quarantine.js";
import type { ScreeningProvider } from "./screening.js";
import { TOOLS, toolDescriptions, type ToolContext, type ToolResult } from "./tools/index.js";

export interface AgentReply {
  reply: string;
  plan: Plan;
  intentIds: string[];
  results: ToolResult[];
  planner: "mock" | "live";
}

export class Agent {
  constructor(
    private readonly cfg: Config,
    private readonly clients: Clients,
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly mandate: MandateReader,
    private readonly intents: IntentService,
    private readonly quarantine: Quarantine,
    private readonly screening: ScreeningProvider,
    public planner: Planner,
    private readonly extras: Pick<ToolContext, "prices" | "identity"> = {},
  ) {}

  async plannerInput(ownerMessage: string, quarantineIds: string[]): Promise<PlannerInput> {
    const m = await this.mandate.read();
    const tokenNames = Object.fromEntries(
      this.intents.tokens.map((t) => [
        t.address.toLowerCase(),
        { symbol: t.symbol, decimals: t.decimals },
      ]),
    );
    tokenNames[ZERO_ADDRESS] = { symbol: "ETH", decimals: 18 };
    return {
      ownerMessage,
      mandateSummary: MandateReader.summarize(m, tokenNames),
      contacts: this.db.listContacts().map((c) => ({ name: c.name, address: c.address })),
      memory: this.db
        .listMemory()
        .map((x) => ({ key: x.key, value: x.value, provenance: x.provenance })),
      tools: toolDescriptions(),
      quarantined: quarantineIds
        .map((id) => this.quarantine.get(id))
        .filter((q): q is NonNullable<typeof q> => q !== undefined)
        .map((q) => ({ id: q.id, kind: q.kind, origin: q.origin, fields: Object.keys(q.fields) })),
      tokens: this.intents.tokens.map((t) => ({
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
      })),
    };
  }

  async handle(
    ownerMessage: string,
    quarantineIds: string[] = [],
    source = "chat",
  ): Promise<AgentReply> {
    this.db.insertChat("owner", ownerMessage);
    this.bus.emit("chat.message", { role: "owner", text: ownerMessage });
    const input = await this.plannerInput(ownerMessage, quarantineIds);
    const plan = await this.planner.plan(input);
    this.intents.audit.append({
      actor: "agent",
      event: "agent.plan",
      payload: {
        planner: this.planner.name,
        summary: plan.summary,
        steps: plan.steps.map((s) => ({ tool: s.tool, args: s.args })),
        source,
      },
    });

    const ctx: ToolContext = {
      cfg: this.cfg,
      clients: this.clients,
      db: this.db,
      intents: this.intents,
      quarantine: this.quarantine,
      screening: this.screening,
      mandate: this.mandate,
      ownerMessage,
      quarantined: quarantineIds,
      ...this.extras,
    };
    const results: ToolResult[] = [];
    const intentIds: string[] = [];
    for (const step of plan.steps) {
      const tool = TOOLS.find((t) => t.name === step.tool);
      if (!tool) {
        results.push({
          ok: false,
          text: `The planner asked for an unknown tool "${step.tool}"; skipped.`,
        });
        continue;
      }
      try {
        const r = await tool.run(step.args, ctx);
        results.push(r);
        if (r.intent) intentIds.push(r.intent.id);
      } catch (err) {
        results.push({
          ok: false,
          text: `${step.tool} failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    const reply = plan.steps.length === 0 ? plan.reply : results.map((r) => r.text).join("\n\n");
    this.db.insertChat("agent", reply, intentIds);
    this.bus.emit("chat.message", {
      role: "agent",
      text: reply,
      intentIds,
      planner: this.planner.name,
    });
    return { reply, plan, intentIds, results, planner: this.planner.name };
  }
}
