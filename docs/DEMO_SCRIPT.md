# Demo script

Why read this: it is the script for the optional five-minute demo video and the talk track for the ten-minute presentation. It is written so a team member can record a reliable run. The demo works offline from any LLM: the MockPlanner drives the scripted scenarios, so a flaky API key cannot sink the video.

## Before you record

- Start the local stack (docs/RUNBOOK.md, "Run on a local chain"). Use `OWNER_APPROVAL_AUTH=dev` so the owner session is one click.
- Confirm the Overview page shows the agent active and the caps loaded.
- Add the contact `alice` if it is not there.
- Have the Agent, Approvals, Mandate, Security Lab and Identity tabs ready.

## Five-minute video script

Timings are targets. Each beat has a line to say and an action to take.

### 0:00 to 0:30, the problem

Say: "In May 2026 an attacker drained about 150,000 dollars from a Grok-linked agent wallet. They hid the transfer instruction in Morse code and escalated the agent's permissions with an NFT. NIST found indirect prompt injection succeeds about 81 percent of the time against agents. Prompting alone does not hold."

Action: show the title slide, then the Overview page.

### 0:30 to 1:00, the thesis

Say: "Mandate's answer is that an AI agent should hold a mandate, not a key. The owner grants a scoped, time-bound mandate that a smart contract enforces. The agent acts alone inside it, needs a human co-signature above it, and is reverted by the chain outside it. Even a fully compromised agent cannot move value outside the mandate."

Action: point at the mandate gauges and the caps on the Overview page.

### 1:00 to 1:45, Tier 1 autonomous

Say: "Inside the mandate the agent acts alone. I ask it to pay a contact a small amount."

Action: on the Agent page, send `pay alice 0.0001 ETH`. Point at the live decision trace: L0 context isolation, L1 the signed intent, L2 the policy verdict, L3 the simulation, L4 the on-chain execution. Click the explorer link.

Say: "Eight defence layers lit up. The transfer executed on-chain, inside the cap, to an allowlisted contact."

### 1:45 to 2:30, machine-to-machine payment

Say: "The agent can pay other agents. I ask it for prices, which it buys from an oracle agent over x402."

Action: send `what are the prices?`. Point at the Identity page's payment row: the Know Your Agent check, the petty cash top-up, the settled USDC transfer.

Say: "Before paying, it checked the oracle's ERC-8004 identity and that the payee is the registered wallet. It paid from a small petty cash float, which topped up from the vault first."

### 2:30 to 3:15, Tier 2 co-sign

Say: "Above the mandate, the agent needs me. I ask it to pay a new contractor more than the autonomous cap."

Action: send `send 0.0012 ETH to 0xC0FFeE00000000000000000000000000000000Cc`. Go to the Approvals page. Show the risk flags and the intent hash. Approve.

Say: "The agent escalated. I co-signed with a passkey. The contract itself verified my signature, bound to this exact intent. It executed."

### 3:15 to 4:15, the attack and the guarantee

Say: "Does this actually hold? The Security Lab replays fourteen documented attacks against four defence configurations."

Action: on the Security Lab page, press Run. Let the matrix fill.

Say: "With no guards, every attack moves the funds. With prompt filters, most still do. With the off-chain policy engine, twelve of fourteen are stopped, but a compromised key still drains the wallet. Only the full product, with the on-chain vault, stops all fourteen. Watch the last two: a stolen agent key and a kill-switch race. Both revert on-chain, with real transaction hashes."

Action: point at the ATK-13 and ATK-14 cells in config D with their tx links.

### 4:15 to 5:00, the kill switch

Say: "And the owner always holds the kill switch."

Action: on the Mandate page, press Revoke agent. Return to the Agent page and send `pay alice 0.0001 ETH`.

Say: "One transaction ends the agent's authority. The next attempt reverts on-chain, AgentNotActive. The chain is the backstop. That is the whole idea: the agent holds a mandate, not a key."

Action: show the Audit page, press Verify chain, then the tamper demo. Close on the title slide.

### Fallbacks

- If an RPC call is slow, the trace still streams; narrate the layers while it lands.
- If the live LLM is set and misbehaves, set `PLANNER=mock` and restart the API; the scripted commands above all work on the MockPlanner.
- If x402 settlement is slow on the public facilitator, use the local chain for the video; the flow is identical.

## Ten-minute presentation talk track

The deck (submission/deck) has twelve to fourteen slides with speaker notes and timings. The arc:

1. Title and team (0:30).
2. The problem: one incident (Grok/Bankr) and one number (NIST 81 percent) (1:00).
3. The thesis: a mandate, not a key (1:00).
4. Architecture: the seven defence layers, and the claim that L4 does not trust L0 to L3 (1:30).
5. Permission tiers: the table, and that the vault is the authority (1:00).
6. The vault: what the chain guarantees, with the named errors (1:00).
7. The agent: plan-then-execute and quarantine, why ReAct is the vulnerability (1:00).
8. Payments and identity: x402 petty cash and ERC-8004 Know Your Agent (0:45).
9. Live demo or screenshots with transaction hashes (1:30).
10. The evaluation matrix: 0, 4, 12, 14 defended across the four configurations (1:00).
11. Standards mapping: OWASP, NIST, MITRE ATLAS, FATF (0:30).
12. Known risks and limitations: unaudited, testnet, the residual risks (0:45).
13. Roadmap: the 7702 account, the ERC-7710 adapter, TEE custody, the permissioned-chain variant (0:30).
14. Thanks and links (0:15).

Keep to the honest line throughout: the vault is unaudited and testnet-only, the attacker is scripted with a small sample, and the guarantee is containment, not correctness.
