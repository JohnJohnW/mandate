/**
 * Registers our wallet agent and the oracle agent in the ERC-8004 Identity
 * Registry (the live registry on Base Sepolia, the mock on Anvil), then binds
 * the vault as our agent's wallet with the owner's ERC-1271 signature.
 * Writes deployments/identity-<chainId>.json, which the API and the evidence
 * script read. Re-runnable: existing ids are reused.
 *
 * Usage: pnpm --filter @mandate/contracts identity           (chain from .env)
 *        pnpm --filter @mandate/contracts identity:anvil
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { IDENTITY_REGISTRY_ABI } from "../ts/index.js";
import { CONTRACTS_DIR, connect } from "./env.js";

const anvil = process.argv.includes("--anvil");
const c = await connect({ anvil });
const dep = JSON.parse(
  readFileSync(`${CONTRACTS_DIR}deployments/${c.chainId}.json`, "utf8"),
) as Record<string, string>;
const registry = getAddress(
  anvil ? dep.identityRegistry! : c.env.get("ERC8004_IDENTITY_REGISTRY") || dep.identityRegistry!,
);
const vault = getAddress(anvil ? c.env.get("ANVIL_VAULT_ADDRESS") : c.env.get("VAULT_ADDRESS"));
const oraclePk = c.env.get("ORACLE_PRIVATE_KEY") as Hex;
if (!oraclePk) throw new Error("ORACLE_PRIVATE_KEY missing; run pnpm keys:generate");
const oracle = privateKeyToAccount(oraclePk);
const oracleClient = createWalletClient({
  chain: c.chain,
  transport: http(c.rpcUrl),
  account: oracle,
});
const apiUrl = c.env.get("API_PUBLIC_URL") || "http://localhost:4010";
const oracleUrl = c.env.get("ORACLE_URL") || "http://localhost:4020";
const out = `${CONTRACTS_DIR}deployments/identity-${c.chainId}.json`;
const existing = existsSync(out)
  ? (JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>)
  : undefined;
if (existing && existing.registry === registry) {
  // The agents are already registered. If the vault was redeployed, the on-chain binding no longer
  // points at the current vault, so re-bind the existing agent id (one owner-signed setAgentWallet)
  // without re-registering or re-funding the oracle. Otherwise there is nothing to do.
  const agent0 = existing.agent as { agentId: string; setWalletTx?: Hex };
  const bound = (await c.publicClient.readContract({
    address: registry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "getAgentWallet",
    args: [BigInt(agent0.agentId)],
  })) as Address;
  if (getAddress(bound) === getAddress(vault)) {
    console.log(
      `identity already registered and bound on chain ${c.chainId}: agent #${agent0.agentId} -> ${vault}`,
    );
    process.exit(0);
  }
  console.log(
    `re-binding existing agent #${agent0.agentId} from ${bound} to the new vault ${vault}`,
  );
  const rebind = await bindVault(agent0.agentId);
  agent0.setWalletTx = rebind.tx;
  (existing.agent as Record<string, unknown>).setWalletBlock = rebind.block;
  existing.registeredAt = new Date().toISOString();
  writeFileSync(out, JSON.stringify(existing, null, 2) + "\n");
  console.log(`vault re-bound as agent wallet (tx ${rebind.tx}); updated ${out}`);
  process.exit(0);
}

console.log(`chain ${c.chainId}, registry ${registry}, vault ${vault}`);

// The oracle needs gas for its own registration; the owner funds it when it is empty. On a public
// testnet the facilitator settles x402 payments and pays that gas, so the oracle only needs enough
// for its one register() call. The amount is overridable by env for a thin faucet balance.
const oracleGasFloor = parseEther(anvil ? "0.1" : process.env.ORACLE_GAS_ETH || "0.00005");
const oracleBal = await c.publicClient.getBalance({ address: oracle.address });
if (oracleBal < oracleGasFloor) {
  const h = await c.ownerClient.sendTransaction({
    to: oracle.address,
    value: oracleGasFloor,
  });
  await c.publicClient.waitForTransactionReceipt({ hash: h });
  console.log(`funded oracle ${oracle.address} from the owner (${h})`);
}

async function register(
  client: typeof oracleClient,
  uri: string,
): Promise<{ agentId: string; tx: Hex; owner: Address }> {
  const hash = await client.writeContract({
    address: registry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [uri],
  });
  const r = await c.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`register reverted: ${hash}`);
  for (const log of r.logs) {
    try {
      const ev = decodeEventLog({ abi: IDENTITY_REGISTRY_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === "Registered") {
        const args = ev.args as unknown as { agentId: bigint; owner: Address };
        return { agentId: args.agentId.toString(), tx: hash, owner: args.owner };
      }
    } catch {
      // not a registry event
    }
  }
  throw new Error("Registered event not found");
}

/**
 * Binds `vault` as the wallet of `agentId` with the owner's EIP-712 signature. The registry checks
 * the signature against the vault via ERC-1271 and the vault accepts only the owner's key. Used by
 * both the fresh registration and the redeploy re-bind path. Deadline is within 5 minutes of chain
 * time. Declared here (hoisted) so the early re-bind branch above can call it.
 */
async function bindVault(agentId: string): Promise<{ tx: Hex; block: number }> {
  const blk = await c.publicClient.getBlock();
  const deadline = blk.timestamp + 240n;
  const ownerSig = await c.ownerClient.signTypedData({
    domain: {
      name: "ERC8004IdentityRegistry",
      version: "1",
      chainId: c.chainId,
      verifyingContract: registry,
    },
    types: {
      AgentWalletSet: [
        { name: "agentId", type: "uint256" },
        { name: "newWallet", type: "address" },
        { name: "owner", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "AgentWalletSet",
    message: { agentId: BigInt(agentId), newWallet: vault, owner: c.agent.address, deadline },
  });
  const tx = await c.agentClient.writeContract({
    address: registry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "setAgentWallet",
    args: [BigInt(agentId), vault, deadline, ownerSig],
  });
  const r = await c.publicClient.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`setAgentWallet reverted: ${tx}`);
  return { tx, block: Number(r.blockNumber) };
}

const agentReg = await register(
  c.agentClient as typeof oracleClient,
  `${apiUrl}/.well-known/agent.json`,
);
console.log(`our agent registered: id ${agentReg.agentId}, tx ${agentReg.tx}`);
const oracleReg = await register(oracleClient, `${oracleUrl}/.well-known/agent.json`);
console.log(`oracle agent registered: id ${oracleReg.agentId}, tx ${oracleReg.tx}`);

// Bind the vault as our agent's wallet.
const { tx: setWalletTx, block: setWalletBlock } = await bindVault(agentReg.agentId);
const wallet = (await c.publicClient.readContract({
  address: registry,
  abi: IDENTITY_REGISTRY_ABI,
  functionName: "getAgentWallet",
  args: [BigInt(agentReg.agentId)],
})) as Address;
console.log(`vault bound as agent wallet: ${wallet} (tx ${setWalletTx})`);

const record = {
  chainId: c.chainId,
  registry,
  agent: {
    agentId: agentReg.agentId,
    owner: agentReg.owner,
    agentURI: `${apiUrl}/.well-known/agent.json`,
    registerTx: agentReg.tx,
    setWalletTx,
    registerBlock: Number(
      (await c.publicClient.getTransactionReceipt({ hash: agentReg.tx })).blockNumber,
    ),
    setWalletBlock,
  },
  oracle: {
    agentId: oracleReg.agentId,
    owner: oracleReg.owner,
    agentURI: `${oracleUrl}/.well-known/agent.json`,
    registerTx: oracleReg.tx,
    registerBlock: Number(
      (await c.publicClient.getTransactionReceipt({ hash: oracleReg.tx })).blockNumber,
    ),
  },
  registeredAt: new Date().toISOString(),
};
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
c.env.set(anvil ? "ANVIL_ORACLE_AGENT_ID" : "ORACLE_AGENT_ID", oracleReg.agentId);
c.env.save();
console.log(`wrote ${out}`);
