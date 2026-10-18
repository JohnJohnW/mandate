/**
 * HTTP surface: REST for state, SSE for live updates, OpenAPI generated from
 * the zod schemas. Owner actions require an owner session (passkey assertion,
 * or MetaMask signatures in metamask mode).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { getAddress, isAddress, parseUnits, type Hex } from "viem";
import { MANDATE_VAULT_ABI } from "@mandate/contracts";
import { verifyChain, type AuditRecord } from "@mandate/core";
import type { App } from "./app.js";
import { explorerAddress } from "./config.js";
import { json } from "./pipeline/service.js";
import { planSchema } from "./planner/types.js";

const chatBody = z.object({
  message: z.string().min(1).max(2000),
  attachments: z
    .array(
      z.object({
        kind: z.enum(["invoice", "tool_output", "token_metadata", "message", "web", "memory"]),
        origin: z.string().max(200),
        text: z.string().max(10000),
      }),
    )
    .max(5)
    .default([]),
});
const declineBody = z.object({ reason: z.string().min(1).max(400) });
const approveBody = z.object({ ownerSig: z.string().optional(), deadline: z.string().optional() });
const contactBody = z.object({
  name: z.string().min(1).max(40),
  address: z.string().refine((s) => isAddress(s, { strict: false })),
});
const memoryBody = z.object({ key: z.string().min(1).max(60), value: z.string().min(1).max(500) });
const assetMandateBody = z.object({
  token: z.enum(["ETH", "USDC", "WETH"]),
  autonomousPerTxCap: z.string(),
  autonomousWindowCap: z.string(),
  coSignPerTxCap: z.string(),
  windowSeconds: z.number().int().positive(),
  enabled: z.boolean(),
});
const targetBody = z.object({
  target: z.string().refine((s) => isAddress(s, { strict: false })),
  allowed: z.boolean(),
});
const selectorBody = z.object({
  target: z.string().refine((s) => isAddress(s, { strict: false })),
  selector: z.string().regex(/^0x[0-9a-fA-F]{8}$/),
  allowed: z.boolean(),
});
const agentBody = z.object({
  expiryDays: z.number().int().positive().max(365),
  active: z.boolean(),
});
const quarantineBody = z.object({
  kind: z.enum(["invoice", "tool_output", "token_metadata", "message", "web", "memory"]),
  origin: z.string().max(200),
  text: z.string().max(10000),
});

export function createServer(app: App): Hono {
  const h = new Hono();
  h.use(
    "*",
    cors({
      origin: [app.cfg.webOrigin, "http://localhost:3000", "http://127.0.0.1:3000"],
      allowHeaders: ["content-type", "x-owner-session"],
    }),
  );
  const reply = (
    c: { body: (s: string, status?: number, headers?: Record<string, string>) => Response },
    v: unknown,
    status = 200,
  ) => c.body(json(v), status as 200, { "content-type": "application/json" });

  const requireOwner = (c: { req: { header: (n: string) => string | undefined } }): string => {
    const signer = app.auth.authenticate(c.req.header("x-owner-session"));
    if (!signer)
      throw new HttpError(401, "owner session required (authenticate with the passkey first)");
    return signer;
  };

  h.onError((err, c) => {
    if (err instanceof HttpError) return reply(c, { error: err.message }, err.status);
    return reply(c, { error: err instanceof Error ? err.message : String(err) }, 500);
  });

  h.get("/health", (c) =>
    reply(c, { ok: true, chainId: app.cfg.chainId, checks: app.startupChecks }),
  );

  h.get("/config", (c) =>
    reply(c, {
      chainId: app.cfg.chainId,
      chainName: app.cfg.chainName,
      explorerUrl: app.cfg.explorerUrl || null,
      vault: app.cfg.vaultAddress,
      vaultExplorer: explorerAddress(app.cfg, app.cfg.vaultAddress!),
      agent: app.clients.agent.address,
      owner: app.clients.owner?.address ?? null,
      ownerMode: app.cfg.ownerMode,
      ownerApprovalAuth: app.cfg.ownerApprovalAuth,
      passkeyRegistered: app.auth.hasPasskey,
      planner: app.agent.planner.name,
      tokens: app.tokens,
      eip712: { name: "MandateVault", version: "1" },
    }),
  );

  h.get("/mandate", async (c) => reply(c, await app.mandate.read()));

  h.get("/portfolio", async (c) => {
    const m = await app.mandate.read();
    const out: Record<string, Record<string, string>> = {};
    for (const [label, address] of [
      ["vault", m.vault],
      ["agent", m.agent],
    ] as const) {
      out[label] = {
        address,
        ETH: (await app.clients.publicClient.getBalance({ address })).toString(),
      };
      for (const t of app.tokens.filter((x) => x.symbol !== "ETH")) {
        try {
          out[label]![t.symbol] = (
            (await app.clients.publicClient.readContract({
              address: t.address,
              abi: [
                {
                  type: "function",
                  name: "balanceOf",
                  stateMutability: "view",
                  inputs: [{ type: "address" }],
                  outputs: [{ type: "uint256" }],
                },
              ],
              functionName: "balanceOf",
              args: [address],
            })) as bigint
          ).toString();
        } catch {
          out[label]![t.symbol] = "unavailable";
        }
      }
    }
    return reply(c, out);
  });

  // ---- agent chat
  h.post("/chat", async (c) => {
    const body = chatBody.parse(await c.req.json());
    const ids = body.attachments.map((a) => app.quarantine.ingest(a.kind, a.origin, a.text).id);
    const r = await app.agent.handle(body.message, ids);
    return reply(c, { ...r, quarantineIds: ids });
  });
  h.get("/chat", (c) => reply(c, app.db.listChat()));

  h.post("/quarantine", async (c) => {
    const body = quarantineBody.parse(await c.req.json());
    const item = app.quarantine.ingest(body.kind, body.origin, body.text);
    return reply(c, item);
  });

  // ---- intents
  h.get("/intents", (c) => reply(c, app.intents.list(Number(c.req.query("limit") ?? 100))));
  h.get("/intents/:id", (c) => {
    const v = app.intents.view(c.req.param("id"));
    if (!v) throw new HttpError(404, "not found");
    return reply(c, v);
  });

  // ---- approvals
  h.get("/approvals", (c) => {
    app.intents.expireStale();
    return reply(
      c,
      app.db.listApprovals().map((a) => ({ ...a, intent: app.intents.view(a.intent_id) })),
    );
  });
  h.post("/approvals/:id/approve", async (c) => {
    const signer = requireOwner(c);
    const body = approveBody.parse(await c.req.json().catch(() => ({})));
    const id = c.req.param("id");
    if (body.ownerSig && body.deadline)
      return reply(
        c,
        await app.intents.approveWithSignature(
          id,
          body.ownerSig as Hex,
          BigInt(body.deadline),
          signer,
        ),
      );
    if (app.cfg.ownerMode !== "local")
      throw new HttpError(400, "metamask mode: supply ownerSig and deadline");
    return reply(c, await app.intents.approveLocal(id, signer));
  });
  h.post("/approvals/:id/decline", async (c) => {
    const signer = requireOwner(c);
    const body = declineBody.parse(await c.req.json());
    return reply(c, app.intents.decline(c.req.param("id"), body.reason, signer));
  });
  h.get("/approvals/:id/typed-data", async (c) => {
    // For MetaMask mode: what the owner will sign.
    const a = app.db.getApproval(c.req.param("id"));
    if (!a) throw new HttpError(404, "not found");
    const { intentHash: ih } = await app.intents.refreshNonce(a.intent_id);
    const block = await app.clients.publicClient.getBlock();
    const deadline = block.timestamp + 900n;
    return reply(c, {
      domain: {
        name: "MandateVault",
        version: "1",
        chainId: app.cfg.chainId,
        verifyingContract: app.cfg.vaultAddress,
      },
      primaryType: "Approval",
      types: {
        Approval: [
          { name: "intentHash", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      message: { intentHash: ih, deadline: deadline.toString() },
    });
  });

  // ---- owner mandate administration (local owner mode)
  const ownerWrite = async (functionName: string, args: unknown[]) => {
    if (!app.clients.ownerClient) throw new HttpError(400, "local owner key not configured");
    const hash = await app.clients.ownerClient.writeContract({
      account: app.clients.ownerClient.account!,
      chain: app.clients.ownerClient.chain,
      address: app.cfg.vaultAddress!,
      abi: MANDATE_VAULT_ABI,
      functionName,
      args,
    });
    const receipt = await app.clients.publicClient.waitForTransactionReceipt({ hash });
    app.mandate.invalidate();
    app.audit.append({
      actor: "owner",
      event: "mandate.changed",
      payload: { functionName, args, txHash: hash, status: receipt.status },
    });
    app.bus.emit("mandate.updated", { functionName, txHash: hash, status: receipt.status });
    return {
      txHash: hash,
      status: receipt.status,
      explorerUrl: app.cfg.explorerUrl ? `${app.cfg.explorerUrl}/tx/${hash}` : null,
    };
  };
  h.post("/mandate/asset", async (c) => {
    requireOwner(c);
    const b = assetMandateBody.parse(await c.req.json());
    const tok = app.tokens.find((t) => t.symbol === b.token)!;
    return reply(
      c,
      await ownerWrite("setAssetMandate", [
        app.clients.agent.address,
        tok.address,
        parseUnits(b.autonomousPerTxCap, tok.decimals),
        parseUnits(b.autonomousWindowCap, tok.decimals),
        parseUnits(b.coSignPerTxCap, tok.decimals),
        b.windowSeconds,
        b.enabled,
      ]),
    );
  });
  h.post("/mandate/target", async (c) => {
    requireOwner(c);
    const b = targetBody.parse(await c.req.json());
    return reply(
      c,
      await ownerWrite("setAllowedTarget", [
        app.clients.agent.address,
        getAddress(b.target),
        b.allowed,
      ]),
    );
  });
  h.post("/mandate/selector", async (c) => {
    requireOwner(c);
    const b = selectorBody.parse(await c.req.json());
    return reply(
      c,
      await ownerWrite("setAllowedSelector", [
        app.clients.agent.address,
        getAddress(b.target),
        b.selector as Hex,
        b.allowed,
      ]),
    );
  });
  h.post("/mandate/agent", async (c) => {
    requireOwner(c);
    const b = agentBody.parse(await c.req.json());
    const block = await app.clients.publicClient.getBlock();
    return reply(
      c,
      await ownerWrite("setAgent", [
        app.clients.agent.address,
        block.timestamp + BigInt(b.expiryDays) * 86400n,
        b.active,
      ]),
    );
  });
  h.post("/mandate/pause", async (c) => {
    requireOwner(c);
    const r = await ownerWrite("pause", []);
    app.audit.append({ actor: "owner", event: "vault.paused", payload: r });
    return reply(c, r);
  });
  h.post("/mandate/unpause", async (c) => {
    requireOwner(c);
    const r = await ownerWrite("unpause", []);
    app.audit.append({ actor: "owner", event: "vault.unpaused", payload: r });
    return reply(c, r);
  });
  h.post("/mandate/revoke", async (c) => {
    requireOwner(c);
    const r = await ownerWrite("revokeAgent", [app.clients.agent.address]);
    app.audit.append({ actor: "owner", event: "agent.revoked", payload: r });
    return reply(c, r);
  });

  // ---- address book and memory (owner data)
  h.get("/contacts", (c) => reply(c, app.db.listContacts()));
  h.post("/contacts", async (c) => {
    requireOwner(c);
    const b = contactBody.parse(await c.req.json());
    app.db.upsertContact(b.name, getAddress(b.address));
    app.audit.append({ actor: "owner", event: "contact.set", payload: b });
    return reply(c, app.db.listContacts());
  });
  h.delete("/contacts/:name", (c) => {
    requireOwner(c);
    app.db.deleteContact(c.req.param("name"));
    return reply(c, app.db.listContacts());
  });
  h.get("/memory", (c) => reply(c, app.db.listMemory()));
  h.post("/memory", async (c) => {
    const signer = app.auth.authenticate(c.req.header("x-owner-session"));
    const b = memoryBody.parse(await c.req.json());
    // Entries written through an owner session are owner provenance; anything else is untrusted memory.
    app.db.setMemory(
      b.key,
      b.value,
      signer ? "owner" : "memory",
      signer ?? "unauthenticated writer",
    );
    return reply(c, app.db.listMemory());
  });
  h.delete("/memory/:key", (c) => {
    requireOwner(c);
    app.db.deleteMemory(c.req.param("key"));
    return reply(c, app.db.listMemory());
  });

  // ---- audit
  h.get("/audit", (c) =>
    reply(c, {
      head: app.audit.head,
      length: app.audit.length,
      records: app.audit.all().slice(-Number(c.req.query("limit") ?? 200)),
    }),
  );
  h.get("/audit/verify", (c) => reply(c, app.audit.verify()));
  h.post("/audit/verify", async (c) => {
    // Verify an externally supplied copy (the dashboard's tamper demo posts an edited copy).
    const records = (await c.req.json()) as AuditRecord[];
    return reply(c, verifyChain(records));
  });
  h.get("/audit/export", (c) =>
    c.body(
      app.audit
        .all()
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
      200,
      {
        "content-type": "application/x-ndjson",
        "content-disposition": "attachment; filename=audit.jsonl",
      },
    ),
  );

  // ---- owner auth (passkey)
  h.post("/auth/passkey/register/options", async (c) =>
    reply(c, await app.auth.registrationOptions()),
  );
  h.post("/auth/passkey/register/verify", async (c) => {
    const b = (await c.req.json()) as { challengeId: string; response: never };
    return reply(c, await app.auth.verifyRegistration(b.challengeId, b.response));
  });
  h.post("/auth/passkey/assert/options", async (c) => reply(c, await app.auth.assertionOptions()));
  h.post("/auth/passkey/assert/verify", async (c) => {
    const b = (await c.req.json()) as { challengeId: string; response: never };
    return reply(c, await app.auth.verifyAssertion(b.challengeId, b.response));
  });
  h.get("/auth/session", (c) =>
    reply(c, { signer: app.auth.authenticate(c.req.header("x-owner-session")) ?? null }),
  );

  // ---- identity and payments
  h.get("/identity", async (c) => {
    const ours = await app.identity.ourCard();
    const oracleId = app.identity.record?.oracle?.agentId;
    const oracle = await app.identity.card(oracleId);
    let kya: { ok: boolean; detail: string } | undefined;
    let card: unknown;
    try {
      const res = await fetch(`${app.cfg.oracleUrl}/.well-known/agent.json`, {
        signal: AbortSignal.timeout(3000),
      });
      card = res.ok ? await res.json() : undefined;
      const payTo = (card as { payTo?: string } | undefined)?.payTo;
      if (payTo)
        kya = await app.identity.knowYourAgent(
          `${app.cfg.oracleUrl}/prices`,
          payTo as `0x${string}`,
        );
    } catch {
      kya = { ok: false, detail: "oracle not reachable" };
    }
    return reply(c, {
      ours,
      oracle: { ...oracle, card, kya },
      registry: app.identity.registry ?? null,
      explorer: app.cfg.explorerUrl || null,
    });
  });
  h.get("/.well-known/agent.json", async (c) => reply(c, await app.identity.registrationFile()));
  h.get("/x402/history", (c) => reply(c, app.x402.list()));
  h.get("/x402/float", async (c) =>
    reply(c, { balance: await app.x402.floatBalance(), limits: app.x402.limits }),
  );

  // ---- security lab
  h.get("/attacks/catalog", async (c) => {
    const { loadCatalog, DEFENCE_CONFIGS } = await import("@mandate/attacks");
    return reply(c, { scenarios: loadCatalog(), configs: DEFENCE_CONFIGS });
  });
  h.get("/attacks/runs", (c) =>
    reply(
      c,
      app.db
        .listAttackRuns()
        .map((r) => ({
          id: r.id,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          config: r.config,
          planner: r.planner,
        })),
    ),
  );
  h.get("/attacks/runs/:id", (c) => {
    const run = app.db.listAttackRuns().find((r) => r.id === c.req.param("id"));
    if (!run) throw new HttpError(404, "not found");
    return c.body(run.results_json, 200, { "content-type": "application/json" });
  });
  h.get("/attacks/latest", (c) => {
    const run = app.db.listAttackRuns()[0];
    return run
      ? c.body(run.results_json, 200, { "content-type": "application/json" })
      : reply(c, null);
  });
  h.post("/attacks/run", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      configs?: ("A" | "B" | "C" | "D")[];
      scenarioIds?: string[];
    };
    const { AttackRunner } = await import("./attacks/runner.js");
    const runner = new AttackRunner(app);
    const opts: { configs?: ("A" | "B" | "C" | "D")[]; scenarioIds?: string[] } = {};
    if (body.configs) opts.configs = body.configs;
    if (body.scenarioIds) opts.scenarioIds = body.scenarioIds;
    return reply(c, await runner.run(opts));
  });

  // ---- events (SSE)
  h.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const since = Number(c.req.header("last-event-id") ?? 0);
      for (const e of app.bus.since(since))
        await stream.writeSSE({ id: String(e.id), event: e.name, data: json(e.data) });
      let open = true;
      const off = app.bus.subscribe((e) => {
        if (open) void stream.writeSSE({ id: String(e.id), event: e.name, data: json(e.data) });
      });
      stream.onAbort(() => {
        open = false;
        off();
      });
      while (open) {
        await stream.writeSSE({ event: "ping", data: new Date().toISOString() });
        await stream.sleep(15000);
      }
    }),
  );

  // ---- OpenAPI
  h.get("/openapi.json", (c) => reply(c, openApi()));

  return h;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function openApi() {
  const s = (schema: z.ZodType) => z.toJSONSchema(schema);
  return {
    openapi: "3.1.0",
    info: {
      title: "Mandate API",
      version: "0.1.0",
      description: "Agent runtime for the Mandate wallet agent. Testnet only.",
    },
    paths: {
      "/health": { get: { summary: "Liveness and startup checks" } },
      "/config": { get: { summary: "Public runtime configuration" } },
      "/mandate": { get: { summary: "Mirror of the on-chain mandate" } },
      "/portfolio": { get: { summary: "Vault and agent balances" } },
      "/chat": {
        get: { summary: "Chat history" },
        post: {
          summary: "Send an owner message to the agent",
          requestBody: { content: { "application/json": { schema: s(chatBody) } } },
          responses: {
            "200": {
              description: "reply, plan and intent ids",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      reply: { type: "string" },
                      plan: s(planSchema),
                      intentIds: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/quarantine": {
        post: {
          summary: "Ingest untrusted content into quarantine",
          requestBody: { content: { "application/json": { schema: s(quarantineBody) } } },
        },
      },
      "/intents": { get: { summary: "List intents with verdicts and traces" } },
      "/intents/{id}": { get: { summary: "One intent" } },
      "/approvals": { get: { summary: "Tier 2 approval inbox" } },
      "/approvals/{id}/approve": {
        post: {
          summary: "Approve (owner session required)",
          requestBody: { content: { "application/json": { schema: s(approveBody) } } },
        },
      },
      "/approvals/{id}/decline": {
        post: {
          summary: "Decline (owner session required)",
          requestBody: { content: { "application/json": { schema: s(declineBody) } } },
        },
      },
      "/approvals/{id}/typed-data": {
        get: { summary: "EIP-712 payload the owner signs in MetaMask mode" },
      },
      "/mandate/asset": {
        post: {
          summary: "Owner: set asset caps",
          requestBody: { content: { "application/json": { schema: s(assetMandateBody) } } },
        },
      },
      "/mandate/target": {
        post: {
          summary: "Owner: allow or disallow a target",
          requestBody: { content: { "application/json": { schema: s(targetBody) } } },
        },
      },
      "/mandate/selector": {
        post: {
          summary: "Owner: allow or disallow a (target, selector)",
          requestBody: { content: { "application/json": { schema: s(selectorBody) } } },
        },
      },
      "/mandate/agent": {
        post: {
          summary: "Owner: set agent expiry and active flag",
          requestBody: { content: { "application/json": { schema: s(agentBody) } } },
        },
      },
      "/mandate/pause": { post: { summary: "Owner: pause the vault (kill switch)" } },
      "/mandate/unpause": { post: { summary: "Owner: unpause" } },
      "/mandate/revoke": { post: { summary: "Owner: revoke the agent (kill switch)" } },
      "/contacts": {
        get: { summary: "Address book" },
        post: {
          summary: "Owner: add a contact",
          requestBody: { content: { "application/json": { schema: s(contactBody) } } },
        },
      },
      "/memory": {
        get: { summary: "Memory store with provenance" },
        post: {
          summary: "Write a memory entry (owner session gives owner provenance)",
          requestBody: { content: { "application/json": { schema: s(memoryBody) } } },
        },
      },
      "/audit": { get: { summary: "Hash-chained audit log" } },
      "/audit/verify": {
        get: { summary: "Verify the stored chain" },
        post: { summary: "Verify a supplied copy of the chain" },
      },
      "/audit/export": { get: { summary: "Download the log as JSONL" } },
      "/auth/passkey/register/options": { post: { summary: "Begin passkey registration" } },
      "/auth/passkey/register/verify": {
        post: { summary: "Finish passkey registration; returns an owner session" },
      },
      "/auth/passkey/assert/options": { post: { summary: "Begin passkey assertion" } },
      "/auth/passkey/assert/verify": {
        post: { summary: "Finish assertion; returns an owner session" },
      },
      "/attacks/catalog": {
        get: { summary: "The attack catalog and the four defence configurations" },
      },
      "/attacks/run": {
        post: { summary: "Run the attack suite; configuration D uses the real pipeline and vault" },
      },
      "/attacks/runs": { get: { summary: "Past attack runs" } },
      "/attacks/latest": { get: { summary: "The most recent run report" } },
      "/identity": {
        get: { summary: "Our ERC-8004 card, the oracle's card and the Know Your Agent check" },
      },
      "/.well-known/agent.json": { get: { summary: "ERC-8004 registration file for our agent" } },
      "/x402/history": {
        get: { summary: "x402 payments made from petty cash, with policy reasons" },
      },
      "/x402/float": { get: { summary: "Petty cash float balance and limits" } },
      "/events": {
        get: {
          summary:
            "Server-sent events: intent.updated, trace.step, approval.created, approval.updated, audit.appended, mandate.updated, chat.message",
        },
      },
    },
  };
}
