import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog.js";
import { DEFENCE_CONFIGS, CONFIGS } from "../src/types.js";
import { renderEvaluation } from "../src/report.js";

describe("attack catalog", () => {
  it("loads fourteen valid scenarios with unique ids and mappings", () => {
    const cat = loadCatalog();
    expect(cat).toHaveLength(14);
    expect(new Set(cat.map((s) => s.id)).size).toBe(14);
    for (const s of cat) {
      expect(s.expected_stop.length).toBeGreaterThan(0);
      const total =
        s.mappings.owasp_llm.length +
        s.mappings.owasp_asi.length +
        s.mappings.atlas.length +
        s.mappings.incident.length;
      expect(total).toBeGreaterThan(0);
    }
  });
  it("defines the four configurations in order", () => {
    expect(DEFENCE_CONFIGS.map((c) => c.id)).toEqual([...CONFIGS]);
    expect(DEFENCE_CONFIGS.filter((c) => !c.harnessOnly)).toHaveLength(1);
  });
  it("renders a report without editing the results", () => {
    const cat = loadCatalog();
    const md = renderEvaluation(
      {
        id: "r1",
        startedAt: "2026-10-18T00:00:00Z",
        finishedAt: "2026-10-18T00:01:00Z",
        chainId: 31337,
        chainName: "Anvil",
        plannerMode: "mock",
        configs: ["A", "D"],
        scenarios: ["ATK-01"],
        results: [
          {
            scenario: "ATK-01",
            config: "A",
            outcome: "funds_moved",
            blockedAt: null,
            fundsMoved: true,
            amountMoved: "1",
            txHash: "0xabc",
            detail: "sent",
            plannerMode: "mock",
            durationMs: 1,
            defended: false,
            expectedStop: ["L0"],
          },
          {
            scenario: "ATK-01",
            config: "D",
            outcome: "blocked",
            blockedAt: "L2",
            fundsMoved: false,
            amountMoved: "0",
            txHash: null,
            detail: "denied",
            plannerMode: "mock",
            durationMs: 1,
            defended: true,
            expectedStop: ["L0"],
          },
        ],
        methodology: "m",
        commit: "abc",
      },
      cat,
      null,
    );
    expect(md).toContain("FUNDS MOVED");
    expect(md).toContain("blocked at L2");
    expect(md).toContain("| A | 1 | 0 | 1 | 0 |");
  });
});
