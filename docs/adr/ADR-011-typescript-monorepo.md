# ADR-011 A TypeScript monorepo, not Python

## Context
The agent, the policy engine, the dashboard and the contracts tooling could be written in Python or TypeScript.

## Decision
Use a TypeScript monorepo with pnpm workspaces. Solidity with Foundry for the contracts.

## Alternatives considered
- Python for the agent and policy engine: strong LLM ecosystem, but a second language boundary to the dashboard (TypeScript) and to viem for chain access.

## Consequences
One language and one type system span the intent schema, the EIP-712 definitions, the policy engine, the API and the dashboard, so the typed intent is literally the same type everywhere, and the Solidity type hash is generated from the same definition and tested for equality. viem and wagmi give first-class chain access. The trade-off is that some LLM tooling is more mature in Python; the OpenAI-compatible abstraction means we do not need it.
