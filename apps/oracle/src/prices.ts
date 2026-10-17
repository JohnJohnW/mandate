/**
 * The oracle's data. Prices are a deterministic simulation for a testnet demo
 * (a smooth drift around a base value seeded by the hour), clearly labelled as
 * simulated. Risk scores combine the sanctions snapshot with simple address
 * heuristics. Nothing here is investment advice or market data.
 */
import { loadSanctionsList, mergeLists } from "@mandate/core";
import { ROOT } from "./config.js";

const BASE: Record<string, number> = { ETH: 2650, USDC: 1, WETH: 2650 };

export function simulatedPrices(now = Date.now()) {
  const hour = Math.floor(now / 3_600_000);
  const out: Record<string, { usd: number; source: string }> = {};
  for (const [sym, base] of Object.entries(BASE)) {
    const drift = sym === "USDC" ? 0 : Math.sin(hour / 7) * 0.012 * base;
    out[sym] = { usd: Math.round((base + drift) * 100) / 100, source: "simulated (testnet demo)" };
  }
  return {
    asOf: new Date(now).toISOString(),
    prices: out,
    disclaimer: "Simulated prices for a testnet demonstration. Not market data.",
  };
}

const lists = [
  `${ROOT}packages/core/data/sdn-eth.json`,
  `${ROOT}packages/core/data/demo-denylist.json`,
]
  .map(loadSanctionsList)
  .filter((l) => l !== undefined);
const merged = lists.length
  ? mergeLists(lists as NonNullable<(typeof lists)[number]>[])
  : undefined;

export function riskReport(address: string) {
  const a = address.toLowerCase();
  const sanctioned = merged?.addresses.has(a) ?? false;
  const flags: string[] = [];
  if (sanctioned) flags.push("on the sanctions snapshot");
  if (/^0x(0{6}|dead|bad0|c0ffee)/i.test(a) || /(0{8}|dead)$/i.test(a))
    flags.push("vanity or placeholder pattern");
  const score = sanctioned ? 100 : flags.length ? 40 : 5;
  return {
    address,
    score,
    sanctioned,
    flags,
    listSize: merged?.addresses.size ?? 0,
    asOf: new Date().toISOString(),
    disclaimer: "Heuristic risk score for a testnet demonstration.",
  };
}
