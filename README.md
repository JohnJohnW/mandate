# Mandate

A policy-bound autonomous on-chain wallet agent. An AI agent should hold a mandate, not a key.

The owner grants a scoped, time-bound mandate that a smart contract enforces. The agent acts alone inside it, needs the owner's co-signature above it, and is reverted by the chain outside it. Even a fully compromised agent process cannot move value beyond the mandate.

Status: work in progress for the 2026 Shenzhen International FinTech Competition. Testnet only (Base Sepolia). The vault contract is unaudited. Full documentation lands under docs/ as the build progresses; docs/ASSUMPTIONS.md lists every default we took.

## What is here

| Path | What it is |
|---|---|
| packages/core | Typed intent schema and EIP-712 types, the policy engine (mandate bounds, sanctions screening, address poisoning, contract risk, provenance, velocity, simulation rules), the injection scanner, the hash-chained audit log and trace types |
| packages/contracts | MandateVault.sol (per-asset caps, fixed spending window, allowlists, owner co-signature verified on-chain, kill switch), mocks, Foundry tests, deploy and evidence scripts |
| apps/api | The agent runtime: plan-then-execute planner (mock or any OpenAI-compatible model), quarantine reader, tool catalogue, intent pipeline, passkey owner auth, REST and SSE |
| apps/web | The owner's control tower: Overview, Agent with live decision trace, Approvals, Mandate editor and kill switch, Audit log with verify and tamper demo |
| docs | Architecture, permission tiers, threat model, evaluation, compliance, runbook, references |

## Quickstart on a local chain

Prerequisites: Node 22, pnpm 10, Foundry.

```bash
pnpm install
pnpm --filter @mandate/contracts setup   # installs forge-std and OpenZeppelin into lib/
pnpm keys:generate                        # writes testnet keys to .env, prints addresses only
anvil --block-time 1                      # in a second terminal
pnpm contracts:deploy:anvil               # fund the owner from an Anvil account first (see docs/RUNBOOK.md)
pnpm evidence:anvil                       # runs the canonical evidence set, writes docs/EXECUTION_EVIDENCE.md
OWNER_APPROVAL_AUTH=dev pnpm dev:api:anvil
pnpm dev:web                              # http://localhost:3000
```

For Base Sepolia, fund the printed owner and agent addresses, then use `pnpm contracts:deploy`, `pnpm evidence:run` and `pnpm --filter @mandate/api dev`.

## Tests

```bash
pnpm test              # core and api (api tests need a running Anvil)
pnpm contracts:test    # Foundry unit, fuzz, invariant and fixture suites
```

## Licence

MIT. See LICENSE.
