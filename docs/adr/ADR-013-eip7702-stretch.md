# ADR-013 EIP-7702 account variant as a stretch goal

## Context
EIP-7702 lets an externally owned account run contract code. The same mandate logic could be an EIP-7702 delegate, so the owner's own account becomes the vault and funds never leave the owner address.

## Decision
Keep the standalone vault as the primary design and treat an EIP-7702 `MandateAccount7702` as a P2 stretch goal, built only after everything else is done.

## Alternatives considered
- Building the 7702 variant first: it is the more elegant end state (funds stay in the owner's account), but it carries extra risks that a competition prototype should not take on blind.

## Consequences
The primary path is the simple, well-tested vault. The 7702 variant, if built, must handle the extra risks of account-code delegates: storage-layout collisions with any future code, careful initialisation, and the re-delegation hazard where the account's code can be changed. We document these risks rather than ship the variant without them. The security self-assessment lists the 7702 variant as not built (known-risk 9).
