# API

Why read this: it is the interface reference for the agent runtime. The server is Hono on Node (`apps/api`). A machine-readable OpenAPI document is served at `/openapi.json` and generated from the same zod schemas that validate the requests.

Base URL in development: `http://localhost:4010`. Owner actions require an owner session header, `x-owner-session`, obtained from the passkey flow (or the literal `dev` when `OWNER_APPROVAL_AUTH=dev`, tests only).

## REST endpoints

### Read

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | Liveness and the startup checks (chain id, vault code, keys, sanctions freshness) |
| GET | `/config` | Public runtime configuration: chain, vault, agent and owner addresses, owner mode, planner, tokens, EIP-712 domain |
| GET | `/mandate` | The mirror of the on-chain mandate: caps, window usage, allowlists, expiry, nonce |
| GET | `/portfolio` | Vault and agent balances for ETH, USDC and WETH |
| GET | `/intents` | Intents with verdicts and traces (`?limit=`) |
| GET | `/intents/:id` | One intent |
| GET | `/approvals` | The Tier 2 approval inbox, each with its intent |
| GET | `/approvals/:id/typed-data` | The EIP-712 payload the owner signs in MetaMask mode |
| GET | `/contacts` | The address book |
| GET | `/memory` | The memory store with provenance |
| GET | `/audit` | The hash-chained log (`?limit=`), with the current head |
| GET | `/audit/verify` | Verify the stored chain |
| GET | `/audit/export` | Download the log as JSONL |
| GET | `/identity` | Our ERC-8004 card, the oracle's card and the Know Your Agent check |
| GET | `/.well-known/agent.json` | Our ERC-8004 registration file |
| GET | `/x402/history` | x402 payments from petty cash, with policy reasons |
| GET | `/x402/float` | The petty cash float balance and limits |
| GET | `/attacks/catalog` | The attack catalog and the four defence configurations |
| GET | `/attacks/latest` | The most recent run report |
| GET | `/attacks/runs` and `/attacks/runs/:id` | Past runs |
| GET | `/openapi.json` | The OpenAPI document |

### Write (owner session required except `/chat` and `/quarantine`)

| Method | Path | Does |
|---|---|---|
| POST | `/chat` | Send an owner message to the agent; optional untrusted attachments go to quarantine. Returns the reply, the plan and the intent ids |
| POST | `/quarantine` | Ingest untrusted content into quarantine, returning its id |
| POST | `/approvals/:id/approve` | Approve a Tier 2 intent. Local mode: the server key signs. MetaMask mode: supply `ownerSig` and `deadline` |
| POST | `/approvals/:id/decline` | Decline with a reason |
| POST | `/mandate/asset` | Set the caps for an asset |
| POST | `/mandate/target` | Allow or disallow a target |
| POST | `/mandate/selector` | Allow or disallow a `(target, selector)` pair |
| POST | `/mandate/agent` | Set the agent expiry and active flag |
| POST | `/mandate/pause` and `/mandate/unpause` | The pause kill switch |
| POST | `/mandate/revoke` | Revoke the agent (kill switch) |
| POST | `/contacts` and DELETE `/contacts/:name` | Manage the address book |
| POST | `/memory` and DELETE `/memory/:key` | Manage memory (an owner session gives an entry owner provenance) |
| POST | `/audit/verify` | Verify a supplied copy of the chain (the dashboard tamper demo) |
| POST | `/attacks/run` | Run the attack suite against the chosen configurations and scenarios; configuration D uses the real pipeline and the deployed vault |
| POST | `/auth/passkey/register/*`, `/auth/passkey/assert/*` | The WebAuthn owner-authentication flow |

## Server-sent events

`GET /events` is a server-sent event stream. It replays recent events (honouring `last-event-id`) and then streams live. Event names:

| Event | Payload |
|---|---|
| `intent.updated` | The full intent view after any state change |
| `trace.step` | A single decision-trace step as it is recorded |
| `approval.created`, `approval.updated` | Approval lifecycle |
| `audit.appended` | Each new audit record |
| `mandate.updated` | A mandate change transaction landed |
| `chat.message` | An owner or agent message |
| `attack.progress` | One scenario-configuration result during a run |
| `system` | Other notices, including x402 payment records |

The dashboard subscribes to these for the live decision trace, the approvals inbox, the audit feed and the Security Lab matrix.

## EIP-712 domains and type strings

The vault's domain is `{ name: "MandateVault", version: "1", chainId, verifyingContract: <vault> }`.

The intent type string, which is the single source of truth and is tested for equality against the Solidity constant:

```
Intent(bytes32 kind,address target,address token,uint256 amount,bytes32 dataHash,uint256 nonce,uint256 deadline,bytes32 rationaleHash)
```

The approval type string:

```
Approval(bytes32 intentHash,uint256 deadline)
```

The agent signs the intent. For Tier 2 the owner signs the approval, which is bound to the intent hash and a deadline. Both digests are reproduced on-chain by `MandateVault.intentHash(i)` and `MandateVault.approvalHash(ih, deadline)`, and off-chain by `packages/core`'s `intentHash` and `approvalHash`; a committed fixture pins them to the same values.

## x402

The oracle (`apps/oracle`) serves two paid resources, `GET /prices` and `GET /risk/:address`, behind x402 v2 middleware, priced in USDC on the configured network. The agent pays with the `@x402/fetch` wrapper signing EIP-3009 authorizations from its petty cash account. On a public testnet the facilitator is `https://x402.org/facilitator`; on a local chain the oracle runs an in-process facilitator with the same scheme code. Each resource is also described in the oracle's ERC-8004 agent card at its own `/.well-known/agent.json`.
