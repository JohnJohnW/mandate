import {
  loadSanctionsList,
  mergeLists,
  screenAddresses,
  type SanctionsList,
  type ScreeningResult,
} from "@mandate/core";
import { ROOT } from "./config.js";

/** Loads the OFAC snapshot and the demo denylist once; screening is a pure lookup after that. */
export class ScreeningProvider {
  readonly list: SanctionsList | undefined;
  readonly maxAgeSeconds: bigint;

  constructor(maxAgeDays: number, extraPaths: string[] = []) {
    this.maxAgeSeconds = BigInt(maxAgeDays) * 86400n;
    const paths = [
      `${ROOT}packages/core/data/sdn-eth.json`,
      `${ROOT}packages/core/data/demo-denylist.json`,
      ...extraPaths,
    ];
    const lists = paths.map(loadSanctionsList).filter((l): l is SanctionsList => l !== undefined);
    // the OFAC list must be present; the demo denylist alone is not a sanctions source
    this.list =
      lists.length > 0 && lists[0] !== undefined && paths[0] && loadSanctionsList(paths[0])
        ? mergeLists(lists)
        : undefined;
  }

  screen(addresses: string[], nowSeconds: bigint, oracleSanctioned?: boolean): ScreeningResult {
    const r = screenAddresses(this.list, addresses, this.maxAgeSeconds, oracleSanctioned);
    void nowSeconds;
    return r;
  }

  freshness(nowSeconds: bigint): { ok: boolean; ageSeconds: bigint; detail: string } {
    if (!this.list) return { ok: false, ageSeconds: 0n, detail: "sanctions list not loaded" };
    const age = nowSeconds - this.list.fetchedAt;
    return {
      ok: age <= this.maxAgeSeconds,
      ageSeconds: age,
      detail: `${this.list.addresses.size} addresses, ${Number(age / 3600n)} h old, limit ${Number(this.maxAgeSeconds / 86400n)} days`,
    };
  }
}
