# ADR-001 Chain choice: Base Sepolia

## Context
We need a testnet with cheap gas, good tooling, a USDC with EIP-3009 for x402, a working x402 facilitator, and EIP-7702 support for the stretch goal. The competition is testnet-only and we must produce real transaction hashes.

## Decision
Use Base Sepolia (chain id 84532) as the primary chain, with Ethereum Sepolia (11155111) as a documented fallback and a local Anvil chain (31337) for development and the demo. The apps refuse any other chain id at startup.

## Alternatives considered
- Ethereum Sepolia: more congested, slower, no first-party x402 facilitator relationship. Kept as a fallback.
- A local chain only: no public-explorer evidence, which the brief requires.
- An OP-stack L2 other than Base: fewer of the pieces (x402 facilitator, CDP faucet giving both ETH and USDC) line up.

## Consequences
We get cheap, fast transactions, a canonical WETH predeploy, a USDC with EIP-3009, the free x402 testnet facilitator, and EIP-7702 support. We depend on Base Sepolia's public RPC, which can rate-limit; the runbook explains supplying an Alchemy or QuickNode URL. Everything is chain-id-asserted, so a mainnet RPC is refused.
