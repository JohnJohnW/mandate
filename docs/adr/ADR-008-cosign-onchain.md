# ADR-008 The co-signature is verified on-chain, and co-signed spend counts toward the window

## Context
The Tier 2 human co-signature could be checked off-chain (the service verifies the owner's signature and then sends) or on-chain (the contract verifies it). And co-signed spend could either count toward the per-window cap or not.

## Decision
Verify the owner's EIP-712 `Approval{intentHash, deadline}` signature in the contract, bound to the exact intent hash, consumed once. Count co-signed spend toward the per-window cap.

## Alternatives considered
- Off-chain approval: a compromised service could claim an approval exists. The contract would have no way to know.
- Not counting co-signed spend toward the window: would let a stream of owner-approved payments also open unlimited autonomous headroom in the same window.

## Consequences
An approval is worthless to an attacker who does not also control the owner key, and it cannot be replayed for another intent. Because an intent waiting for approval may lose its nonce to a later Tier 1 intent, the intent is rebuilt with the current nonce and re-signed by the agent at the moment the owner approves, so the owner's signature binds the hash the vault will actually see. Counting co-signed spend toward the window keeps the window a true blast-radius bound; the owner can always raise it or send directly.
