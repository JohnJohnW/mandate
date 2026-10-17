import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";

export interface Config {
  chainId: number;
  chainName: string;
  explorerUrl: string | null;
  vault: string;
  vaultExplorer?: string;
  agent: string;
  owner: string | null;
  ownerMode: "local" | "metamask";
  ownerApprovalAuth: "passkey" | "dev";
  passkeyRegistered: boolean;
  planner: "mock" | "live";
  tokens: { symbol: string; address: string; decimals: number }[];
}

export interface Reason {
  rule: string;
  severity: "info" | "warn" | "escalate" | "deny";
  message: string;
  citations: string[];
}

export interface Verdict {
  tier: number;
  decision: "ALLOW" | "ESCALATE" | "DENY";
  reasons: Reason[];
  riskScore: number;
  citations: string[];
  chainTier: number;
  chainReason: string;
}

export interface TraceStep {
  layer: string;
  name: string;
  status: "pass" | "warn" | "fail" | "skipped" | "pending";
  startedAt: string;
  durationMs: number;
  detail: string;
  citations: string[];
}

export interface IntentView {
  id: string;
  state: string;
  kind: string;
  target: string;
  token: string;
  tokenSymbol: string;
  amount: string;
  amountFormatted: string;
  rationale: string;
  intentHash: string | null;
  nonce: string;
  deadline: string;
  verdict: Verdict | null;
  trace: { steps: TraceStep[]; txHash?: string; finalState?: string } | null;
  simulation: { ok: boolean; method: string; deviation: boolean; revertReason?: string; observedDeltas: Record<string, string> } | null;
  txHash: string | null;
  explorerUrl?: string;
  revertReason: string | null;
  createdAt: string;
  updatedAt: string;
  tier: number | null;
  approval?: { id: string; status: string; expiresAt: string };
}

export interface AssetMandate {
  autonomousPerTxCap: string;
  autonomousWindowCap: string;
  coSignPerTxCap: string;
  spentInWindow: string;
  windowStart: string;
  windowSeconds: string;
  enabled: boolean;
}

export interface Mandate {
  vault: string;
  chainId: number;
  agent: string;
  owner: string;
  paused: boolean;
  active: boolean;
  expiry: string;
  nextNonce: string;
  assets: Record<string, AssetMandate>;
  allowedTargets: string[];
  allowedSelectors: Record<string, string[]>;
  observedAtBlock: string;
  observedAt: string;
}

export interface AuditRecord {
  seq: number;
  ts: string;
  actor: string;
  event: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

const SESSION_KEY = "mandate.ownerSession";
export function getOwnerSession(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(SESSION_KEY);
}
export function setOwnerSession(token: string): void {
  window.sessionStorage.setItem(SESSION_KEY, token);
}
export function clearOwnerSession(): void {
  window.sessionStorage.removeItem(SESSION_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}, owner = false): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) };
  if (owner) {
    const s = getOwnerSession();
    if (s) headers["x-owner-session"] = s;
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

/** Makes sure an owner session exists: passkey assertion, first-time registration, or the dev token. */
export async function ensureOwnerSession(cfg: Config): Promise<string> {
  const existing = getOwnerSession();
  if (existing) {
    const r = await api<{ signer: string | null }>("/auth/session", {}, true);
    if (r.signer) return existing;
    clearOwnerSession();
  }
  if (cfg.ownerApprovalAuth === "dev" && !cfg.passkeyRegistered) {
    setOwnerSession("dev");
    return "dev";
  }
  if (cfg.passkeyRegistered) {
    const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/auth/passkey/assert/options", { method: "POST" });
    const response = await startAuthentication({ optionsJSON: options });
    const v = await api<{ session: string }>("/auth/passkey/assert/verify", { method: "POST", body: JSON.stringify({ challengeId, response }) });
    setOwnerSession(v.session);
    return v.session;
  }
  const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/auth/passkey/register/options", { method: "POST" });
  const response = await startRegistration({ optionsJSON: options });
  const v = await api<{ session: string }>("/auth/passkey/register/verify", { method: "POST", body: JSON.stringify({ challengeId, response }) });
  setOwnerSession(v.session);
  return v.session;
}

export function formatUnits(value: string | bigint, decimals: number, maxFrac = 6): string {
  const v = BigInt(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  let frac = s.slice(-decimals).replace(/0+$/, "");
  if (frac.length > maxFrac) frac = frac.slice(0, maxFrac);
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function short(a: string | null | undefined, n = 6): string {
  if (!a) return "";
  return a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}...${a.slice(-n)}` : a;
}

export const SELECTOR_NAMES: Record<string, string> = {
  "0xd0e30db0": "deposit()",
  "0x2e1a7d4d": "withdraw(uint256)",
  "0xa9059cbb": "transfer(address,uint256)",
  "0x095ea7b3": "approve(address,uint256)",
};
