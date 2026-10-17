import { ZERO_ADDRESS, MAX_UINT256, selectorOf } from "../intent/schema.js";
import type { Intent } from "../intent/schema.js";
import { kindName } from "../intent/kinds.js";
import type { Hex } from "viem";
import type { MandateMirror, Tier } from "./types.js";
import { rollWindow } from "./window.js";

export interface ChainClassification {
  tier: Tier;
  reason: string;
}

/**
 * Mirrors MandateVault.classify(agent, intent): what the chain itself would do
 * with this intent, with no off-chain rules at all. Tier 1 means execute()
 * would pass the mandate checks; Tier 2 means executeWithApproval() would;
 * Tier 3 means neither path exists. Reasons use the contract's error names.
 */
export function classifyOnChain(
  intent: Intent,
  m: MandateMirror,
  now: bigint,
  calldata?: Hex,
): ChainClassification {
  const kind = kindName(intent.kind);
  if (!kind) return { tier: 3, reason: "UnknownKind" };
  if (m.paused) return { tier: 3, reason: "EnforcedPause" };
  if (!m.active) return { tier: 3, reason: "AgentNotActive" };
  if (now > m.expiry) return { tier: 3, reason: "MandateExpired" };
  if (now > intent.deadline) return { tier: 3, reason: "IntentExpired" };
  if (intent.nonce !== m.nextNonce) return { tier: 3, reason: "BadNonce" };

  const token = intent.token.toLowerCase();
  const target = intent.target.toLowerCase();
  if (kind === "TRANSFER_NATIVE" && token !== ZERO_ADDRESS)
    return { tier: 3, reason: "TokenMismatch" };
  if (kind !== "TRANSFER_NATIVE" && kind !== "CALL" && token === ZERO_ADDRESS)
    return { tier: 3, reason: "TokenMismatch" };
  const asset = m.assets[token];
  if (!asset || !asset.enabled) return { tier: 3, reason: "AssetNotEnabled" };

  if (kind === "TOPUP_PETTY_CASH" && target !== m.agent.toLowerCase())
    return { tier: 3, reason: "PettyCashTargetNotAgent" };
  if (kind === "APPROVE_ERC20" && intent.amount === MAX_UINT256)
    return { tier: 3, reason: "UnlimitedApproval" };

  let targetAllowed = m.allowedTargets.includes(target);
  if (kind === "CALL") {
    if (!calldata) return { tier: 3, reason: "CalldataMissing" };
    const sel = selectorOf(calldata);
    if (!sel) return { tier: 3, reason: "SelectorNotAllowed" };
    const allowed = (m.allowedSelectors[target] ?? []).includes(sel);
    if (!allowed) return { tier: 3, reason: "SelectorNotAllowed" };
    targetAllowed = true; // selector allowlist implies the target
  }

  if (intent.amount > asset.coSignPerTxCap) return { tier: 3, reason: "AboveCoSignCap" };

  if (!targetAllowed) return { tier: 2, reason: "TargetNotAllowed" };
  if (intent.amount > asset.autonomousPerTxCap) return { tier: 2, reason: "AbovePerTxCap" };
  const w = rollWindow(asset, now);
  if (w.spentInWindow + intent.amount > asset.autonomousWindowCap)
    return { tier: 2, reason: "AboveWindowCap" };
  return { tier: 1, reason: "WithinMandate" };
}
