---
marp: true
theme: default
paginate: true
size: 16:9
style: |
  section { font-size: 24px; background: #0b0f14; color: #e6edf3; }
  h1, h2 { color: #2dd4bf; }
  code { color: #93c5fd; }
  table { font-size: 20px; }
  a { color: #60a5fa; }
  strong { color: #e6edf3; }
  section.lead h1 { font-size: 52px; }
  section.lead { text-align: center; }
---

<!-- _class: lead -->

# Mandate

## An AI agent should hold a mandate, not a key

A policy-bound autonomous on-chain wallet agent

Team Mandate, 2026 Shenzhen International FinTech Competition, Topic F

Testnet only. The vault contract is unaudited.

<!--
Speaker notes (0:30). Introduce the team and the one line: an AI agent should hold a mandate, not a key. Say up front that this is a testnet research prototype and the contract is unaudited, so the audience trusts the honesty of everything that follows.
-->

---

# The problem is not hypothetical

- **May 2026:** an attacker drained about **$150,000** from a Grok-linked agent wallet. The transfer instruction was hidden in Morse code; an airdropped NFT escalated the agent's permissions. [INC-GROK-BANKR]
- **NIST CAISI:** indirect prompt injection succeeded in roughly **81%** of attempts in a large red-teaming competition. [NIST-CAISI-REDTEAM]
- **Address poisoning:** about **$62M** across two victims in two months. [INC-ADDRPOISON]

Prompting alone does not hold. An agent that holds a key is a key with a language model attached.

<!--
Speaker notes (1:00). Land the problem with one incident and one number. The Grok drain is memorable and shows two mechanisms at once: injection and privilege escalation. The 81 percent figure says this is not a tail risk. End on the framing: a wallet agent that holds the key is the whole attack surface.
-->

---

# The thesis

The owner grants a **scoped, time-bound mandate** that a **smart contract enforces**.

- The agent acts **autonomously inside** the mandate.
- It needs a **human co-signature above** it.
- It is **reverted by the chain outside** it.

**The property we defend:** a fully compromised agent process, including its prompt, memory, tools and even its private key, cannot move value outside the mandate, because the on-chain layer does not trust the agent.

<!--
Speaker notes (1:00). This is the heart. Say the three clauses slowly. Then state the property precisely: we assume the whole agent falls, and the funds are still safe. That assumption is what separates us from caps-in-the-app designs.
-->

---

# Architecture: seven defence layers

| Layer | What it does |
|---|---|
| L0 Context isolation | Quarantine untrusted content; plan-then-execute |
| L1 Typed intent | A zod + EIP-712 intent, signed by the agent |
| L2 Policy engine | Tiers, caps, allowlists, screening, poisoning, provenance |
| L3 Simulation | Compare asset deltas with the intent |
| **L4 On-chain vault** | **Enforce every bound. The guarantee.** |
| L5 Human in the loop | Tier 2 co-signature, verified on-chain |
| L6 Observability | Hash-chained audit log, kill switch |
| L7 Identity | ERC-8004 agent identity, Know Your Agent |

**L4 does not trust L0 to L3.** The early layers make the agent useful and cheap to defend; the vault is the backstop.

<!--
Speaker notes (1:30). Walk down the layers quickly, then stop on the key sentence: L4 does not trust the layers above it. Everything an attacker could corrupt lives above the line; the vault re-derives every limit itself. This is the design decision the whole talk rests on.
-->

---

# Permission tiers

| Tier | The agent may | Enforced |
|---|---|---|
| 0 Observe | Read only, no signing | Runtime |
| 1 Autonomous | Transfers and allowlisted calls within caps | Policy + vault |
| 2 Co-sign | Above caps, with an owner EIP-712 approval the contract verifies | Policy escalates, vault verifies |
| 3 Forbidden | Nothing: unlimited approvals, non-allowlisted selectors, changing its own mandate | No code path exists |
| K Kill switch | Owner-only pause and revoke | `onlyOwner` |

The tier is **computed on-chain** (`classify`) and **mirrored off-chain**. The vault is the authority.

<!--
Speaker notes (1:00). The tiers are the required deliverable. The point to make: the tier is not a label the agent assigns; it is computed by the contract and mirrored by the policy engine, which is how the dashboard can tell the owner exactly why something needs them.
-->

---

# The vault: what the chain guarantees

`MandateVault.execute(intent, data, agentSig)` checks, in order, with a named error for each:

`not paused` -> `agent active` -> `not expired` -> `deadline` -> `nonce` -> `signature recovers to the agent` -> `allowlist` -> `cap` -> `window` -> effects before interactions -> transfer.

Above the caps, `executeWithApproval` additionally recovers the **owner's** EIP-712 signature, checks the deadline and the co-sign ceiling, and marks the approval **consumed**.

**58 Foundry tests**, fuzz and invariants, **91% line coverage**. Unaudited.

<!--
Speaker notes (1:00). Show that the enforcement is concrete and legible: a list of ordered checks with named errors, not a hand-wave. Mention the test depth and the coverage number, and immediately say unaudited, so the credibility comes from honesty.
-->

---

# The agent: plan-then-execute

- The planner sees **only** owner messages, the mandate read from chain, the address book and tool descriptions.
- It **never** sees raw tool output. Untrusted content enters as **quarantined fields with provenance**, referenced by id.
- Decoded or translated content (Morse, Base64, homoglyphs) is **data, never an instruction**.
- The only write path is a **typed intent** through policy, simulation and the vault. There is **no raw send tool**.

ReAct feeds tool output back into the model. That is the exact mechanism behind the Grok drain. We do not do that. [Beurer-Kellner 2025] [CaMeL]

<!--
Speaker notes (1:00). Explain why the architecture of the agent matters, not just the contract. The planner cannot be hijacked by content it reads mid-task because it does not read content mid-task. Tie it back to the Grok incident: the decoded-content rule is a direct answer to the Morse-code trick.
-->

---

# Agents paying agents, with identity

- The agent buys prices from an **oracle agent** over **x402** (EIP-3009 micro-payments in USDC).
- It pays from a **petty cash float**, replenished from the vault: the imprest-account pattern. Only the float is ever at risk.
- Before paying, it runs a **Know Your Agent** check: the payee must be the counterparty's **ERC-8004 registered wallet**.
- Our agent's own ERC-8004 wallet is the **vault**, bound with the owner's ERC-1271 signature. The agent key alone cannot make that binding.

[X402-V2] [EIP-3009] [ERC-8004] [FATF-R15]

<!--
Speaker notes (0:45). This is the financial-participant scope and the innovation points. Agents paying agents is real infrastructure now; we do it with a bounded float and a counterparty identity check, so a poisoned invoice cannot redirect the payment.
-->

---

# Live demo

1. **Tier 1:** pay a contact. Watch the eight layers light up; open the explorer.
2. **Payment:** buy prices over x402 from petty cash, after the Know Your Agent check.
3. **Tier 2:** pay a new contractor above the cap; co-sign with a passkey; the contract verifies it.
4. **Kill switch:** revoke the agent; the next attempt reverts on-chain.
5. **Audit:** verify the hash chain; the tamper demo fails verification.

The demo runs offline from any LLM: a deterministic MockPlanner drives the scenarios.

<!--
Speaker notes (1:30). Either run the live demo (see docs/DEMO_SCRIPT.md) or show the screenshots with the transaction hashes. The MockPlanner means the demo cannot be sunk by a flaky API key. Keep narrating the decision trace while transactions land.
-->

---

# We measured it: the Security Lab

Fourteen documented attacks, four defence configurations. Measured, not asserted.

| Configuration | Defended, of 14 |
|---|---|
| A: no guards | **0** |
| B: prompt filters only | **4** |
| C: off-chain policy and simulation | **12** |
| D: the full product, with the vault | **14** |

The two attacks only the vault stops: a **compromised agent key** and a **kill-switch race**. Both revert **on-chain**, with real transaction hashes. The gap between 12 and 14 is the whole argument.

<!--
Speaker notes (1:00). This is the slide that proves the thesis instead of claiming it. Off-chain policy is good: it stops twelve of fourteen. But a stolen key walks straight through software. Only the on-chain vault closes the last two, and it does so with real reverts you can check on an explorer.
-->

---

# Standards mapping

Every control is tied to a named authority, resolved in docs/REFERENCES.md.

- **OWASP** LLM Top 10 (2025) and Agentic Top 10 (2026): L0, L2, the tiers, the vault.
- **NIST** AI RMF, SP 800-53 (AC-3, AC-6, AU-10), the agent-identity initiative: least agency, attributable logs.
- **MITRE ATLAS:** prompt injection, jailbreak, external harms.
- **FATF** R.15 and R.16, **OFAC** screening: fail-closed sanctions checks, an audit trail.

Standards mapping is a deliverable, not an afterthought.

<!--
Speaker notes (0:30). The judges include WeBank experts and scholars who know both AI risk and ledgers. Show that every control has a citation and that the mapping is systematic, not decorative.
-->

---

# Known risks, honestly

- The vault is **unaudited**. Tested, fuzzed, invariant-checked, but no third-party audit. **Testnet only.**
- Local owner mode holds the owner key behind a passkey; **MetaMask mode** removes it.
- The agent key lives in `.env`: this is the threat the vault **contains**, not a surprise.
- The LLM is non-deterministic; the vault is the backstop.
- The Security Lab attacker is **scripted, small N**; A to C are modelled, D is the real product.

The guarantee is **containment, not correctness**.

<!--
Speaker notes (0:45). Do not skip this slide. Stating the limits plainly is what makes the rest believable, and the honesty rule is explicit in our brief. The last line is the precise claim: we contain a compromised agent, we do not make it correct.
-->

---

# Roadmap and thanks

- An **ERC-7710** adapter, to build on the MetaMask Delegation Framework.
- An **EIP-7702** account variant, so funds never leave the owner's address.
- **TEE or MPP custody** for the keys; a **relayer** for gas.
- A **permissioned-chain variant** (for example FISCO BCOS), where the same mandate contract applies.

**Mandate:** an AI agent should hold a mandate, not a key.

Repository and docs: github.com/JohnJohnW/mandate

<!--
Speaker notes (0:30). Close by showing the work has a clear next step and is not a dead-end demo. End on the one line the whole talk has been arguing for.
-->
