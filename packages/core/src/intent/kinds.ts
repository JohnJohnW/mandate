import { keccak256, toBytes, type Hex } from "viem";

/**
 * Intent kinds. The on-chain value is keccak256 of the ASCII name, so the
 * contract and this package agree without a shared enum.
 */
export const INTENT_KIND_NAMES = [
  "TRANSFER_NATIVE",
  "TRANSFER_ERC20",
  "CALL",
  "APPROVE_ERC20",
  "TOPUP_PETTY_CASH",
] as const;

export type IntentKindName = (typeof INTENT_KIND_NAMES)[number];

export const INTENT_KIND_HASH: Record<IntentKindName, Hex> = Object.fromEntries(
  INTENT_KIND_NAMES.map((n) => [n, keccak256(toBytes(n))]),
) as Record<IntentKindName, Hex>;

const HASH_TO_NAME = new Map<string, IntentKindName>(
  INTENT_KIND_NAMES.map((n) => [INTENT_KIND_HASH[n].toLowerCase(), n]),
);

export function kindName(hash: Hex): IntentKindName | undefined {
  return HASH_TO_NAME.get(hash.toLowerCase());
}

export function kindHash(name: IntentKindName): Hex {
  return INTENT_KIND_HASH[name];
}
