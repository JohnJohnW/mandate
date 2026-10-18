# ADR-003 Caps per asset, not in a fiat unit of account

## Context
A spending cap could be denominated in a fiat unit (for example "no more than 100 USD per day across all assets"), which needs a price oracle, or per asset in its own base units.

## Decision
Denominate caps per asset in base units (wei, USDC's 6 decimals, each token's own units).

## Alternatives considered
- Fiat-denominated caps with a price oracle: more intuitive for an owner, but introduces an oracle the attacker can target, and a manipulated price becomes a way to move more value than intended.

## Consequences
The vault has no oracle dependency and stays small, so there is no oracle to manipulate. The trade-off is that the owner sets a cap per token, and the caps do not automatically track fiat value as prices move. For a containment control this is the safer default: the bound is exact and unmanipulable.
