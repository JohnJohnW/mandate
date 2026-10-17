# Assumptions

Why read this: it records every default we took where a decision was left open, so reviewers can see what was chosen and why.

| # | Question | Default taken | Date |
|---|---|---|---|
| 1 | Git identity and repository | John Wynter, repository JohnJohnW/mandate on GitHub (private until submission) | 2026-10-17 |
| 2 | Team and product name, members | Team "Mandate", product "Mandate", member John Wynter | 2026-10-17 |
| 3 | LLM endpoint | Not configured at scaffold time. The runtime uses the deterministic MockPlanner (PLANNER=mock) until LLM_BASE_URL, LLM_API_KEY and LLM_MODEL are set in .env | 2026-10-17 |
| 4 | Chain | Base Sepolia (chain id 84532) as primary; Ethereum Sepolia (11155111) as fallback; both are the only chain ids the apps accept | 2026-10-17 |
| 5 | Owner mode | Local owner key held by the API behind a passkey prompt (OWNER_MODE=local) first; MetaMask signing as a P1 addition | 2026-10-17 |
| 6 | Basescan API key | None. Source verification uses Blockscout, which needs no key | 2026-10-17 |
| 7 | Project folder | ~/Projects/mandate on the development machine | 2026-10-17 |
| 8 | Toolchain | Node 22 via nvm, pnpm 10, Foundry and pandoc via Homebrew, Marp and mermaid-cli via pnpm | 2026-10-17 |
| 9 | Licence | MIT for our code | 2026-10-17 |
| 10 | Caps unit | Per asset in base units (wei, USDC 6 decimals), not fiat. See ADR-003 | 2026-10-17 |
