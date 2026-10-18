# Registration summary

Entry title: Mandate, a policy-bound autonomous wallet agent with on-chain enforced permissions

Team: Mandate. Member: John Wynter.

Repository: https://github.com/JohnJohnW/mandate (private until submission).

## Proposal summary (about 180 words)

Mandate is an autonomous on-chain wallet agent built on one principle: an AI agent should hold a mandate, not a key. The owner defines a scoped mandate (per-transaction and daily caps per asset, allowed counterparties and contract functions, an expiry, and a co-signature threshold) that a smart contract on Base enforces, so even a fully compromised agent cannot move value outside it. Above the autonomous tier the agent must obtain a human EIP-712 co-signature that the contract verifies; outside the mandate the chain reverts. The agent plans with a plan-then-execute architecture that quarantines untrusted content, formalises every action as a signed typed intent, screens counterparties against sanctions lists and address-poisoning patterns, simulates before sending, and writes a hash-chained audit trail. It manages assets, executes transfers and contract calls, pays other agents per request through x402, and carries an ERC-8004 on-chain identity. A built-in red-team harness replays documented 2025 to 2026 attack patterns across four defence configurations and reports measured results. Controls are mapped to the OWASP Top 10 for LLM and Agentic Applications, NIST AI RMF and SP 800-53, MITRE ATLAS and FATF guidance.

## Deliverables in the repository

- Technical documentation: docs/ARCHITECTURE.md, docs/PERMISSION_TIERS.md, docs/SECURITY_SELF_ASSESSMENT.md and the full docs set.
- Source code with a README, deployment instructions (docs/RUNBOOK.md) and test suites (forge test, pnpm test).
- A presentation deck (submission/deck) and a demo script (docs/DEMO_SCRIPT.md).
- A security self-assessment with the permission-tier implementation and a known-risk list.
- Execution evidence with real transaction hashes (docs/EXECUTION_EVIDENCE.md).
- A measured evaluation of the defence layers (docs/EVALUATION.md).
