import type { Address } from "viem";
import {
  DEFAULT_POLICY_PARAMS,
  INTENT_KIND_HASH,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  type AssetMandate,
  type Intent,
  type MandateMirror,
  type PolicyContext,
  type ScreeningResult,
} from "../src/index.js";

export const NOW = 1_800_000_000n;
export const OWNER = "0xA000000000000000000000000000000000000001" as Address;
export const AGENT = "0xA000000000000000000000000000000000000002" as Address;
export const VAULT = "0xA000000000000000000000000000000000000003" as Address;
export const ALICE = "0x1234567890abcdef1234567890abcdef12345678" as Address;
export const BOB = "0xB0B0000000000000000000000000000000000B0B" as Address;
export const STRANGER = "0xC0FFEE00000000000000000000000000000000CC" as Address;
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
export const WETH = "0x4200000000000000000000000000000000000006" as Address;

export function asset(over: Partial<AssetMandate> = {}): AssetMandate {
  return {
    autonomousPerTxCap: 10n ** 16n, // 0.01 ETH
    autonomousWindowCap: 5n * 10n ** 16n,
    coSignPerTxCap: 10n ** 18n,
    spentInWindow: 0n,
    windowStart: NOW - 100n,
    windowSeconds: 86400n,
    enabled: true,
    ...over,
  };
}

export function mandate(over: Partial<MandateMirror> = {}): MandateMirror {
  return {
    vault: VAULT,
    chainId: 84532,
    agent: AGENT,
    owner: OWNER,
    paused: false,
    active: true,
    expiry: NOW + 7n * 86400n,
    nextNonce: 0n,
    assets: {
      [ZERO_ADDRESS]: asset(),
      [USDC.toLowerCase()]: asset({
        autonomousPerTxCap: 5_000_000n,
        autonomousWindowCap: 20_000_000n,
        coSignPerTxCap: 1_000_000_000n,
      }),
    },
    allowedTargets: [ALICE.toLowerCase(), AGENT.toLowerCase()],
    allowedSelectors: { [WETH.toLowerCase()]: ["0xd0e30db0"] }, // deposit()
    observedAtBlock: 1000n,
    observedAt: NOW,
    ...over,
  };
}

export function screeningOk(over: Partial<ScreeningResult> = {}): ScreeningResult {
  return {
    loaded: true,
    listFetchedAt: NOW - 3600n,
    listSource: "test",
    listSize: 120,
    maxAgeSeconds: 7n * 86400n,
    hits: [],
    ...over,
  };
}

export function intent(over: Partial<Intent> = {}): Intent {
  return {
    kind: INTENT_KIND_HASH.TRANSFER_NATIVE,
    target: ALICE,
    token: ZERO_ADDRESS,
    amount: 5n * 10n ** 15n,
    dataHash: ZERO_BYTES32,
    nonce: 0n,
    deadline: NOW + 600n,
    rationaleHash: ZERO_BYTES32,
    ...over,
  };
}

export function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    now: NOW,
    currentBlock: 5000n,
    mandate: mandate(),
    addressBook: [{ name: "Alice", address: ALICE, addedAt: NOW - 86400n, source: "owner" }],
    spendHistory: [],
    inboundHistory: [],
    screening: screeningOk(),
    provenance: {
      target: { source: "owner", origin: "owner message" },
      amount: { source: "owner", origin: "owner message" },
    },
    untrustedInputs: [],
    params: { ...DEFAULT_POLICY_PARAMS, dustThreshold: { [ZERO_ADDRESS]: 10n ** 12n } },
    ...over,
  };
}
