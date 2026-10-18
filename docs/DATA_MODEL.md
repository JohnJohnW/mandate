# Data model

Why read this: it describes what the runtime persists and how the audit chain is formed. The schema is in `apps/api/src/db.ts`; this is the map.

## Stores

The runtime keeps two stores:

- A SQLite file (`apps/api/data/mandate-<chainId>.db`), for operational state.
- An append-only JSONL file (`apps/api/data/audit-<chainId>.jsonl`), for the hash-chained audit log.

They are separate on purpose: the audit log is append-only and verifiable, and keeping it out of the mutable database makes tampering obvious.

## Entity relationships

```mermaid
erDiagram
  INTENTS ||--o| APPROVALS : "may require"
  INTENTS ||--o{ SPEND : "records on success"
  CONTACTS ||--o{ SPEND : "counterparty of"
  QUARANTINE ||--o{ INTENTS : "fills fields of"
  INTENTS {
    text id PK
    text state "Drafted..Executed"
    text kind
    text target
    text token
    text amount "base units as string"
    text data "calldata hex"
    text data_hash
    text nonce
    text deadline
    text rationale
    text intent_hash
    text verdict_json "policy verdict"
    text trace_json "decision trace"
    text simulation_json
    text tx_hash
    text revert_reason
    text source
    int tier
    text agent_sig
    text created_at
    text updated_at
  }
  APPROVALS {
    text id PK
    text intent_id FK
    text status "pending..consumed"
    text owner_sig
    text approval_deadline
    text declined_reason
    text signer
    text expires_at
    text created_at
  }
  CONTACTS {
    text name PK
    text address
    text added_at
  }
  MEMORY {
    text key PK
    text value
    text provenance "owner|memory"
    text origin
    text added_at
  }
  SPEND {
    int id PK
    text ts
    text token
    text amount
    text target
    int tier
    text intent_id
  }
  INBOUND {
    int id PK
    text ts
    text from_addr
    text token
    text amount
  }
  QUARANTINE {
    text id PK
    text kind
    text origin
    text text "the untrusted content"
    text parsed_json "typed fields"
    int suspected
    text matches_json
    text created_at
  }
  PASSKEYS {
    text id PK
    text public_key
    int counter
    text transports
    text created_at
  }
  ATTACK_RUNS {
    text id PK
    text started_at
    text finished_at
    text config
    text planner
    text results_json
  }
```

Bigints are stored as decimal strings, because SQLite has no native 256-bit integer and because the audit canonicalisation treats bigints as strings too.

## The audit chain

The audit log is not in the database. Each record is a line of JSON:

```
{ seq, ts, actor, event, payload, prevHash, hash }
```

where `hash = keccak256(prevHash || canonicalJSON({seq, ts, actor, event, payload, prevHash}))` and `canonicalJSON` sorts keys, serialises bigints as decimal strings and drops undefined. The first record's `prevHash` is the genesis hash (32 zero bytes).

```mermaid
flowchart LR
  G[genesis 0x00..00] --> R0[record 0<br/>hash h0]
  R0 -- prevHash h0 --> R1[record 1<br/>hash h1]
  R1 -- prevHash h1 --> R2[record 2<br/>hash h2]
  R2 -- prevHash h2 --> R3[...]
```

`verify()` recomputes the chain from genesis and reports the first record where the sequence, the `prevHash` link, or the recomputed hash does not match. Editing a payload, dropping a record, reordering two records, or appending a forged record all break the chain at or before the tampered record. This is tested in `packages/core/test/audit.test.ts`, and the dashboard's Audit page has a Verify button and a tamper demo that edits a record in a copy and shows verification failing.

## What is hashed, and retention

Every intent transition, every policy verdict with its reasons, every approval signature and decline, every chain receipt, every mandate change, every x402 payment and every attack run is appended. Payloads contain addresses, amounts, intent hashes and transaction hashes. Payloads never contain private keys. For a prototype there is no automatic retention or rotation; a deployment would rotate the JSONL and anchor periodic chain heads on-chain for external verifiability.
