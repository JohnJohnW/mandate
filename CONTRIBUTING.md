# Contributing

This repository is a student team's competition entry. These notes keep the codebase consistent.

## Setup

See docs/RUNBOOK.md for prerequisites (Node 22, pnpm 10, Foundry) and the install steps. In short:

```bash
pnpm install
pnpm --filter @mandate/contracts setup
pnpm keys:generate
```

## Working style

- TypeScript strict across the monorepo; Solidity with Foundry. One language and one type system span the intent schema, the policy engine, the API and the dashboard.
- Tests come with changes. Run `pnpm test` and `pnpm contracts:test`. The API pipeline tests need a local Anvil running.
- Lint and format before committing: `pnpm lint` and `pnpm format`.
- Commits are small and use conventional-commit messages written in plain English, for example `feat(vault): add a rolling window spend cap`.

## Writing style for docs, UI and the deck

- No em dashes and no en dashes anywhere. Use commas, colons, parentheses or full stops.
- Plain, direct, first-person plural team voice. No marketing superlatives we cannot back.
- Every security control is tied to a named authority (OWASP, NIST, MITRE ATLAS, an EIP, FATF, or a cited incident), resolved in docs/REFERENCES.md.
- Architecture and flow claims get a mermaid diagram, kept accurate to the code.
- Decisions are recorded as ADRs (docs/adr) in the Nygard format.

## Project layout

See the repository map in README.md. Shared types live in packages/core; the contracts and their scripts in packages/contracts; the attack catalog and report renderer in packages/attacks; the runtime in apps/api; the oracle in apps/oracle; the dashboard in apps/web.
