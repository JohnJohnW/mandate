/**
 * Runs the full attack suite against a live deployment and writes docs/EVALUATION.md
 * plus the raw report under packages/attacks/results/. Starts its own app instance
 * (so it needs the deployed vault and, for the x402 and identity scenarios, the
 * oracle running). Never edits the results by hand.
 *
 * Usage: pnpm attacks:run                 (chain from .env)
 *        CHAIN_ID=31337 pnpm attacks:run   (Anvil)
 */
import { writeFileSync } from "node:fs";
import { loadCatalog, renderEvaluation, type RunReport } from "@mandate/attacks";
import { createApp } from "../src/app.js";
import { loadConfig, explorerAddress } from "../src/config.js";
import { AttackRunner } from "../src/attacks/runner.js";

const cfg = loadConfig();
const app = await createApp(cfg);
// The scenarios need an allowlisted contact named "alice" and a sanctioned demo address loaded.
if (!app.db.listContacts().some((c) => c.name.toLowerCase() === "alice"))
  app.db.upsertContact("alice", "0x1234567890AbcdEF1234567890aBcdef12345678");

const runner = new AttackRunner(app);
console.log(
  `running the attack suite on chain ${cfg.chainId} (${cfg.chainName}), planner ${app.agent.planner.name}`,
);
const report: RunReport = await runner.run({
  onProgress: (r) =>
    console.log(
      `  ${r.scenario} config ${r.config}: ${r.outcome}${r.blockedAt ? ` at ${r.blockedAt}` : ""}${r.txHash ? ` (${r.txHash})` : ""}`,
    ),
});

const root = new URL("../../../", import.meta.url).pathname;
const catalog = loadCatalog();
const explorer = cfg.explorerUrl || null;
writeFileSync(`${root}docs/EVALUATION.md`, renderEvaluation(report, catalog, explorer));
const stamp = report.finishedAt.replace(/[:.]/g, "-");
writeFileSync(
  `${root}packages/attacks/results/${cfg.chainId}-${stamp}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
writeFileSync(
  `${root}packages/attacks/results/latest-${cfg.chainId}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
void explorerAddress;

const d = report.results.filter((r) => r.config === "D");
console.log(
  `\nConfiguration D (product): ${d.filter((r) => r.defended).length} of ${d.length} scenarios defended (no funds moved outside the mandate).`,
);
console.log(`wrote docs/EVALUATION.md and packages/attacks/results/${cfg.chainId}-${stamp}.json`);
app.close();
process.exit(0);
