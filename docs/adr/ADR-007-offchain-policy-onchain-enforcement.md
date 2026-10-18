# ADR-007 Off-chain policy plus on-chain enforcement

## Context
Enforcement could live entirely off-chain (a policy service decides, the agent sends), entirely on-chain (the contract decides everything), or in both.

## Decision
Do both, with a clear division: the off-chain policy engine stops attacks early, explains itself with cited reasons, and runs rules that are impractical on-chain (sanctions screening, address-poisoning similarity, provenance). The on-chain vault is the guarantee and re-checks every bound it can.

## Alternatives considered
- Off-chain only: a compromised agent that bypasses the software moves funds. This is exactly what configurations A to C in our evaluation show.
- On-chain only: screening, poisoning and provenance are impractical or impossible on-chain, and the owner gets no early, explained decision.

## Consequences
The agent is useful and explains itself, and the funds are safe even when the off-chain layers are defeated. The cost is that two implementations of the mandate bounds must agree; we pin them with a shared fixture tested on both sides. The evaluation measures the value of the split directly.
