/**
 * Deploys the vault with Foundry using the keys in the repo .env, then records
 * VAULT_ADDRESS (and on Anvil the mock token addresses) back into .env.
 *
 * Usage: pnpm contracts:deploy                 (RPC_URL and CHAIN_ID from .env)
 *        pnpm --filter @mandate/contracts deploy:anvil   (http://127.0.0.1:8545)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CONTRACTS_DIR, connect } from "./env.js";

const anvil = process.argv.includes("--anvil");
const c = await connect({ anvil });
const balance = await c.publicClient.getBalance({ address: c.owner.address });
console.log(`chain ${c.chainId}, owner ${c.owner.address}, balance ${Number(balance) / 1e18} ETH`);
if (balance === 0n)
  throw new Error("owner has no ETH on this chain; fund it first (see docs/RUNBOOK.md)");

const scriptEnv: NodeJS.ProcessEnv = {
  ...process.env,
  OWNER_PRIVATE_KEY: c.env.get("OWNER_PRIVATE_KEY"),
  AGENT_ADDRESS: c.agent.address,
};
if (!anvil) {
  scriptEnv.USDC_ADDRESS = c.env.get("USDC_ADDRESS");
  scriptEnv.WETH_ADDRESS = c.env.get("WETH_ADDRESS");
} else {
  scriptEnv.VAULT_FUNDING_WEI = String(10n ** 18n);
}
for (const k of ["DEMO_CONTACT", "VAULT_FUNDING_WEI", "VAULT_USDC_FUNDING"]) {
  if (c.env.get(k)) scriptEnv[k] = c.env.get(k);
}

execFileSync(
  "forge",
  ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", c.rpcUrl, "--broadcast", "--slow", "-vv"],
  { cwd: CONTRACTS_DIR, env: scriptEnv, stdio: "inherit" },
);

const dep = JSON.parse(
  readFileSync(`${CONTRACTS_DIR}deployments/${c.chainId}.json`, "utf8"),
) as Record<string, string>;
if (anvil) {
  c.env.set("ANVIL_VAULT_ADDRESS", dep.vault!);
  c.env.set("ANVIL_USDC_ADDRESS", dep.usdc!);
  c.env.set("ANVIL_WETH_ADDRESS", dep.weth!);
} else {
  c.env.set("VAULT_ADDRESS", dep.vault!);
}
c.env.save();
console.log(
  `\nvault ${dep.vault} recorded in .env as ${anvil ? "ANVIL_VAULT_ADDRESS" : "VAULT_ADDRESS"}`,
);
