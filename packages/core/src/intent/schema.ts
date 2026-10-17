import { z } from "zod";
import { isAddress, isHex, keccak256, toBytes, type Address, type Hex } from "viem";
import { INTENT_KIND_HASH, INTENT_KIND_NAMES, kindName, type IntentKindName } from "./kinds.js";

export const addressSchema = z
  .string()
  .refine((s) => isAddress(s, { strict: false }), "invalid address")
  .transform((s) => s as Address);

export const bytes32Schema = z
  .string()
  .refine((s) => isHex(s) && s.length === 66, "invalid bytes32")
  .transform((s) => s as Hex);

export const uint256Schema = z
  .union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform((v) => BigInt(v))
  .refine((v) => v >= 0n && v < 2n ** 256n, "out of uint256 range");

export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;
export const ZERO_ADDRESS = `0x${"0".repeat(40)}` as Address;
export const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * The typed intent. Field order here is the EIP-712 field order and the
 * Solidity struct order. Do not reorder without updating the fixtures test.
 */
export const intentSchema = z.object({
  kind: bytes32Schema.refine((h) => kindName(h) !== undefined, "unknown intent kind"),
  target: addressSchema,
  token: addressSchema,
  amount: uint256Schema,
  dataHash: bytes32Schema,
  nonce: uint256Schema,
  deadline: uint256Schema,
  rationaleHash: bytes32Schema,
});

export type Intent = z.infer<typeof intentSchema>;

export const approvalSchema = z.object({
  intentHash: bytes32Schema,
  deadline: uint256Schema,
});
export type Approval = z.infer<typeof approvalSchema>;

/** Human-facing draft the planner produces before it is turned into an Intent. */
export const intentDraftSchema = z.object({
  kind: z.enum(INTENT_KIND_NAMES),
  target: addressSchema,
  token: addressSchema.default(ZERO_ADDRESS),
  amount: uint256Schema,
  data: z
    .string()
    .refine((s) => isHex(s), "invalid hex calldata")
    .transform((s) => s as Hex)
    .default("0x"),
  rationale: z.string().min(1).max(2000),
});
export type IntentDraft = z.infer<typeof intentDraftSchema>;

export function rationaleHash(rationale: string): Hex {
  return keccak256(toBytes(rationale));
}

export function dataHashOf(data: Hex): Hex {
  return data === "0x" ? ZERO_BYTES32 : keccak256(data);
}

/** Builds a full Intent from a validated draft plus the chain-side fields. */
export function buildIntent(
  draft: IntentDraft,
  fields: { nonce: bigint; deadline: bigint },
): Intent {
  const kind: IntentKindName = draft.kind;
  return intentSchema.parse({
    kind: INTENT_KIND_HASH[kind],
    target: draft.target,
    token: draft.token,
    amount: draft.amount,
    dataHash: kind === "CALL" ? dataHashOf(draft.data) : ZERO_BYTES32,
    nonce: fields.nonce,
    deadline: fields.deadline,
    rationaleHash: rationaleHash(draft.rationale),
  });
}

/** Function selector (first 4 bytes) of CALL calldata, or undefined when too short. */
export function selectorOf(data: Hex): Hex | undefined {
  return data.length >= 10 ? (data.slice(0, 10).toLowerCase() as Hex) : undefined;
}
