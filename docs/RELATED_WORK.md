# Related work

Why read this: judges respect a clear account of prior art. This says what exists, what we borrowed, and where Mandate differs. We are not the first to put caps on an agent wallet. We are making a specific argument about where the enforcement has to live.

## The argument in one line

Most agent-wallet designs put the limits in the app, the agent, or a hosted service. We put them in a contract the owner controls, so that a fully compromised agent still cannot exceed them, and we measure that this matters.

## Prior art

### IntentGuard (MetaMask x 1Shot x Venice hackathon, 2025) [INTENTGUARD]

Binds an x402 payment intent to an ERC-7710 delegation with caveats, and splits the planner in a CaMeL style. Base Sepolia. We borrowed the core instinct, bind the payment to a typed, caveated authorisation, and the planner split. We differ in scope (IntentGuard is payments only; Mandate also does transfers, contract calls, idle-asset handling and identity) and in the explicit tiering with an on-chain human co-signature. IntentGuard's numbers are author-reported for one scenario family; we publish a measured matrix across four defence configurations.

### Coinbase Agentic Wallets and AgentKit (11 February 2026) [CB-AGENTIC-WALLETS]

Hosted wallets with TEE custody, session caps, per-transaction limits and KYT. This is strong engineering and shipped at scale. The difference is inspectability and control: the enforcement is a hosted service you cannot read or run, and the caps are the provider's. Mandate's vault is a contract the owner deploys and owns; anyone can read it, run its tests, and see the exact checks. We trade the convenience of hosted custody for an enforcement surface the owner controls and an auditor can inspect.

### MetaMask Delegation Framework, ERC-7710 and ERC-7715 ("Gator") [ERC-7710] [MM-ADV-PERMS]

A general framework for smart-contract delegation with caveats, and wallet-level advanced permissions. This is the closest standard to what we do, and a production system should probably build on it rather than on a bespoke vault. We wrote a focused vault instead for three reasons, recorded in ADR-002: it keeps the contract small and easy to audit for a competition; it lets us express the exact tiering and co-signature semantics we wanted without fitting them to the caveat model; and it makes the enforcement legible in a single file. We note explicitly that an ERC-7710 adapter is the right next step, and we describe its design in the roadmap.

### Clawnch and CoinFello [MM-CLAWNCH] [MM-SEC-AUG26]

Product-specific use of contract caveats and secure-enclave keys so agents earn and spend inside on-chain limits. These validate the thesis that agent authority should be enforced on-chain. Mandate generalises the pattern beyond one product and adds the measured red-team evaluation and the explicit co-signature tier.

### Safe modules

Safe's module system lets you attach spending policies to a Safe. A production deployment could implement MandateVault's logic as a Safe module, which would inherit Safe's audited multisig core. We note this as an alternative in ADR-002; we chose a standalone vault for legibility in a competition setting.

### Google AP2 and Stripe/Tempo MPP [AP2] [MPP]

Agent payment protocols with signed Intent, Cart and Payment mandates (AP2) and a machine-payments settlement layer (MPP). These are about the payment-authorisation format and settlement, complementary to what we do. Mandate's typed intent and EIP-712 approval are in the same spirit; a production system could speak AP2 at the authorisation boundary and still enforce with a vault underneath.

## The design patterns we implement

From the research on securing agents, we implement specific named patterns:

- Plan-then-execute and the Dual LLM pattern [Beurer-Kellner 2025], so the planner never sees raw untrusted content.
- CaMeL-style quarantine [CaMeL], so untrusted content becomes typed fields with provenance, not instructions.
- The lethal-trifecta framing [Willison-Trifecta]: private data, untrusted content and external communication are the dangerous combination; we break it by making the external-communication step (moving value) pass through a layer the untrusted content cannot influence.

## Where Mandate is different, kept honest

Five differences, each kept true in the build:

1. Explicit permission tiers enforced on-chain, including a human co-signature the contract itself verifies. Prior art mostly stops at caps.
2. Full financial-participant scope: asset management, transaction execution, machine-to-machine payments with a petty-cash float, and on-chain identity for both our agent and the agents it pays.
3. A measured security story: a red-team harness replays documented 2025 to 2026 attack patterns across four defence configurations and publishes the matrix, with methodology and limitations.
4. Operator-grade observability: a live decision trace, a hash-chained tamper-evident audit log with a verify button, and a one-transaction kill switch.
5. Standards mapping as a first-class deliverable, cross-referenced to OWASP, NIST, MITRE ATLAS, FATF and the relevant EIPs.

We are not claiming novelty in any single piece. The contribution is the combination, the insistence that the guarantee lives on-chain, and the measurement that shows why.

Citations resolve in docs/REFERENCES.md.
