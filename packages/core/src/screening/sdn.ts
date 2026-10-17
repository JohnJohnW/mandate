import { readFileSync } from "node:fs";
import type { ScreeningResult } from "../policy/types.js";

/**
 * Local sanctions list loader. The data file is a snapshot of the OFAC SDN
 * digital-currency addresses for Ethereum, refreshed by the refresh script.
 * The policy engine denies when the snapshot is missing or stale. [OFAC-SDN]
 */
export interface SanctionsList {
  source: string;
  fetchedAt: bigint;
  addresses: Set<string>;
}

export interface SanctionsFile {
  source: string;
  fetchedAt: string; // ISO-8601
  count: number;
  addresses: string[];
}

export const SDN_ETH_URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json";

export function parseSanctionsFile(json: string): SanctionsList {
  const f = JSON.parse(json) as SanctionsFile;
  if (!Array.isArray(f.addresses) || typeof f.fetchedAt !== "string") {
    throw new Error("malformed sanctions file");
  }
  const ms = Date.parse(f.fetchedAt);
  if (Number.isNaN(ms)) throw new Error("malformed fetchedAt in sanctions file");
  return {
    source: f.source,
    fetchedAt: BigInt(Math.floor(ms / 1000)),
    addresses: new Set(f.addresses.map((a) => a.toLowerCase())),
  };
}

export function loadSanctionsList(path: string): SanctionsList | undefined {
  try {
    return parseSanctionsFile(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Merges extra denylists (for example a demo denylist) into one list; the oldest fetchedAt wins. */
export function mergeLists(lists: SanctionsList[]): SanctionsList {
  const first = lists[0];
  if (!first) throw new Error("no lists to merge");
  return {
    source: lists.map((l) => l.source).join(" + "),
    fetchedAt: lists.reduce((m, l) => (l.fetchedAt < m ? l.fetchedAt : m), first.fetchedAt),
    addresses: new Set(lists.flatMap((l) => [...l.addresses])),
  };
}

export function screenAddresses(
  list: SanctionsList | undefined,
  addresses: string[],
  maxAgeSeconds: bigint,
  oracleSanctioned?: boolean,
): ScreeningResult {
  if (!list) {
    return { loaded: false, listSource: "none", listSize: 0, maxAgeSeconds, hits: [] };
  }
  const hits = addresses.map((a) => a.toLowerCase()).filter((a) => list.addresses.has(a));
  const result: ScreeningResult = {
    loaded: true,
    listFetchedAt: list.fetchedAt,
    listSource: list.source,
    listSize: list.addresses.size,
    maxAgeSeconds,
    hits,
  };
  if (oracleSanctioned !== undefined) result.oracleSanctioned = oracleSanctioned;
  return result;
}
