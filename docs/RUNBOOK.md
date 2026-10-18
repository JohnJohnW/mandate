# Runbook

Why read this: it is the required deployment-instructions deliverable. It takes you from a clean clone to a running system, on a local chain for development and on Base Sepolia for the real evidence. Every command is copy-pasteable.

## Prerequisites

- Node 22 and pnpm 10. Check with `node --version` and `pnpm --version`.
- Foundry (`forge`, `cast`, `anvil`). Install with `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
- git, and a GitHub account for the repository.
- For Base Sepolia: a funded owner address and a funded agent address (faucets below), and optionally an Alchemy or QuickNode RPC URL if the public RPC rate-limits.
- Optional: an OpenAI-compatible LLM endpoint for the live planner. Without one the deterministic MockPlanner runs everything.
- Optional, for MetaMask owner mode: MetaMask with Base Sepolia.

## Install

```bash
pnpm install
pnpm contracts:setup   # installs forge-std and OpenZeppelin into lib/ (not committed)
pnpm keys:generate                        # writes testnet keys to .env, prints the owner, agent and oracle addresses
```

`pnpm keys:generate` prints addresses only, never a private key, and refuses to overwrite a key that is already set. It writes `.env` with mode 600. `.env` is excluded from git.

## Run on a local chain (development and the demo)

This needs no funding and no public network.

```bash
# terminal 1: a local chain with a one-second block time
anvil --chain-id 31337 --block-time 1

# terminal 2: fund the owner and agent from an Anvil dev account, then deploy and register identity
cast send --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 <OWNER_ADDRESS> --value 5ether
cast send --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 <AGENT_ADDRESS> --value 1ether
pnpm contracts:deploy:anvil     # deploys the vault, mock USDC (EIP-3009), mock WETH and a mock ERC-8004 registry
pnpm identity:anvil             # registers both agents and binds the vault as the agent wallet

# terminal 3: the oracle, the api and the dashboard
pnpm dev:oracle:anvil
OWNER_APPROVAL_AUTH=dev pnpm dev:api:anvil
pnpm dev:web                    # http://localhost:3000
```

`<OWNER_ADDRESS>` and `<AGENT_ADDRESS>` are the addresses `pnpm keys:generate` printed. The Anvil private key above is the public, well-known Anvil account 0; it is safe to use on a local chain only.

Open http://localhost:3000. On the first visit, authenticate as the owner (in `dev` auth mode the sidebar offers a dev owner session; otherwise register a passkey). Add a contact named `alice`, then try:

- `what is our portfolio?`
- `pay alice 0.0001 ETH` (Tier 1, executes)
- `what are the prices?` (pays the oracle over x402 from petty cash, topping up the float first)
- `send 0.0012 ETH to 0xC0FFeE00000000000000000000000000000000Cc` (Tier 2, goes to the Approvals page)
- On the Mandate page, press Revoke agent, then `pay alice 0.0001 ETH` again and watch it blocked.
- On the Security Lab page, press Run all against all configurations.

## Run the evidence and the attack suite locally

```bash
pnpm evidence:anvil   # writes docs/EXECUTION_EVIDENCE.md with real local transaction hashes
pnpm attacks:anvil    # writes docs/EVALUATION.md with the measured matrix
```

## Deploy on Base Sepolia

First fund the addresses. From `pnpm keys:generate`:

| Address | Needs |
|---|---|
| owner | about 0.01 Base Sepolia ETH, plus 10 to 20 Base Sepolia USDC (moved into the vault at deploy) |
| agent | about 0.01 Base Sepolia ETH for gas and its identity registration |
| oracle | funded automatically from the owner during identity registration |

Faucets: the Coinbase Developer Platform faucet gives both ETH and USDC on Base Sepolia; Alchemy, QuickNode and thirdweb give ETH. Then:

```bash
# .env already has CHAIN_ID=84532 and the Base Sepolia addresses
pnpm contracts:deploy       # deploys the vault using the canonical USDC, WETH and ERC-8004 registry
pnpm identity:register      # registers both agents in the real registry and binds the vault
pnpm --filter @mandate/oracle start   # the oracle on the public x402 facilitator
pnpm --filter @mandate/api start
pnpm --filter @mandate/web build && pnpm --filter @mandate/web start
pnpm evidence:run           # writes docs/EXECUTION_EVIDENCE.md with Base Sepolia hashes and explorer links
pnpm attacks:run            # writes docs/EVALUATION.md measured on Base Sepolia
```

## Verify the contract source

```bash
# Blockscout needs no API key
forge verify-contract --verifier blockscout --verifier-url https://base-sepolia.blockscout.com/api/ <VAULT_ADDRESS> src/MandateVault.sol:MandateVault
# Basescan if a key is provided
BASESCAN_API_KEY=<key> forge verify-contract --chain base-sepolia <VAULT_ADDRESS> src/MandateVault.sol:MandateVault
```

## Use a live LLM

Set in `.env`:

```
LLM_BASE_URL=<your OpenAI-compatible endpoint>
LLM_API_KEY=<your key>
LLM_MODEL=<model name>
PLANNER=live
```

Any OpenAI-compatible endpoint works. The demo still runs offline from the LLM via the MockPlanner if `PLANNER=mock` or if the LLM settings are blank.

## Tests

```bash
pnpm test              # core and attacks always; the api pipeline tests run when an Anvil is up
pnpm contracts:test    # the full Foundry suite (unit, fuzz, invariant, fixture)
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Startup check fails on chain id | Wrong `CHAIN_ID` or a non-testnet RPC | The apps refuse anything but 84532, 11155111 or 31337. Fix `CHAIN_ID` and `RPC_URL`. |
| Startup check fails on vault code | No deployment on this chain | Run `pnpm contracts:deploy` (or `:deploy:anvil`). |
| The public RPC rate-limits | sepolia.base.org under load | Set `RPC_URL` to an Alchemy or QuickNode Base Sepolia URL. |
| x402 payment does not settle on Anvil | The local facilitator needs the mock USDC and a synced clock | Restart Anvil without a shifted clock; redeploy; re-register identity. |
| The dashboard shows "connecting" | The API is not reachable or `NEXT_PUBLIC_API_URL` is wrong | Confirm the API is on :4010; set `NEXT_PUBLIC_API_URL` if it is elsewhere. |
| An owner action returns 401 | No owner session | Authenticate as the owner first (passkey, or the dev session in `dev` auth mode). |

## Reset

```bash
rm -f apps/api/data/*.db apps/api/data/*.jsonl   # clears operational state and the audit log
# on Anvil, restart the chain and redeploy; on Base Sepolia the deployment persists
```
