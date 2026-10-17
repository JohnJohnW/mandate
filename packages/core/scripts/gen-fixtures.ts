/**
 * Writes fixtures shared with the Foundry suite so the contract and this
 * package are pinned to the same EIP-712 hashes and window accounting.
 * Run: pnpm --filter @mandate/core fixtures
 */
import { writeFileSync } from "node:fs";
import { getAddress, type Address } from "viem";
import {
  APPROVAL_TYPEHASH,
  APPROVAL_TYPE_STRING,
  INTENT_KIND_HASH,
  INTENT_TYPEHASH,
  INTENT_TYPE_STRING,
  EIP712_NAME,
  EIP712_VERSION,
  approvalHash,
  intentHash,
  type Intent,
} from "../src/intent/index.js";
import { applySpend, rollWindow } from "../src/policy/window.js";
import type { AssetMandate } from "../src/policy/types.js";

const dir = new URL("../fixtures/", import.meta.url).pathname;

// EIP-712 fixture
const chainId = 84532;
const vault: Address = getAddress("0x00000000000000000000000000000000000012ab");
const sample: Intent = {
  kind: INTENT_KIND_HASH.TRANSFER_ERC20,
  target: "0x1111111111111111111111111111111111111111",
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: 1_000_000n,
  dataHash: `0x${"0".repeat(64)}`,
  nonce: 7n,
  deadline: 1_800_000_000n,
  rationaleHash: "0x5f5e1a3b7b1f6c3c2a7a3d9a6a4f2e1d0c9b8a7f6e5d4c3b2a19080706050403",
};
const ih = intentHash(sample, chainId, vault);
const eip712 = {
  name: EIP712_NAME,
  version: EIP712_VERSION,
  intentTypeString: INTENT_TYPE_STRING,
  intentTypeHash: INTENT_TYPEHASH,
  approvalTypeString: APPROVAL_TYPE_STRING,
  approvalTypeHash: APPROVAL_TYPEHASH,
  kinds: INTENT_KIND_HASH,
  sample: {
    chainId,
    vault,
    intent: {
      ...sample,
      amount: sample.amount.toString(),
      nonce: sample.nonce.toString(),
      deadline: sample.deadline.toString(),
    },
    intentHash: ih,
    approvalDeadline: "1800003600",
    approvalHash: approvalHash({ intentHash: ih, deadline: 1_800_003_600n }, chainId, vault),
  },
};
writeFileSync(`${dir}eip712.json`, JSON.stringify(eip712, null, 2) + "\n");

// Window accounting fixture: deterministic pseudo-random sequences
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const rand = lcg(20261017);
const cases = [];
for (let c = 0; c < 8; c++) {
  const windowSeconds = BigInt([3600, 86400, 600][c % 3]!);
  let asset: AssetMandate = {
    autonomousPerTxCap: BigInt(Math.floor(rand() * 900) + 100),
    autonomousWindowCap: BigInt(Math.floor(rand() * 4000) + 1000),
    coSignPerTxCap: 10_000n,
    spentInWindow: 0n,
    windowStart: 1_700_000_000n,
    windowSeconds,
    enabled: true,
  };
  let now = asset.windowStart;
  const steps = [];
  for (let i = 0; i < 24; i++) {
    now += BigInt(Math.floor(rand() * Number(windowSeconds) * 0.4));
    const amount = BigInt(Math.floor(rand() * Number(asset.autonomousPerTxCap) * 1.2));
    const w = rollWindow(asset, now);
    const withinPerTx = amount <= asset.autonomousPerTxCap;
    const withinWindow = w.spentInWindow + amount <= asset.autonomousWindowCap;
    const allowed = withinPerTx && withinWindow;
    if (allowed) asset = applySpend(asset, now, amount);
    else asset = { ...asset, ...w }; // the contract rolls the window before it rejects, so mirror that
    steps.push({
      now: now.toString(),
      amount: amount.toString(),
      allowed,
      spentAfter: asset.spentInWindow.toString(),
      windowStartAfter: asset.windowStart.toString(),
    });
  }
  cases.push({
    autonomousPerTxCap: asset.autonomousPerTxCap.toString(),
    autonomousWindowCap: asset.autonomousWindowCap.toString(),
    windowSeconds: windowSeconds.toString(),
    initialWindowStart: "1700000000",
    steps,
  });
}
writeFileSync(`${dir}window.json`, JSON.stringify({ cases }, null, 2) + "\n");
console.log("fixtures written");
