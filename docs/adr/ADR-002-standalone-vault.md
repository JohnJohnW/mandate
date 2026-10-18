# ADR-002 A standalone vault, not the ERC-7710 delegation framework (for now)

## Context
The MetaMask Delegation Framework (ERC-7710/7715) is the closest standard to what we need: a general caveat-based delegation system. A production system should probably build on it or on a Safe module.

## Decision
Write a focused, standalone MandateVault contract for this competition, and document an ERC-7710 adapter as the next step.

## Alternatives considered
- ERC-7710 delegation with caveats: the right long-term choice, but the tiering and the on-chain human co-signature we wanted would have to be expressed as caveats, which is less legible and harder to audit in a competition timeframe.
- A Safe module: inherits Safe's audited core, but adds the Safe surface to read and reason about.

## Consequences
The enforcement is one small contract an auditor can read end to end, with named errors for every check. We give up the audited core and the interoperability of the standard. The vault is unaudited, which we state everywhere. The adapter is explicitly on the roadmap (docs/RELATED_WORK.md).
