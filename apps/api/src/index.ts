import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const cfg = loadConfig();
const app = await createApp(cfg);
for (const c of app.startupChecks)
  console.log(`[startup] ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
console.log(
  `[startup] planner: ${app.agent.planner.name}; owner mode: ${cfg.ownerMode}; approval auth: ${cfg.ownerApprovalAuth}`,
);
if (cfg.ownerApprovalAuth === "dev")
  console.log(
    "[startup] WARNING: OWNER_APPROVAL_AUTH=dev accepts 'dev' as an owner session. Tests only.",
  );

const server = createServer(app);
serve({ fetch: server.fetch, port: cfg.apiPort }, (info) =>
  console.log(
    `[api] listening on http://localhost:${info.port} (${cfg.chainName}, vault ${cfg.vaultAddress})`,
  ),
);

setInterval(() => app.intents.expireStale(), 30_000).unref();
