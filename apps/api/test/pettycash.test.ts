import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { createApp, type App } from "../src/app.js";
import { MockPlanner } from "../src/planner/mock.js";
import { X402Payer } from "../src/x402.js";
import type { Identity } from "../src/identity.js";
import { anvilUp, deployFixture, type Fixture } from "./anvil.js";

const up = await anvilUp();

describe.skipIf(!up)("petty cash policy", () => {
  let fx: Fixture;
  let app: App;
  const oracle = getAddress("0x7e955b45ea32dbde3423cd9a22e387442f2e429c");

  const payerWith = (kyaOk: boolean) => {
    const identity = {
      knowYourAgent: async () => ({
        ok: kyaOk,
        detail: kyaOk
          ? "payee matches the registered wallet of ERC-8004 agent #1"
          : "no registration",
      }),
    } as unknown as Identity;
    return new X402Payer(
      fx.cfg,
      app.clients,
      app.db,
      app.bus,
      app.intents,
      app.screening,
      identity,
    );
  };

  beforeAll(async () => {
    fx = await deployFixture();
    app = await createApp(fx.cfg, { planner: new MockPlanner() });
  });
  afterAll(() => app?.close());

  it("allows a small USDC payment to a verified counterparty on our chain", async () => {
    const v = await payerWith(true).evaluate(
      { payTo: oracle, amount: 1000n, asset: fx.usdc, network: "eip155:31337" },
      "http://localhost:4020/prices",
    );
    expect(v.allow).toBe(true);
    expect(v.reasons.find((r) => r.rule === "know_your_agent")?.severity).toBe("info");
  });

  it("denies the wrong network, the wrong asset and an over-cap amount", async () => {
    const p = payerWith(true);
    const wrongNet = await p.evaluate(
      { payTo: oracle, amount: 1000n, asset: fx.usdc, network: "eip155:84532" },
      "http://localhost:4020/prices",
    );
    expect(wrongNet.allow).toBe(false);
    expect(wrongNet.reasons.map((r) => r.rule)).toContain("petty_cash_network");
    const wrongAsset = await p.evaluate(
      { payTo: oracle, amount: 1000n, asset: fx.weth, network: "eip155:31337" },
      "http://localhost:4020/prices",
    );
    expect(wrongAsset.reasons.map((r) => r.rule)).toContain("petty_cash_asset");
    const overCap = await p.evaluate(
      { payTo: oracle, amount: 50_000n, asset: fx.usdc, network: "eip155:31337" },
      "http://localhost:4020/prices",
    );
    expect(overCap.reasons.map((r) => r.rule)).toContain("petty_cash_cap");
  });

  it("denies a sanctioned payee and an unverifiable counterparty", async () => {
    const sanctioned = await payerWith(true).evaluate(
      {
        payTo: getAddress("0xbad0000000000000000000000000000000000bad"),
        amount: 1000n,
        asset: fx.usdc,
        network: "eip155:31337",
      },
      "http://localhost:4020/prices",
    );
    expect(sanctioned.allow).toBe(false);
    expect(sanctioned.reasons.map((r) => r.rule)).toContain("screening");
    const unknown = await payerWith(false).evaluate(
      { payTo: oracle, amount: 1000n, asset: fx.usdc, network: "eip155:31337" },
      "http://localhost:4020/prices",
    );
    expect(unknown.allow).toBe(false);
    expect(unknown.reasons.find((r) => r.rule === "know_your_agent")?.severity).toBe("deny");
  });

  it("tops the float up from the vault through a Tier 1 intent when it is low", async () => {
    const p = payerWith(true);
    const before = await p.floatBalance();
    expect(before).toBeLessThan(p.limits.minFloatUsdc); // the fixture mints 1 USDC to the agent, floor is 0.2 by default: adjust if limits change
    const r = await p.ensureFloat();
    const after = await p.floatBalance();
    if (before < p.limits.minFloatUsdc) {
      expect(r.topped).toBe(true);
      expect(after - before).toBe(p.limits.topupUsdc);
      const last = app.intents.list(1)[0]!;
      expect(last.kind).toBe("TOPUP_PETTY_CASH");
      expect(last.state).toBe("Executed");
    }
  });
});
