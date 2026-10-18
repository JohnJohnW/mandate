# Security policy

Mandate is a research prototype for a competition. It is testnet only and the vault contract is unaudited. Do not use it with real funds.

## Reporting a vulnerability

If you find a security issue, please open a private report to the team rather than a public issue. Include the component, a description, and a reproduction if you have one. We will acknowledge and respond as the project timeline allows.

## Scope and known limits

The known risks are listed, with a severity and a status, in docs/SECURITY_SELF_ASSESSMENT.md. In short: the vault is unaudited, the agent key lives in a local `.env` (which is the threat the design contains, not a surprise), the sanctions list is a periodically refreshed snapshot, and the LLM is non-deterministic. The containment guarantee is that a compromised agent cannot move value outside the owner's mandate; it is not a guarantee that the agent is correct inside it.

## Handling of secrets

Private keys are generated locally, never logged (addresses only), and never committed. `.env` is excluded from git and written with restrictive permissions. If you believe a key has been exposed, rotate it; on testnet, generate a new one with `pnpm keys:generate` and redeploy.
