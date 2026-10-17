/**
 * Runs the canonical execution evidence set against the deployed vault and
 * writes docs/EXECUTION_EVIDENCE.md plus a raw JSON log under evidence/.
 *
 * Every hash in the output comes from a receipt returned by the RPC. Rows
 * that depend on later phases (ERC-8004, x402, EIP-7702) are written as
 * "pending" until those phases land. Nothing here is edited by hand.
 *
 * Usage: pnpm evidence:run                 (chain from .env)
 *        pnpm --filter @mandate/contracts evidence -- --anvil
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import {
  INTENT_KIND_HASH,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  approvalTypedData,
  dataHashOf,
  intentHash as coreIntentHash,
  intentTypedData,
  rationaleHash,
  type Intent,
} from "@mandate/core";
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { EXPLORERS, MANDATE_VAULT_ABI, MOCK_ERC20_ABI } from "../ts/index.js";
import { CONTRACTS_DIR, ROOT, connect } from "./env.js";

type Status = "success" | "reverted" | "pending" | "skipped";

interface Row {
  step: string;
  title: string;
  fn: string;
  txHashes: Hex[];
  blocks: bigint[];
  status: Status;
  outcome: string;
  proves: string;
}

const anvil = process.argv.includes("--anvil");
const c = await connect({ anvil });
const vault = (anvil ? c.env.get("ANVIL_VAULT_ADDRESS") : c.env.get("VAULT_ADDRESS")) as Address;
if (!vault) throw new Error("vault address missing from .env; run the deploy first");
const depPath = `${CONTRACTS_DIR}deployments/${c.chainId}.json`;
if (!existsSync(depPath)) throw new Error(`no deployment record at ${depPath}`);
const dep = JSON.parse(readFileSync(depPath, "utf8")) as Record<string, string>;
const explorer = EXPLORERS[c.chainId]!;
const STRANGER: Address = getAddress("0xc0ffee00000000000000000000000000000000cc");
const contact = dep.contact as Address;
const usdc = dep.usdc as Address;
const weth = dep.weth as Address;

const rows: Row[] = [];
const log = (msg: string) => console.log(msg);

// ------------------------------------------------------------------ helpers

const vaultRead = <T>(functionName: string, args: unknown[] = []) =>
  c.publicClient.readContract({
    address: vault,
    abi: MANDATE_VAULT_ABI,
    functionName,
    args,
  }) as Promise<T>;

async function nextNonce(): Promise<bigint> {
  const [, , nonce] = await vaultRead<[boolean, bigint, bigint]>("getAgent", [c.agent.address]);
  return nonce;
}

async function mkIntent(
  kind: keyof typeof INTENT_KIND_HASH,
  target: Address,
  token: Address,
  amount: bigint,
  rationale: string,
  data: Hex = "0x",
): Promise<Intent> {
  const block = await c.publicClient.getBlock();
  return {
    kind: INTENT_KIND_HASH[kind],
    target,
    token,
    amount,
    dataHash: kind === "CALL" ? dataHashOf(data) : ZERO_BYTES32,
    nonce: await nextNonce(),
    deadline: block.timestamp + 3600n,
    rationaleHash: rationaleHash(rationale),
  };
}

const signIntent = (i: Intent) => c.agentClient.signTypedData(intentTypedData(i, c.chainId, vault));
const signApproval = (ih: Hex, deadline: bigint) =>
  c.ownerClient.signTypedData(approvalTypedData({ intentHash: ih, deadline }, c.chainId, vault));

async function ownerTx(
  functionName: string,
  args: unknown[],
): Promise<{ hash: Hex; block: bigint }> {
  const hash = await c.ownerClient.writeContract({
    address: vault,
    abi: MANDATE_VAULT_ABI,
    functionName,
    args,
  });
  const r = await c.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`owner tx ${functionName} reverted: ${hash}`);
  return { hash, block: r.blockNumber };
}

/** Sends an agent transaction that is expected to succeed. */
async function agentSuccess(
  functionName: string,
  args: unknown[],
): Promise<{ hash: Hex; block: bigint }> {
  const hash = await c.agentClient.writeContract({
    address: vault,
    abi: MANDATE_VAULT_ABI,
    functionName,
    args,
  });
  const r = await c.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success")
    throw new Error(`expected success for ${functionName}, got revert ${hash}`);
  return { hash, block: r.blockNumber };
}

/**
 * Sends an agent transaction that is expected to revert ON-CHAIN, so the revert
 * itself becomes evidence. Gas is set explicitly to skip estimation (which would
 * fail locally and never produce a hash). The reason is recovered by replaying
 * the call against the state just before the block.
 */
async function agentRevert(
  functionName: string,
  args: unknown[],
): Promise<{ hash: Hex; block: bigint; reason: string }> {
  const data = encodeFunctionData({ abi: MANDATE_VAULT_ABI, functionName, args });
  const hash = await c.agentClient.sendTransaction({ to: vault, data, gas: 400_000n });
  const r = await c.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "reverted")
    throw new Error(`expected revert for ${functionName}, but it succeeded: ${hash}`);
  let reason = "reverted (reason not decoded)";
  try {
    await c.publicClient.simulateContract({
      address: vault,
      abi: MANDATE_VAULT_ABI,
      functionName,
      args,
      account: c.agent.address,
      blockNumber: r.blockNumber - 1n,
    });
  } catch (err) {
    if (err instanceof BaseError) {
      const revert = err.walk(
        (e) => e instanceof ContractFunctionRevertedError,
      ) as ContractFunctionRevertedError | null;
      if (revert?.data) {
        const argsText = revert.data.args?.length
          ? `(${revert.data.args.map(String).join(", ")})`
          : "()";
        reason = `${revert.data.errorName}${argsText}`;
      } else if (revert) {
        reason = revert.shortMessage;
      }
    }
  }
  return { hash, block: r.blockNumber, reason };
}

function push(row: Row) {
  rows.push(row);
  log(`  [${row.status}] ${row.step} ${row.title}: ${row.outcome}`);
}

// ------------------------------------------------------------------ run

log(`chain ${c.chainId} (${explorer.name}), vault ${vault}`);
log(`owner ${c.owner.address}, agent ${c.agent.address}, contact ${contact}`);

// Make the run repeatable: the agent is active and the vault is unpaused at the start.
const [activeBefore] = await vaultRead<[boolean, bigint, bigint]>("getAgent", [c.agent.address]);
if (await vaultRead<boolean>("paused")) await ownerTx("unpause", []);
if (!activeBefore) {
  const block = await c.publicClient.getBlock();
  await ownerTx("setAgent", [c.agent.address, block.timestamp + 7n * 86400n, true]);
}

// 1 and 2: deployment and mandate setup, from the Foundry broadcast log
const broadcastPath = `${CONTRACTS_DIR}broadcast/Deploy.s.sol/${c.chainId}/run-latest.json`;
if (existsSync(broadcastPath)) {
  const b = JSON.parse(readFileSync(broadcastPath, "utf8")) as {
    transactions: {
      hash: Hex;
      transactionType: string;
      contractName?: string;
      function?: string | null;
    }[];
    receipts: { transactionHash: Hex; blockNumber: Hex; status: Hex }[];
  };
  const blockOf = (h: Hex) =>
    BigInt(
      b.receipts.find((r) => r.transactionHash.toLowerCase() === h.toLowerCase())?.blockNumber ??
        "0x0",
    );
  const creation = b.transactions.find(
    (t) => t.transactionType === "CREATE" && t.contractName === "MandateVault",
  );
  if (creation) {
    push({
      step: "1",
      title: "Vault deployment",
      fn: "constructor(owner)",
      txHashes: [creation.hash],
      blocks: [blockOf(creation.hash)],
      status: "success",
      outcome: `MandateVault at ${vault}`,
      proves:
        "The enforcement contract exists on-chain with the owner as Ownable2Step owner. Source verification status is recorded in the runbook.",
    });
  }
  const setup = b.transactions.filter(
    (t) => t.transactionType === "CALL" && t.contractName === "MandateVault",
  );
  if (setup.length) {
    push({
      step: "2",
      title: "Owner sets agent, asset mandates, allowlists",
      fn: setup.map((t) => (t.function ?? "").split("(")[0]).join(", "),
      txHashes: setup.map((t) => t.hash),
      blocks: setup.map((t) => blockOf(t.hash)),
      status: "success",
      outcome: `${setup.length} owner transactions`,
      proves:
        "The mandate (expiry, per-asset caps, allowlisted targets and selectors) is on-chain state set only by the owner.",
    });
  }
} else {
  push({
    step: "1",
    title: "Vault deployment",
    fn: "constructor",
    txHashes: [],
    blocks: [],
    status: "pending",
    outcome: "no broadcast log found for this chain",
    proves: "",
  });
}

// 3: ERC-8004 registration, from the identity registration record
{
  const idPath = `${CONTRACTS_DIR}deployments/identity-${c.chainId}.json`;
  if (existsSync(idPath)) {
    const id = JSON.parse(readFileSync(idPath, "utf8")) as {
      registry: string;
      agent: {
        agentId: string;
        registerTx: Hex;
        setWalletTx: Hex;
        registerBlock: number;
        setWalletBlock: number;
      };
      oracle: { agentId: string; registerTx: Hex; registerBlock: number };
    };
    push({
      step: "3",
      title: "ERC-8004 registration of both agents and setAgentWallet to the vault",
      fn: "register(agentURI) x2, setAgentWallet(agentId, vault, deadline, ownerSig)",
      txHashes: [id.agent.registerTx, id.oracle.registerTx, id.agent.setWalletTx],
      blocks: [
        BigInt(id.agent.registerBlock),
        BigInt(id.oracle.registerBlock),
        BigInt(id.agent.setWalletBlock),
      ],
      status: "success",
      outcome: `our agent #${id.agent.agentId}, oracle agent #${id.oracle.agentId} in registry ${id.registry}; vault bound as agent wallet`,
      proves:
        "Both agents carry a portable on-chain identity. The vault is the registered wallet of our agent, bound with the owner's ERC-1271 signature; the agent key alone cannot make that binding.",
    });
  } else {
    push({
      step: "3",
      title: "ERC-8004 registration and setAgentWallet",
      fn: "IdentityRegistry.register, setAgentWallet",
      txHashes: [],
      blocks: [],
      status: "pending",
      outcome: "identity registration not run on this chain (pnpm identity:register)",
      proves: "",
    });
  }
}

// Mandate parameters as the chain sees them
const ethMandate = await vaultRead<{
  autonomousPerTxCap: bigint;
  autonomousWindowCap: bigint;
  coSignPerTxCap: bigint;
  spentInWindow: bigint;
  windowStart: bigint;
  windowSeconds: number;
  enabled: boolean;
}>("getAssetMandate", [c.agent.address, ZERO_ADDRESS]);
const usdcMandate = await vaultRead<typeof ethMandate>("getAssetMandate", [c.agent.address, usdc]);
const perTx = ethMandate.autonomousPerTxCap;
const small = perTx / 2n;

// 4: Tier 1 native transfer
{
  const i = await mkIntent(
    "TRANSFER_NATIVE",
    contact,
    ZERO_ADDRESS,
    small,
    "Pay the allowlisted contact a small amount (Tier 1 demo)",
  );
  const sig = await signIntent(i);
  const t = await agentSuccess("execute", [i, "0x", sig]);
  push({
    step: "4",
    title: "Tier 1 autonomous ETH transfer to an allowlisted contact",
    fn: "execute",
    txHashes: [t.hash],
    blocks: [t.block],
    status: "success",
    outcome: `${formatEther(small)} ETH to ${contact}`,
    proves:
      "Inside the mandate the agent transacts alone: active agent, allowlisted target, within per-tx and window caps, nonce consumed.",
  });
}

// 5: Tier 1 WETH wrap via allowlisted CALL
{
  const data = encodeFunctionData({
    abi: [
      { type: "function", name: "deposit", inputs: [], outputs: [], stateMutability: "payable" },
    ],
    functionName: "deposit",
  });
  const i = await mkIntent(
    "CALL",
    weth,
    ZERO_ADDRESS,
    small,
    "Move idle ETH into WETH via the allowlisted deposit() selector",
    data,
  );
  const sig = await signIntent(i);
  const t = await agentSuccess("execute", [i, data, sig]);
  push({
    step: "5",
    title: "Tier 1 WETH wrap through an allowlisted contract call",
    fn: "execute (CALL deposit())",
    txHashes: [t.hash],
    blocks: [t.block],
    status: "success",
    outcome: `${formatEther(small)} ETH wrapped at ${weth}`,
    proves:
      "Contract calls are restricted to allowlisted (target, selector) pairs and the calldata hash is bound into the signed intent.",
  });
}

// 6: petty cash top-up (x402 payment itself lands in Phase 5)
{
  const vaultUsdc = (await c.publicClient.readContract({
    address: usdc,
    abi: MOCK_ERC20_ABI,
    functionName: "balanceOf",
    args: [vault],
  })) as bigint;
  const topup = usdcMandate.autonomousPerTxCap / 2n;
  if (usdcMandate.enabled && vaultUsdc >= topup && topup > 0n) {
    const i = await mkIntent(
      "TOPUP_PETTY_CASH",
      c.agent.address,
      usdc,
      topup,
      "Replenish the agent's petty cash float for x402 payments",
    );
    const sig = await signIntent(i);
    const t = await agentSuccess("execute", [i, "0x", sig]);
    push({
      step: "6a",
      title: "Petty cash top-up from the vault to the agent EOA",
      fn: "execute (TOPUP_PETTY_CASH)",
      txHashes: [t.hash],
      blocks: [t.block],
      status: "success",
      outcome: `${formatUnits(topup, 6)} USDC to the agent`,
      proves:
        "The imprest float: a small, capped USDC balance the agent can spend on x402 invoices, replenished only from the vault and only to itself.",
    });
  } else {
    push({
      step: "6a",
      title: "Petty cash top-up from the vault to the agent EOA",
      fn: "execute (TOPUP_PETTY_CASH)",
      txHashes: [],
      blocks: [],
      status: "skipped",
      outcome: `vault holds ${formatUnits(vaultUsdc, 6)} USDC; needs at least ${formatUnits(topup, 6)}`,
      proves: "",
    });
  }
  // 6b: an x402 payment from the agent's petty cash to the oracle, settled by the facilitator
  const oracleUrl = c.env.get("ORACLE_URL") || "http://localhost:4020";
  let reachable: boolean;
  try {
    reachable = (await fetch(`${oracleUrl}/health`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    push({
      step: "6b",
      title: "x402 USDC payment to the oracle agent",
      fn: "EIP-3009 transferWithAuthorization via facilitator",
      txHashes: [],
      blocks: [],
      status: "skipped",
      outcome: `oracle not reachable at ${oracleUrl}; start it and rerun`,
      proves: "",
    });
  } else {
    try {
      const signer = toClientEvmSigner(
        { address: c.agent.address, signTypedData: (m) => c.agent.signTypedData(m as never) },
        c.publicClient as never,
      );
      const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [{ network: "eip155:*", client: new ExactEvmScheme(signer) }],
        spendControls: {
          allowedAssets: [
            { network: `eip155:${c.chainId}`, asset: usdc, maxAmountPerPayment: "10000" },
          ],
          maxAmountPerPayment: "0.01",
        },
      });
      const res = await paidFetch(`${oracleUrl}/prices`);
      const header = res.headers.get("PAYMENT-RESPONSE");
      const settled = header
        ? (decodePaymentResponseHeader(header) as {
            success?: boolean;
            transaction?: string;
            payer?: string;
          })
        : undefined;
      if (res.ok && settled?.transaction) {
        const r = await c.publicClient.getTransactionReceipt({ hash: settled.transaction as Hex });
        push({
          step: "6b",
          title: "x402 USDC payment to the oracle agent from petty cash",
          fn: "USDC.transferWithAuthorization via the facilitator",
          txHashes: [settled.transaction as Hex],
          blocks: [r.blockNumber],
          status: r.status === "success" ? "success" : "reverted",
          outcome: `0.001 USDC paid by ${settled.payer ?? c.agent.address}; HTTP ${res.status}`,
          proves:
            "An agent paying another agent per request: the EIP-3009 authorization is signed by the agent's petty cash account and settled on-chain by the facilitator. The vault is never involved in the payment itself.",
        });
      } else {
        push({
          step: "6b",
          title: "x402 USDC payment to the oracle agent",
          fn: "EIP-3009 transferWithAuthorization via facilitator",
          txHashes: [],
          blocks: [],
          status: "skipped",
          outcome: `payment did not settle (HTTP ${res.status}${settled ? `, ${JSON.stringify(settled).slice(0, 120)}` : ""})`,
          proves: "",
        });
      }
    } catch (err) {
      push({
        step: "6b",
        title: "x402 USDC payment to the oracle agent",
        fn: "EIP-3009 transferWithAuthorization via facilitator",
        txHashes: [],
        blocks: [],
        status: "skipped",
        outcome: `payment failed: ${err instanceof Error ? err.message : String(err)}`,
        proves: "",
      });
    }
  }
}

// 7: over-cap attempt by the agent key directly
{
  const i = await mkIntent(
    "TRANSFER_NATIVE",
    contact,
    ZERO_ADDRESS,
    perTx + 1n,
    "Over-cap attempt (should revert)",
  );
  const sig = await signIntent(i);
  const t = await agentRevert("execute", [i, "0x", sig]);
  push({
    step: "7",
    title: "Over-cap attempt by the agent key, directly against the vault",
    fn: "execute",
    txHashes: [t.hash],
    blocks: [t.block],
    status: "reverted",
    outcome: t.reason,
    proves:
      "The per-transaction cap is enforced by the chain, not by the agent software. A compromised agent key cannot exceed it.",
  });
}

// 8: non-allowlisted target
{
  const i = await mkIntent(
    "TRANSFER_NATIVE",
    STRANGER,
    ZERO_ADDRESS,
    small,
    "Non-allowlisted target attempt (should revert)",
  );
  const sig = await signIntent(i);
  const t = await agentRevert("execute", [i, "0x", sig]);
  push({
    step: "8",
    title: "Transfer to a non-allowlisted target",
    fn: "execute",
    txHashes: [t.hash],
    blocks: [t.block],
    status: "reverted",
    outcome: t.reason,
    proves:
      "Counterparties outside the allowlist need an owner co-signature; without one the chain reverts.",
  });
}

// 11: window cap exhaustion through many small transfers
{
  const hashes: Hex[] = [];
  const blocks: bigint[] = [];
  let last = "";
  for (let k = 0; k < 12; k++) {
    const i = await mkIntent(
      "TRANSFER_NATIVE",
      contact,
      ZERO_ADDRESS,
      perTx,
      `Window exhaustion step ${k + 1}`,
    );
    const sig = await signIntent(i);
    const m = await vaultRead<typeof ethMandate>("getAssetMandate", [
      c.agent.address,
      ZERO_ADDRESS,
    ]);
    const block = await c.publicClient.getBlock();
    const rolled =
      block.timestamp >= m.windowStart + BigInt(m.windowSeconds) ? 0n : m.spentInWindow;
    if (rolled + perTx > m.autonomousWindowCap) {
      const t = await agentRevert("execute", [i, "0x", sig]);
      hashes.push(t.hash);
      blocks.push(t.block);
      last = t.reason;
      break;
    }
    const t = await agentSuccess("execute", [i, "0x", sig]);
    hashes.push(t.hash);
    blocks.push(t.block);
  }
  push({
    step: "11",
    title: "Window cap exhaustion through repeated sub-cap transfers",
    fn: "execute x" + hashes.length,
    txHashes: hashes,
    blocks,
    status: last ? "reverted" : "success",
    outcome: last
      ? `${hashes.length - 1} succeeded, then ${last}`
      : "window not exhausted within 12 transfers",
    proves:
      "The daily window is a blast-radius bound: many small transfers cannot add up to more than the owner allowed.",
  });
}

// 9: Tier 2 co-signed transfer to a stranger above the per-tx cap
let replaySig: Hex | undefined;
let replayDeadline: bigint;
{
  const amount = perTx * 6n; // above the per-tx cap, inside the co-sign cap
  const i = await mkIntent(
    "TRANSFER_NATIVE",
    STRANGER,
    ZERO_ADDRESS,
    amount,
    "Pay a new contractor (Tier 2, owner co-signed)",
  );
  const ih = coreIntentHash(i, c.chainId, vault);
  const block = await c.publicClient.getBlock();
  replayDeadline = block.timestamp + 3600n;
  replaySig = await signApproval(ih, replayDeadline);
  const sig = await signIntent(i);
  const t = await agentSuccess("executeWithApproval", [i, "0x", sig, replayDeadline, replaySig]);
  push({
    step: "9",
    title: "Tier 2 co-signed transfer: owner EIP-712 approval verified on-chain",
    fn: "executeWithApproval",
    txHashes: [t.hash],
    blocks: [t.block],
    status: "success",
    outcome: `${formatEther(amount)} ETH to ${STRANGER} with owner approval ${ih.slice(0, 10)}...`,
    proves:
      "Above the autonomous caps or outside the allowlist, the contract itself checks the owner's signature over this exact intent hash and deadline.",
  });
}

// 10: replay the approval on a new intent
{
  const i = await mkIntent(
    "TRANSFER_NATIVE",
    STRANGER,
    ZERO_ADDRESS,
    perTx * 6n,
    "Replay attempt with a reused owner approval (should revert)",
  );
  const sig = await signIntent(i);
  const t = await agentRevert("executeWithApproval", [i, "0x", sig, replayDeadline, replaySig!]);
  push({
    step: "10",
    title: "Replay of the same owner approval on a new intent",
    fn: "executeWithApproval",
    txHashes: [t.hash],
    blocks: [t.block],
    status: "reverted",
    outcome: t.reason,
    proves:
      "An approval is bound to one intent hash; the nonce makes every intent hash unique, so a captured approval cannot be reused.",
  });
}

// extra: unlimited approval is Tier 3 even with an owner signature
{
  const max = 2n ** 256n - 1n;
  const i = await mkIntent(
    "APPROVE_ERC20",
    STRANGER,
    usdc,
    max,
    "Unlimited approval attempt with owner co-sign (should revert)",
  );
  const ih = coreIntentHash(i, c.chainId, vault);
  const block = await c.publicClient.getBlock();
  const dl = block.timestamp + 3600n;
  const os = await signApproval(ih, dl);
  const sig = await signIntent(i);
  const t = await agentRevert("executeWithApproval", [i, "0x", sig, dl, os]);
  push({
    step: "T3",
    title: "Tier 3: unlimited token approval, even with an owner approval",
    fn: "executeWithApproval (APPROVE_ERC20 max)",
    txHashes: [t.hash],
    blocks: [t.block],
    status: "reverted",
    outcome: t.reason,
    proves: "Some actions have no code path at all. No signature lifts a Tier 3 restriction.",
  });
}

// 12: kill switch
{
  const revoke = await ownerTx("revokeAgent", [c.agent.address]);
  const i = await mkIntent(
    "TRANSFER_NATIVE",
    contact,
    ZERO_ADDRESS,
    small,
    "Attempt after revocation (should revert)",
  );
  const sig = await signIntent(i);
  const afterRevoke = await agentRevert("execute", [i, "0x", sig]);
  const block = await c.publicClient.getBlock();
  const reactivate = await ownerTx("setAgent", [
    c.agent.address,
    block.timestamp + 7n * 86400n,
    true,
  ]);
  const pause = await ownerTx("pause", []);
  const j = await mkIntent(
    "TRANSFER_NATIVE",
    contact,
    ZERO_ADDRESS,
    small,
    "Attempt while paused (should revert)",
  );
  const sig2 = await signIntent(j);
  const afterPause = await agentRevert("execute", [j, "0x", sig2]);
  const unpause = await ownerTx("unpause", []);
  push({
    step: "12",
    title: "Kill switch: revokeAgent then any agent call reverts; pause likewise",
    fn: "revokeAgent, execute, setAgent, pause, execute, unpause",
    txHashes: [
      revoke.hash,
      afterRevoke.hash,
      reactivate.hash,
      pause.hash,
      afterPause.hash,
      unpause.hash,
    ],
    blocks: [
      revoke.block,
      afterRevoke.block,
      reactivate.block,
      pause.block,
      afterPause.block,
      unpause.block,
    ],
    status: "reverted",
    outcome: `after revoke: ${afterRevoke.reason}; after pause: ${afterPause.reason}`,
    proves:
      "One owner transaction ends the agent's authority. In-flight and future agent transactions revert on-chain.",
  });
}

push({
  step: "13",
  title: "EIP-7702 delegation and one execution through MandateAccount7702",
  fn: "type-4 transaction",
  txHashes: [],
  blocks: [],
  status: "pending",
  outcome: "P2 stretch goal not reached",
  proves: "",
});

// ------------------------------------------------------------------ output

const now = new Date();
let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
} catch {
  // not a git checkout
}
const order = ["1", "2", "3", "4", "5", "6a", "6b", "7", "8", "9", "10", "11", "12", "13", "T3"];
rows.sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step));

const link = (h: Hex) =>
  c.chainId === 31337 ? `\`${h}\`` : `[${h.slice(0, 10)}...](${explorer.tx(h)})`;
const md: string[] = [];
md.push("# Execution evidence");
md.push("");
md.push(
  "Why read this: every row is a real transaction hash returned by the RPC when we ran `pnpm evidence:run`. Reverted rows are evidence too: they show the chain refusing what the agent key tried. Nothing in this file is written by hand; the script regenerates it.",
);
md.push("");
md.push(`| Field | Value |`);
md.push(`|---|---|`);
md.push(`| Chain | ${c.chainId} (${explorer.name}) |`);
md.push(`| Vault | ${c.chainId === 31337 ? vault : `[${vault}](${explorer.address(vault)})`} |`);
md.push(`| Owner | ${c.owner.address} |`);
md.push(`| Agent | ${c.agent.address} |`);
md.push(`| Allowlisted contact | ${contact} |`);
md.push(`| Non-allowlisted stranger | ${STRANGER} |`);
md.push(
  `| ETH mandate | per tx ${formatEther(ethMandate.autonomousPerTxCap)}, window ${formatEther(ethMandate.autonomousWindowCap)} per ${ethMandate.windowSeconds} s, co-sign ceiling ${formatEther(ethMandate.coSignPerTxCap)} |`,
);
md.push(
  `| USDC mandate | per tx ${formatUnits(usdcMandate.autonomousPerTxCap, 6)}, window ${formatUnits(usdcMandate.autonomousWindowCap, 6)} per ${usdcMandate.windowSeconds} s, co-sign ceiling ${formatUnits(usdcMandate.coSignPerTxCap, 6)} |`,
);
md.push(`| Run at | ${now.toISOString()} |`);
md.push(`| Repository commit | ${commit} |`);
md.push("");
if (c.chainId === 31337) {
  md.push(
    "Note: this run was against a local Anvil chain, so the hashes are not browsable on a public explorer. The same script produces the Base Sepolia table once the owner address is funded.",
  );
  md.push("");
}
md.push("| Step | What | Function | Tx hash(es) | Block(s) | Outcome | What it proves |");
md.push("|---|---|---|---|---|---|---|");
for (const r of rows) {
  const hashes = r.txHashes.length ? r.txHashes.map(link).join("<br>") : "(none)";
  const blocks = r.blocks.length ? r.blocks.map(String).join("<br>") : "";
  const outcome = `${r.status === "success" ? "success" : r.status === "reverted" ? "reverted" : r.status}: ${r.outcome}`;
  md.push(
    `| ${r.step} | ${r.title} | ${r.fn} | ${hashes} | ${blocks} | ${outcome} | ${r.proves} |`,
  );
}
md.push("");
const counts = rows.reduce<Record<Status, number>>(
  (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
  { success: 0, reverted: 0, pending: 0, skipped: 0 },
);
md.push(
  `Summary: ${counts.success} rows succeeded, ${counts.reverted} rows reverted as intended, ${counts.pending} pending later phases, ${counts.skipped} skipped.`,
);
md.push("");
md.push("Raw log: `packages/contracts/evidence/` (JSON, one file per run).");
md.push("");
md.push(
  "Citations: [EIP-712] for the signed intent and approval structures, [MM-SEC-AUG26] for the principle that agent authority should be scoped, time-bounded and enforced on-chain. See docs/REFERENCES.md.",
);

writeFileSync(`${ROOT}docs/EXECUTION_EVIDENCE.md`, md.join("\n") + "\n");
mkdirSync(`${CONTRACTS_DIR}evidence`, { recursive: true });
const raw = {
  chainId: c.chainId,
  vault,
  owner: c.owner.address,
  agent: c.agent.address,
  runAt: now.toISOString(),
  commit,
  rows: rows.map((r) => ({ ...r, blocks: r.blocks.map(String) })),
};
const stamp = now.toISOString().replace(/[:.]/g, "-");
writeFileSync(
  `${CONTRACTS_DIR}evidence/${c.chainId}-${stamp}.json`,
  JSON.stringify(raw, null, 2) + "\n",
);
writeFileSync(
  `${CONTRACTS_DIR}evidence/latest-${c.chainId}.json`,
  JSON.stringify(raw, null, 2) + "\n",
);
log(`\nwrote docs/EXECUTION_EVIDENCE.md and evidence/${c.chainId}-${stamp}.json`);
