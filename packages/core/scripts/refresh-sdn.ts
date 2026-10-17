/**
 * Refreshes data/sdn-eth.json from the public OFAC SDN digital-currency parse.
 * Run: pnpm --filter @mandate/core screening:refresh
 */
import { writeFileSync } from "node:fs";
import { SDN_ETH_URL, type SanctionsFile } from "../src/screening/sdn.js";

const res = await fetch(SDN_ETH_URL);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const addresses = (await res.json()) as string[];
if (!Array.isArray(addresses) || addresses.length === 0) throw new Error("unexpected list shape");
const file: SanctionsFile = {
  source: SDN_ETH_URL,
  fetchedAt: new Date().toISOString(),
  count: addresses.length,
  addresses: addresses.map((a) => a.toLowerCase()).sort(),
};
const out = new URL("../data/sdn-eth.json", import.meta.url).pathname;
writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
console.log(`wrote ${addresses.length} addresses to ${out}`);
