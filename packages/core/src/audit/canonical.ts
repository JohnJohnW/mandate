/**
 * Canonical JSON: sorted keys, bigint as decimal string, no whitespace.
 * Deterministic so the hash chain can be recomputed anywhere.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    if (obj[k] !== undefined) out[k] = sortValue(obj[k]);
  }
  return out;
}
