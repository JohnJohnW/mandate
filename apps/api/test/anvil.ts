/**
 * Test harness: deploys a fresh vault and mock tokens to a running Anvil
 * (http://127.0.0.1:8545) from the Foundry artifacts and returns a Config that
 * points at them. Tests are skipped when Anvil is not reachable.
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { MANDATE_VAULT_ABI } from "@mandate/contracts";
import type { Config } from "../src/config.js";

const RPC = "http://127.0.0.1:8545";
const ROOT = new URL("../../../", import.meta.url).pathname;
const FUNDER_PK: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Anvil account 0, public dev key

function artifact(name: string): { abi: unknown[]; bytecode: Hex } {
  const j = JSON.parse(
    readFileSync(`${ROOT}packages/contracts/out/${name}.sol/${name}.json`, "utf8"),
  ) as { abi: unknown[]; bytecode: { object: Hex } };
  return { abi: j.abi, bytecode: j.bytecode.object };
}

export async function anvilUp(): Promise<boolean> {
  try {
    const id = await createPublicClient({ transport: http(RPC) }).getChainId();
    return id === 31337;
  } catch {
    return false;
  }
}

export interface Fixture {
  cfg: Config;
  vault: Address;
  usdc: Address;
  weth: Address;
  owner: ReturnType<typeof privateKeyToAccount>;
  agent: ReturnType<typeof privateKeyToAccount>;
  alice: Address;
}

export const ETH_PER_TX = parseEther("0.0002");
export const ETH_WINDOW = parseEther("0.001");
export const ETH_COSIGN = parseEther("0.005");

export async function deployFixture(): Promise<Fixture> {
  const publicClient = createPublicClient({ chain: anvil, transport: http(RPC) });
  const funder = createWalletClient({
    chain: anvil,
    transport: http(RPC),
    account: privateKeyToAccount(FUNDER_PK),
  });
  const ownerPk = generatePrivateKey();
  const agentPk = generatePrivateKey();
  const owner = privateKeyToAccount(ownerPk);
  const agent = privateKeyToAccount(agentPk);
  const alice = "0x1234567890AbcdEF1234567890aBcdef12345678" as Address;
  for (const to of [owner.address, agent.address]) {
    const h = await funder.sendTransaction({ to, value: parseEther("2") });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }
  const ownerClient = createWalletClient({ chain: anvil, transport: http(RPC), account: owner });
  const deploy = async (name: string, args: unknown[]): Promise<Address> => {
    const a = artifact(name);
    const hash = await ownerClient.deployContract({
      abi: a.abi as never,
      bytecode: a.bytecode,
      args: args as never,
    });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    return r.contractAddress!;
  };
  const usdc = await deploy("MockERC20", ["Mock USD Coin", "USDC", 6]);
  const weth = await deploy("MockWETH", []);
  const vault = await deploy("MandateVault", [owner.address]);
  const write = async (functionName: string, args: unknown[]) => {
    const h = await ownerClient.writeContract({
      address: vault,
      abi: MANDATE_VAULT_ABI,
      functionName,
      args,
    });
    await publicClient.waitForTransactionReceipt({ hash: h });
  };
  const block = await publicClient.getBlock();
  await write("setAgent", [agent.address, block.timestamp + 7n * 86400n, true]);
  await write("setAssetMandate", [
    agent.address,
    "0x0000000000000000000000000000000000000000",
    ETH_PER_TX,
    ETH_WINDOW,
    ETH_COSIGN,
    86400,
    true,
  ]);
  await write("setAssetMandate", [
    agent.address,
    usdc,
    1_000_000n,
    5_000_000n,
    50_000_000n,
    86400,
    true,
  ]);
  await write("setAllowedTarget", [agent.address, alice, true]);
  await write("setAllowedTarget", [agent.address, agent.address, true]);
  await write("setAllowedSelector", [agent.address, weth, "0xd0e30db0", true]);
  const fund = await ownerClient.sendTransaction({ to: vault, value: parseEther("1") });
  await publicClient.waitForTransactionReceipt({ hash: fund });
  const mint = await ownerClient.writeContract({
    address: usdc,
    abi: artifact("MockERC20").abi as never,
    functionName: "mint",
    args: [vault, 100_000_000n],
  });
  await publicClient.waitForTransactionReceipt({ hash: mint });

  const cfg: Config = {
    chainId: 31337,
    chainName: "Anvil (local)",
    rpcUrl: RPC,
    explorerUrl: "",
    vaultAddress: vault,
    usdcAddress: usdc,
    wethAddress: weth,
    agentPrivateKey: agentPk,
    ownerPrivateKey: ownerPk,
    ownerMode: "local",
    ownerApprovalAuth: "dev",
    planner: "mock",
    llm: { baseUrl: "", apiKey: "", model: "" },
    sanctionsMaxAgeDays: 3650, // the committed snapshot is fine for tests
    databasePath: ":memory:",
    auditPath: ":memory:",
    apiPort: 0,
    webOrigin: "http://localhost:3000",
    oracleUrl: "http://localhost:4020",
    erc8004: {
      identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    },
    x402: { facilitatorUrl: "https://x402.org/facilitator", network: "eip155:31337" },
    rpId: "localhost",
    rpOrigin: "http://localhost:3000",
  };
  return { cfg, vault, usdc, weth, owner, agent, alice };
}
