/**
 * Address similarity helpers for the poisoning rule. [INC-ADDRPOISON]
 */
export interface Lookalike {
  address: string;
  label: string;
  kind: "prefix_suffix_4" | "prefix_suffix_6_partial" | "close_levenshtein";
  distance: number;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n] ?? 0;
}

function hex(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "");
}

/**
 * Finds known addresses that a human would confuse with the target. The first
 * and last four hex characters are what wallets and explorers show, so a match
 * on both with a different middle is the poisoning signature.
 */
export function findLookalikes(
  target: string,
  known: { address: string; label: string }[],
  maxDistance = 6,
): Lookalike[] {
  const t = hex(target);
  const out: Lookalike[] = [];
  const seen = new Set<string>();
  for (const k of known) {
    const kh = hex(k.address);
    if (kh === t || seen.has(kh)) continue;
    seen.add(kh);
    const d = levenshtein(t, kh);
    if (t.slice(0, 4) === kh.slice(0, 4) && t.slice(-4) === kh.slice(-4)) {
      out.push({ address: k.address, label: k.label, kind: "prefix_suffix_4", distance: d });
    } else if (t.slice(0, 6) === kh.slice(0, 6) || t.slice(-6) === kh.slice(-6)) {
      out.push({
        address: k.address,
        label: k.label,
        kind: "prefix_suffix_6_partial",
        distance: d,
      });
    } else if (d <= maxDistance) {
      out.push({ address: k.address, label: k.label, kind: "close_levenshtein", distance: d });
    }
  }
  return out;
}
