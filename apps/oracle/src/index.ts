/**
 * The oracle agent: a paid price and risk API behind x402, with an ERC-8004
 * agent card. It is the counterparty our wallet agent pays per request.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { defineChain, http, createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, baseSepolia, sepolia } from "viem/chains";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { IDENTITY_REGISTRY_ABI } from "@mandate/contracts";
import { loadOracleConfig } from "./config.js";
import { createLocalFacilitatorClient } from "./facilitator.js";
import { riskReport, simulatedPrices } from "./prices.js";

const cfg = loadOracleConfig();
const account = privateKeyToAccount(cfg.oraclePrivateKey);
const base = cfg.chainId === 84532 ? baseSepolia : cfg.chainId === 11155111 ? sepolia : anvil;
const chain = defineChain({ ...base, rpcUrls: { default: { http: [cfg.rpcUrl] } } });
const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

const facilitatorClient = cfg.localFacilitator
  ? createLocalFacilitatorClient(chain, cfg.rpcUrl, cfg.oraclePrivateKey, cfg.network)
  : new HTTPFacilitatorClient({ url: cfg.facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  cfg.network as never,
  new ExactEvmScheme(),
);
// Learn the supported kinds from the facilitator up front (the in-process one answers immediately).
await resourceServer.initialize();

// On public testnets the money parser resolves "$0.001" to USDC; on Anvil the mock USDC is named explicitly.
const priceUnits = BigInt(Math.round(Number(cfg.priceUsdc) * 1e6)).toString();
const price = cfg.localFacilitator
  ? { asset: cfg.usdcAddress, amount: priceUnits, extra: { name: "USDC", version: "2" } }
  : `$${cfg.priceUsdc}`;

const app = new Hono();
app.use("*", cors());
app.use(
  paymentMiddleware(
    {
      "GET /prices": {
        accepts: [
          { scheme: "exact", price, network: cfg.network as never, payTo: account.address },
        ],
        description: "Simulated ETH and USDC prices for the Mandate demo",
      },
      "GET /risk/:address": {
        accepts: [
          { scheme: "exact", price, network: cfg.network as never, payTo: account.address },
        ],
        description: "Heuristic address risk report",
      },
    },
    resourceServer,
    undefined,
    undefined,
    false,
  ),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    chainId: cfg.chainId,
    network: cfg.network,
    payTo: account.address,
    facilitator: cfg.localFacilitator ? "in-process (local chain)" : cfg.facilitatorUrl,
    priceUsdc: cfg.priceUsdc,
  }),
);
app.get("/prices", (c) => c.json(simulatedPrices()));
app.get("/risk/:address", (c) => c.json(riskReport(c.req.param("address"))));

/** ERC-8004 registration file and agent card. The agentId is filled in once the registry has one for this wallet. */
app.get("/.well-known/agent.json", async (c) => {
  let registration: { agentId: string; agentWallet: string } | undefined;
  const id = cfg.localFacilitator ? process.env.ANVIL_ORACLE_AGENT_ID : process.env.ORACLE_AGENT_ID;
  if (cfg.identityRegistry && id !== undefined && id !== "") {
    try {
      const wallet = (await publicClient.readContract({
        address: cfg.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "getAgentWallet",
        args: [BigInt(id)],
      })) as string;
      registration = { agentId: id, agentWallet: wallet };
    } catch {
      registration = undefined;
    }
  }
  return c.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Mandate price and risk oracle",
    description:
      "A paid oracle agent that sells simulated prices and address risk reports over x402. Testnet demonstration.",
    image: null,
    services: [
      {
        name: "x402",
        endpoint: `${cfg.publicUrl}/prices`,
        version: "2",
        network: cfg.network,
        payTo: account.address,
        priceUsdc: cfg.priceUsdc,
      },
      {
        name: "x402",
        endpoint: `${cfg.publicUrl}/risk/{address}`,
        version: "2",
        network: cfg.network,
        payTo: account.address,
        priceUsdc: cfg.priceUsdc,
      },
    ],
    supportedTrust: ["reputation"],
    registrations: registration
      ? [
          {
            agentId: Number(registration.agentId),
            agentRegistry: `${cfg.network}:${cfg.identityRegistry}`,
            agentWallet: registration.agentWallet,
          },
        ]
      : [],
    active: true,
    payTo: account.address,
  });
});

serve({ fetch: app.fetch, port: cfg.port }, (info) =>
  console.log(
    `[oracle] listening on http://localhost:${info.port} (${cfg.network}), payTo ${account.address}, facilitator ${cfg.localFacilitator ? "in-process" : cfg.facilitatorUrl}`,
  ),
);
