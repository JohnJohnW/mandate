# Architecture Decision Records

Each record follows the Nygard format: Context, Decision, Alternatives considered, Consequences. They explain not just what we chose but why, and what we gave up.

- ADR-001 Chain choice: Base Sepolia
- ADR-002 A standalone vault, not the ERC-7710 delegation framework (for now)
- ADR-003 Caps per asset, not in a fiat unit of account
- ADR-004 A fixed spending window, not a sliding window
- ADR-005 Plan-then-execute, not ReAct
- ADR-006 An OpenAI-compatible LLM abstraction
- ADR-007 Off-chain policy plus on-chain enforcement
- ADR-008 The co-signature is verified on-chain, and co-signed spend counts toward the window
- ADR-009 Passkeys for owner approval in local mode, not OTP
- ADR-010 SQLite, not Postgres
- ADR-011 A TypeScript monorepo, not Python
- ADR-012 A petty-cash float for x402 payments
- ADR-013 EIP-7702 account variant as a stretch goal
