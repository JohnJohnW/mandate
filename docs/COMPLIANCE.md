# Compliance context

Why read this: it places Mandate against the rules that touch agent payments and on-chain value movement. It is not legal advice, and Mandate is not a financial service. It is a testnet research prototype. The point is to show that the controls we built map to real regulatory expectations, and to be honest about what a real deployment would need.

Plain statement up front: Mandate is a research prototype that runs on public testnets and a local chain. It custodies no real funds, offers no service to the public, and makes no investment decisions on anyone's behalf. Nothing here should be read as a claim of regulatory compliance.

## How the controls relate to the rules

| Regime | What it expects | What Mandate does |
|---|---|---|
| FATF Recommendation 15 and the Travel Rule (R.16), and the July 2026 targeted update [FATF-R15] | Virtual-asset service providers screen counterparties and carry originator and beneficiary information; stablecoin misuse is called out as a rising risk | We screen every counterparty against the OFAC sanctions snapshot and fail closed when the list is missing or stale. The hash-chained audit log records the originator (the vault), the beneficiary and the amount for every transaction. We do not implement full Travel Rule messaging; a real VASP deployment would. |
| OFAC sanctions [OFAC-SDN] | Do not transact with sanctioned addresses | The policy engine denies any intent whose counterparty is on the sanctions snapshot, and the x402 petty cash policy denies a payment to a sanctioned payee. On mainnets the Chainalysis on-chain oracle could be added; it is not available on Base Sepolia. |
| Hong Kong Stablecoins Ordinance and the first issuer licences, April 2026 [HK-STABLECOIN] | Licensed issuers, full backing, redemption, segregation, audits | Out of scope: we issue nothing. Relevant because the assets an agent moves may be regulated stablecoins; our caps and screening apply whatever the asset. |
| EU MiCA [EU-MICA] | Authorisation and conduct rules for crypto-asset services | Out of scope for a prototype; a service built on this pattern in the EU would need authorisation. Our per-asset caps and audit trail are the kind of controls a conduct regime expects. |
| US GENIUS Act, 2025 [US-GENIUS] | Federal framework for payment stablecoins | Same posture: out of scope; relevant to the assets moved. |
| EU AI Act [EU-AI-ACT] | Risk-based obligations for AI systems; transparency and human oversight for higher-risk uses | We implement human oversight directly: Tier 2 requires a human co-signature bound on-chain, and the owner holds a one-transaction kill switch. The decision trace and the audit log provide transparency and attributable records. |
| NIST AI RMF and the Generative AI Profile [NIST-AI-RMF] [NIST-AI-600-1] | Govern, Map, Measure, Manage | Govern: the mandate and the kill switch. Map: the threat model. Measure: the Security Lab evaluation. Manage: fail-closed behaviour and the audit log. |
| NIST agent identity and least agency [NIST-AGENT-INIT] [NCCOE-AGENT-ID] | Distinct agent identities, task-scoped credentials, attributable audit logs | We give the agent a distinct ERC-8004 identity, scope its authority with the mandate (least agency), and keep an attributable hash-chained log. |
| ISO/IEC 42001 [ISO-42001] | An AI management system | Out of scope for a prototype; the controls, the documented risks and the evaluation are the raw material such a system would organise. |

## Mainland China

The competition is hosted in Shenzhen, so the context deserves a direct note. Mainland China prohibits virtual-currency trading and related services [PBOC-2021]. Mandate is a research prototype on public testnets, not a service offered in mainland China. The pattern it demonstrates, a scoped mandate enforced by a smart contract, is not specific to public permissionless chains. It applies equally on a permissioned consortium chain such as FISCO BCOS, which WeBank leads: the vault's checks (caps, allowlists, co-signature, pause) are ordinary smart-contract logic that a permissioned chain runs the same way. A deployment in a jurisdiction that restricts public crypto would use permitted rails and the same mandate contract. We have not built the FISCO BCOS variant; it is noted as a roadmap item.

## What a real deployment would add

We are explicit that a prototype is not a product. Before anything touched real value, it would need at least:

- A third-party audit of the vault, and a bug-bounty.
- Full Travel Rule messaging for regulated counterparties, and KYC on the owner where required.
- A hardware or MPC custody solution for the owner key, and ideally for the agent key, in place of `.env`.
- A sanctions feed with a service-level agreement, not a periodically refreshed snapshot.
- Jurisdiction-specific authorisation for whatever service the agent performs.

Saying this is part of the compliance posture: the honest position is that Mandate shows a control pattern, not a compliant service.

Citations resolve in docs/REFERENCES.md.
