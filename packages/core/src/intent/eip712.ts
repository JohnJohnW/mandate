import {
  hashTypedData,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import type { Approval, Intent } from "./schema.js";

/**
 * EIP-712 definitions. The type strings below are the single source of truth;
 * the Solidity constants are checked against fixtures/eip712.json in the
 * Foundry suite. [EIP-712]
 */
export const EIP712_NAME = "MandateVault";
export const EIP712_VERSION = "1";

export const INTENT_FIELDS = [
  { name: "kind", type: "bytes32" },
  { name: "target", type: "address" },
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "dataHash", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "rationaleHash", type: "bytes32" },
] as const;

export const APPROVAL_FIELDS = [
  { name: "intentHash", type: "bytes32" },
  { name: "deadline", type: "uint256" },
] as const;

export const EIP712_TYPES = {
  Intent: INTENT_FIELDS,
  Approval: APPROVAL_FIELDS,
} as const;

function typeString(name: string, fields: readonly { name: string; type: string }[]): string {
  return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
}

export const INTENT_TYPE_STRING = typeString("Intent", INTENT_FIELDS);
export const APPROVAL_TYPE_STRING = typeString("Approval", APPROVAL_FIELDS);
export const INTENT_TYPEHASH: Hex = keccak256(toBytes(INTENT_TYPE_STRING));
export const APPROVAL_TYPEHASH: Hex = keccak256(toBytes(APPROVAL_TYPE_STRING));

export function vaultDomain(chainId: number, verifyingContract: Address): TypedDataDomain {
  return { name: EIP712_NAME, version: EIP712_VERSION, chainId, verifyingContract };
}

/** EIP-712 digest of an intent. Equals MandateVault.intentHash(intent). */
export function intentHash(intent: Intent, chainId: number, vault: Address): Hex {
  return hashTypedData({
    domain: vaultDomain(chainId, vault),
    types: EIP712_TYPES,
    primaryType: "Intent",
    message: intent,
  });
}

/** EIP-712 digest of an approval. Equals MandateVault.approvalHash(intentHash, deadline). */
export function approvalHash(approval: Approval, chainId: number, vault: Address): Hex {
  return hashTypedData({
    domain: vaultDomain(chainId, vault),
    types: EIP712_TYPES,
    primaryType: "Approval",
    message: approval,
  });
}

/** Arguments for viem signTypedData, so callers never rebuild the shape by hand. */
export function intentTypedData(intent: Intent, chainId: number, vault: Address) {
  return {
    domain: vaultDomain(chainId, vault),
    types: EIP712_TYPES,
    primaryType: "Intent" as const,
    message: intent,
  };
}

export function approvalTypedData(approval: Approval, chainId: number, vault: Address) {
  return {
    domain: vaultDomain(chainId, vault),
    types: EIP712_TYPES,
    primaryType: "Approval" as const,
    message: approval,
  };
}
