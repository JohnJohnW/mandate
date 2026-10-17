import type { Address, Hex } from "viem";
import type { Intent } from "../intent/schema.js";
import type { Provenance, UntrustedInput } from "../provenance/types.js";

export type Tier = 0 | 1 | 2 | 3;
export type Decision = "ALLOW" | "ESCALATE" | "DENY";
export type Severity = "info" | "warn" | "escalate" | "deny";

export interface Reason {
  rule: string;
  severity: Severity;
  message: string;
  citations: string[];
}

export interface Verdict {
  tier: Tier;
  decision: Decision;
  reasons: Reason[];
  /** 0 to 100. Informational; never the sole basis of ALLOW. */
  riskScore: number;
  citations: string[];
  /** The tier the chain itself would assign, before off-chain rules. */
  chainTier: Tier;
  chainReason: string;
}

/** Mirror of MandateVault.AssetMandate. All amounts in base units. */
export interface AssetMandate {
  autonomousPerTxCap: bigint;
  autonomousWindowCap: bigint;
  coSignPerTxCap: bigint;
  spentInWindow: bigint;
  windowStart: bigint;
  windowSeconds: bigint;
  enabled: boolean;
}

/** Mirror of the on-chain mandate for one agent, read from the vault. */
export interface MandateMirror {
  vault: Address;
  chainId: number;
  agent: Address;
  owner: Address;
  paused: boolean;
  active: boolean;
  expiry: bigint;
  nextNonce: bigint;
  /** keyed by lowercase token address, zero address for native */
  assets: Record<string, AssetMandate>;
  /** lowercase addresses */
  allowedTargets: string[];
  /** lowercase target -> lowercase selectors */
  allowedSelectors: Record<string, string[]>;
  observedAtBlock: bigint;
  observedAt: bigint;
}

export interface Contact {
  name: string;
  address: Address;
  addedAt: bigint;
  source: "owner";
}

export interface SpendRecord {
  ts: bigint;
  token: Address;
  amount: bigint;
  target: Address;
  tier: Tier;
}

export interface InboundRecord {
  ts: bigint;
  from: Address;
  token: Address;
  amount: bigint;
}

export interface ScreeningResult {
  /** Unix seconds the list was fetched; undefined when loading failed. */
  listFetchedAt?: bigint;
  listSource: string;
  listSize: number;
  loaded: boolean;
  maxAgeSeconds: bigint;
  /** lowercase addresses that matched */
  hits: string[];
  /** optional on-chain oracle answer, undefined when not available on this chain */
  oracleSanctioned?: boolean;
}

export interface TargetInfo {
  isContract: boolean;
  /** null when the explorer could not be reached */
  sourceVerified: boolean | null;
  deployedAtBlock?: bigint;
  codeHash?: Hex;
}

export interface SimulationResult {
  ok: boolean;
  method: "eth_simulateV1" | "eth_call" | "none";
  /** expected vs observed deltas, token -> amount (negative = outflow from vault) */
  expectedDeltas: Record<string, bigint>;
  observedDeltas: Record<string, bigint>;
  deviation: boolean;
  revertReason?: string;
}

export interface OwnerStatement {
  /** lowercase addresses the owner named or that resolved from owner contacts */
  targets: string[];
  amounts: bigint[];
}

export interface PolicyParams {
  /** blocks below which a contract counts as newly deployed */
  newContractBlocks: bigint;
  /** dust threshold per token (base units), used by the poisoning rule */
  dustThreshold: Record<string, bigint>;
  /** quiet hours in UTC, start and end hour; undefined disables the check */
  quietHoursUtc?: { start: number; end: number };
  /** max autonomous intents per hour before a velocity flag */
  maxPerHour: number;
  /** selectors the agent can never call, lowercase 4-byte hex */
  deniedSelectors: string[];
}

export interface PolicyContext {
  now: bigint;
  currentBlock: bigint;
  mandate: MandateMirror;
  addressBook: Contact[];
  spendHistory: SpendRecord[];
  inboundHistory: InboundRecord[];
  screening: ScreeningResult;
  targetInfo?: TargetInfo;
  simulation?: SimulationResult;
  /** provenance of the intent fields that an attacker could influence */
  provenance: { target: Provenance; amount: Provenance; data?: Provenance };
  untrustedInputs: UntrustedInput[];
  ownerStatement?: OwnerStatement;
  /** calldata for CALL intents (the intent only carries its hash) */
  calldata?: Hex;
  params: PolicyParams;
}

export type Rule = (intent: Intent, ctx: PolicyContext) => Reason[];

export const DEFAULT_POLICY_PARAMS: PolicyParams = {
  newContractBlocks: 1000n,
  dustThreshold: {},
  maxPerHour: 10,
  deniedSelectors: [
    "0xa22cb465", // setApprovalForAll(address,bool)
    "0x3659cfe6", // upgradeTo(address)
    "0x4f1ef286", // upgradeToAndCall(address,bytes)
    "0xf2fde38b", // transferOwnership(address)
    "0xd505accf", // permit(...) EIP-2612, phishing vector
    "0x8fcbaf0c", // permit(...) DAI style
  ],
};
