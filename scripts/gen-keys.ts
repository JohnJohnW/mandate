/**
 * Generates the agent and owner keys for testnet use and writes them to .env.
 * Prints addresses only. Never prints a private key.
 * Refuses to overwrite a key that is already set.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = new URL("../.env", import.meta.url).pathname;
const examplePath = new URL("../.env.example", import.meta.url).pathname;

if (!existsSync(envPath)) copyFileSync(examplePath, envPath);
let env = readFileSync(envPath, "utf8");

function setKey(name: string): string {
  const re = new RegExp(`^${name}=(.*)$`, "m");
  const m = env.match(re);
  if (m && m[1] && m[1].trim().length > 0) {
    const addr = privateKeyToAccount(m[1].trim() as `0x${string}`).address;
    console.log(`${name} already set, address ${addr}`);
    return addr;
  }
  const pk = generatePrivateKey();
  const addr = privateKeyToAccount(pk).address;
  env = m ? env.replace(re, `${name}=${pk}`) : env + `\n${name}=${pk}\n`;
  console.log(`${name} generated, address ${addr}`);
  return addr;
}

const owner = setKey("OWNER_PRIVATE_KEY");
const agent = setKey("AGENT_PRIVATE_KEY");
writeFileSync(envPath, env, { mode: 0o600 });

console.log("");
console.log("Fund these on Base Sepolia (testnet only):");
console.log(`  owner  ${owner}   needs ETH (deploys the vault, sets the mandate, funds the vault)`);
console.log(`  agent  ${agent}   needs a little ETH for gas and some USDC for x402 petty cash`);
console.log("Faucets: Coinbase Developer Platform (ETH and USDC), Alchemy, QuickNode, thirdweb.");
