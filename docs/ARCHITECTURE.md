# Architecture

Why read this: it is the map of the system. It shows the components, the trust boundaries between them, how an instruction becomes an on-chain transaction, and what happens when each part fails. Read it before the code.

## 1. The one idea

An AI agent should hold a mandate, not a key. The owner grants a scoped, time-bound mandate that a smart contract enforces. The agent operates autonomously inside the mandate, must obtain a human co-signature above it, and is reverted by the chain outside it. The property we defend is this: a fully compromised agent process, including its prompt, its memory, its tools and even its private key, cannot move value outside the mandate, because the on-chain enforcement layer does not trust the agent.

## 2. System context

```mermaid
flowchart LR
  subgraph Humans
    O[Owner / Treasurer]
  end
  subgraph Mandate["Mandate (this repo)"]
    W[Web dashboard<br/>Next.js, apps/web]
    A[Agent runtime<br/>planner, tools, executor<br/>apps/api]
    P[Policy engine<br/>deterministic, fail-closed<br/>packages/core]
    S[Pre-flight simulator]
    L[(Audit log<br/>hash-chained)]
  end
  subgraph Chain["Base Sepolia (or Anvil)"]
    V[MandateVault.sol<br/>on-chain enforcement]
    U[USDC / WETH / test tokens]
    I[ERC-8004 Identity Registry]
  end
  subgraph Counterparties
    X[Oracle agent<br/>x402 paid API<br/>apps/oracle]
    C[Contacts / contracts]
  end
  O -- set mandate, approve, revoke --> W
  W <--> A
  A --> P --> S --> V
  V --> U
  V --> C
  A -- pays per request --> X
  A -- identity --> I
  X -- identity --> I
  A --> L
  P --> L
  V -. events .-> L
```

The owner talks to the agent only through the dashboard's owner channel. Everything else the agent reads, token metadata, invoices, oracle responses, memory entries, is untrusted data.

## 3. Defence in depth: seven layers

```mermaid
flowchart TB
  L0["L0 Context isolation<br/>provenance tags, quarantine reader, plan-then-execute<br/>[Beurer-Kellner 2025] [CaMeL] [OWASP-LLM01] [OWASP-ASI01] [OWASP-ASI06]"]
  L1["L1 Typed intent<br/>zod schema + EIP-712 struct, signed by the agent key<br/>[EIP-712] [INC-BYBIT blind signing]"]
  L2["L2 Policy engine (off-chain)<br/>tiering, caps, allowlists, sanctions screening, poisoning check<br/>[NIST-SP800-53 AC-3] [NIST-SP800-53 AC-6] [NIST-SP800-207] [FATF-R15] [OWASP-ASI02] [OWASP-ASI03]"]
  L3["L3 Pre-flight simulation<br/>eth_simulateV1, eth_call fallback, asset-delta vs intent<br/>[OWASP-LLM05]"]
  L4["L4 On-chain enforcement<br/>MandateVault: caps, windows, allowlists, co-sign, pause<br/>[MM-SEC-AUG26]"]
  L5["L5 Human in the loop<br/>Tier 2 approvals, passkey or MetaMask, bound to the intent hash<br/>[NIST-AI-RMF] [OWASP-ASI09]"]
  L6["L6 Observability and forensics<br/>decision trace, hash-chained audit log, kill switch<br/>[NIST-SP800-53 AU-2] [NIST-SP800-53 AU-10] [NCCOE-AGENT-ID]"]
  L7["L7 Identity<br/>ERC-8004 agent identity and counterparty checks<br/>[ERC-8004] [NIST-AGENT-INIT]"]
  L0 --> L1 --> L2 --> L3 --> L4
  L5 -. unlocks Tier 2 .-> L4
  L0 --> L6
  L2 --> L6
  L4 --> L6
  L7 -. informs .-> L2
```

L0 to L3 exist to make the agent useful and to stop attacks early and cheaply. L4 and L5 are the guarantees. The distinction matters: if an attacker defeats L0 to L3, L4 still holds, because the vault re-checks every bound itself and trusts nothing the agent computed. Our evaluation measures exactly this (see docs/EVALUATION.md): with the off-chain layers alone a compromised key still drains the funds, and only the on-chain layer stops it.

## 4. Components and responsibilities

| Layer | Package or app | Responsibility | Trusts |
|---|---|---|---|
| L0 | apps/api (planner, quarantine) | Keep untrusted content out of the planner. Turn it into typed fields with provenance. | The owner channel only |
| L1 | packages/core (intent, eip712) | One typed intent schema, one EIP-712 definition, signed by the agent. | The schema |
| L2 | packages/core (policy) | Deterministic verdict: tier, decision, reasons, citations. Fail closed. | Chain state (the mandate mirror), the sanctions snapshot |
| L3 | apps/api (simulator) | Compare simulated asset deltas with the intent. Fail closed. | The RPC |
| L4 | packages/contracts (MandateVault) | Enforce every bound on-chain. The guarantee. | The owner only |
| L5 | apps/api (auth), apps/web (approvals) | Bind an owner co-signature to one intent hash. | The owner's passkey or wallet |
| L6 | packages/core (audit, trace), apps/web | Hash-chained log, live trace, kill switch. | Nothing; it is append-only and verifiable |
| L7 | apps/api (identity), ERC-8004 registry | Portable on-chain identity, Know Your Agent. | The registry |

## 5. Autonomous execution (Tier 1)

```mermaid
sequenceDiagram
  autonumber
  participant O as Owner
  participant A as Agent runtime
  participant Q as Quarantine reader
  participant P as Policy engine
  participant S as Simulator
  participant V as MandateVault
  participant L as Audit log
  O->>A: "Pay the oracle for prices and wrap idle ETH"
  A->>A: Planner emits a typed plan (no tool output seen yet)
  A->>Q: Fetch quote / invoice (untrusted)
  Q-->>A: Structured fields only (amount, payTo), schema-validated, provenance untrusted
  A->>A: Build Intent{kind, target, token, amount, dataHash, nonce, deadline, rationaleHash}
  A->>A: Agent signs the EIP-712 intent (L1)
  A->>P: evaluate(intent, context) (L2)
  P-->>A: Tier 1 ALLOW + reasons with citations
  A->>S: simulate(intent) (L3)
  S-->>A: Asset deltas match the intent
  A->>V: execute(intent, data, agentSig) (L4)
  V->>V: not paused, active, not expired, deadline, nonce, allowlist, perTxCap, windowCap
  V-->>A: IntentExecuted(event) + tx hash
  A->>L: append(trace, verdicts, tx hash) with prev-hash (L6)
  A-->>O: Summary with explorer link and rationale
```

## 6. Escalation (Tier 2)

```mermaid
sequenceDiagram
  autonumber
  participant A as Agent runtime
  participant P as Policy engine
  participant W as Dashboard
  participant O as Owner
  participant V as MandateVault
  A->>P: evaluate(intent: 0.5 ETH to a new contact)
  P-->>A: Tier 2 ESCALATE (above the autonomous cap, counterparty not allowlisted)
  A->>W: Create an approval request (intent hash, rationale, simulation, risk flags, expiry)
  W->>O: Approvals inbox
  O->>W: Review, then sign EIP-712 Approval{intentHash, deadline} (passkey-gated local key or MetaMask)
  Note over A: The intent is re-built with the current nonce and re-signed before the owner signs, so the approval binds the hash the vault will see (ADR-008)
  W-->>A: ownerSig
  A->>V: executeWithApproval(intent, data, agentSig, deadline, ownerSig)
  V->>V: recover owner, check deadline, coSignCap, nonce, mark approval consumed
  V-->>A: IntentExecuted
  Note over V: Replaying ownerSig for any other intent reverts
```

## 7. Intent lifecycle

```mermaid
stateDiagram-v2
  [*] --> Drafted: planner output validated
  Drafted --> Blocked: policy DENY (Tier 3 or screening hit)
  Drafted --> Simulating: policy ALLOW (Tier 1)
  Drafted --> AwaitingApproval: policy ESCALATE (Tier 2)
  AwaitingApproval --> Simulating: owner signed
  AwaitingApproval --> Expired: deadline passed
  AwaitingApproval --> Rejected: owner declined
  Simulating --> Blocked: simulation deviates or is unavailable
  Simulating --> Submitted: tx sent
  Submitted --> Executed: receipt success
  Submitted --> RevertedOnChain: vault reverted
  Blocked --> [*]
  Executed --> [*]
  RevertedOnChain --> [*]
  Expired --> [*]
  Rejected --> [*]
```

Every state transition is an audit-log record. The dashboard's Agent page shows the trace of these transitions live over server-sent events.

## 8. Trust boundaries

```mermaid
flowchart TB
  subgraph Untrusted["Untrusted (data only)"]
    TM[Token metadata]
    IV[Invoices and quotes]
    OR[Oracle responses]
    MEM[Memory entries not from the owner]
    WEB[Web content]
  end
  subgraph Agent["Agent process (may be fully compromised)"]
    PL[Planner]
    TOOLS[Tools]
    EXEC[Executor + agent key]
  end
  subgraph Trusted["Trusted"]
    OWNER[Owner channel + owner key/passkey]
    CHAINSTATE[Chain state]
  end
  subgraph Guarantee["The guarantee"]
    VAULT[MandateVault on-chain]
  end
  TM & IV & OR & MEM & WEB -. quarantined .-> PL
  OWNER --> PL
  CHAINSTATE --> PL
  PL --> TOOLS --> EXEC --> VAULT
  OWNER --> VAULT
  VAULT -. reverts anything outside the mandate .-> EXEC
```

The boundary that matters is the one around the vault. The agent process is drawn as a single compromise zone on purpose: we assume all of it can fall. The vault accepts owner transactions and agent transactions, and for agent transactions it re-derives every limit from its own storage.

## 9. Data flow

1. The owner sends a message through the dashboard. It is the only instruction channel.
2. The agent assembles the planner input from trusted sources only: the owner message, the mandate summary read from chain, the address book, memory entries tagged with provenance, and the tool catalogue. Untrusted content is present only as quarantine ids and field names.
3. The planner emits a typed plan: steps naming tools and literal arguments, or references to quarantined values by id. It never receives raw tool output.
4. The executor runs the steps. The only write path is `propose_intent`, which builds a typed intent and runs it through policy, simulation and the vault. There is no raw send tool.
5. Every verdict, transition and receipt is appended to the hash-chained audit log and streamed to the dashboard.

## 10. Failure modes and fail-closed behaviour

| Component unavailable | Behaviour | Where |
|---|---|---|
| Policy engine throws | The intent is denied; the thrown rule is recorded as a deny reason | packages/core, `evaluate` catches per-rule |
| Sanctions list missing or stale | The screening rule denies; nothing transacts | packages/core, `screeningRule` |
| Simulation unavailable or RPC down | The simulation rule denies; nothing is sent | packages/core, `simulationRule`; apps/api `Simulator` returns method "none" |
| LLM endpoint down | The MockPlanner (deterministic) serves the demo scenarios; the live planner returns an empty plan with an explanation on error | apps/api, `MockPlanner`, `LivePlanner` |
| Chain id is not a testnet | The process refuses to start | apps/api `config`, contracts `deploy` and `env` |
| Vault code missing at the configured address | Startup check fails and the process stops | apps/api `runStartupChecks` |
| Owner key missing in local mode | Startup check fails | apps/api `runStartupChecks` |

The rule is uniform: when a layer cannot do its job, the agent does not transact.

## 11. Deployment topology

```mermaid
flowchart LR
  subgraph Dev["Developer machine or demo host"]
    WEB[apps/web Next.js :3000]
    API[apps/api Hono :4010<br/>SQLite file, audit JSONL]
    ORACLE[apps/oracle Hono :4020]
  end
  subgraph ChainN["Base Sepolia (84532) or Anvil (31337)"]
    VAULT[MandateVault]
    REG[ERC-8004 Identity Registry]
    TOK[USDC / WETH]
  end
  FAC[x402 facilitator<br/>x402.org on testnet, in-process on Anvil]
  WEB <--> API
  API --> VAULT
  API --> REG
  API -- pays --> ORACLE
  ORACLE --> FAC --> TOK
  API --> ChainN
```

The three services are independent Node processes. State lives in a SQLite file and an append-only audit JSONL, both under `apps/api/data`. Keys live in `.env`, which is never committed. Nothing requires a database server or a cloud account.

## 12. Where the enforcement actually is

A reader in a hurry should take away one table. For each thing the agent might do, this is the layer that finally stops it when every earlier layer has failed.

| The agent tries to | Finally stopped by | Error |
|---|---|---|
| Send more than the per-transaction cap | L4 the vault | `AbovePerTxCap` |
| Drain the daily window with many small sends | L4 the vault | `AboveWindowCap` |
| Pay a counterparty outside the allowlist | L4 the vault (unless the owner co-signs) | `TargetNotAllowed` |
| Call a contract function outside the allowlist | L4 the vault | `SelectorNotAllowed` |
| Grant an unlimited token approval | L4 the vault | `UnlimitedApproval` |
| Act after the owner revokes or pauses | L4 the vault | `AgentNotActive`, `EnforcedPause` |
| Reuse an owner approval for another intent | L4 the vault | `BadOwnerSignature` |
| Change its own mandate | L4 the vault | `OwnableUnauthorizedAccount` |

See docs/PERMISSION_TIERS.md for the exact parameters and worked examples with transaction hashes, and docs/THREAT_MODEL.md for the attack trees.

Citations resolve in docs/REFERENCES.md.
