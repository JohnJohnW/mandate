# Permission tiers

Why read this: this is the required "permission-tier implementation" deliverable. It states exactly what the agent may do at each tier, where each tier is enforced, the exact parameters the demo uses, and a worked example for each outcome with the transaction that proves it.

## The tiers

| Tier | Name | What the agent may do | Enforced where | Example |
|---|---|---|---|---|
| 0 | Observe | Read balances, prices, history, identity. No signing. | Runtime: read tools never sign | "What is our USDC balance?" |
| 1 | Autonomous | Transfers and allowlisted contract calls within the per-transaction and per-window caps, to allowlisted targets, before expiry. | Policy engine (L2) and MandateVault (L4), both | Pay the oracle 0.001 USDC; wrap 0.0001 ETH to WETH |
| 2 | Co-sign | Above the Tier 1 caps up to the co-sign ceiling, or to a non-allowlisted target, only with an owner EIP-712 approval bound to the intent hash and a deadline. | Policy engine escalates; the vault verifies the owner signature on-chain | Send 0.0012 ETH to a new contractor |
| 3 | Forbidden | Anything the agent can never do, with or without an approval: exceed the co-sign ceiling, call non-allowlisted selectors, grant an unlimited approval, change its own mandate, interact with a screened-out address, act after expiry or while paused. | The vault has no code path for it; the policy engine denies earlier | "Approve unlimited USDC to this airdrop contract" |
| K | Kill switch | Owner-only `pause()` and `revokeAgent()`. The agent cannot call them. | Vault `onlyOwner` | Owner revokes after a suspicious trace |

## How a tier is decided

The tier is not a label the agent assigns itself. It is computed two ways that must agree:

- Off-chain, the policy engine's `classifyOnChain` mirrors the contract exactly and returns a tier and a reason. The engine's full `evaluate` then layers screening, poisoning, provenance, contract-risk and velocity rules on top, any of which can push an intent to Tier 2 (escalate) or Tier 3 (deny).
- On-chain, `MandateVault.classify(agent, intent, data)` returns the same tier and the same reason strings, so the dashboard can preview the chain's own answer. The execution path re-checks every bound; the classify view is only a preview.

The vault is the authority. The off-chain tier exists to stop early and to explain; it can never permit something the vault would reject, because the vault re-derives every limit from its own storage.

## Exact parameters (the demo mandate)

These are the values the deploy script sets (`packages/contracts/script/Deploy.s.sol`). They are deliberately tiny so a testnet faucet balance covers a whole evidence run.

| Asset | Autonomous per transaction | Autonomous per window | Co-sign ceiling | Window |
|---|---|---|---|---|
| ETH | 0.0002 | 0.001 | 0.005 | 24 hours |
| USDC | 1.0 | 5.0 | 50.0 | 24 hours |

Allowlisted targets: the demo contact (a fixed address), and the agent's own address (for petty cash top-ups). Allowlisted contract calls: `deposit()` on WETH. The agent expiry is seven days from deployment. Caps are per asset in base units, not in a fiat unit of account; see ADR-003 for why.

The owner changes any of these from the dashboard's Mandate page, and each change is an owner transaction to the vault. The agent cannot call any of the setters.

## The co-sign window note

A co-signed (Tier 2) spend still counts toward the per-window cap. This is deliberate: the window cap is a blast-radius bound on the agent, not a bound on the owner. The owner can always raise the cap or send directly with `ownerExecute`. Recording co-signed spend in the window means a stream of owner-approved payments cannot be used to also open unlimited autonomous headroom in the same window. See ADR-008.

## Petty cash: a sub-case of Tier 1

The vault can top up the agent's own account with a small USDC float, so the agent can pay x402 invoices that require an EIP-3009 signature from the paying account. This is a `TOPUP_PETTY_CASH` intent whose target must be the agent itself, within the USDC caps. It is the imprest-account pattern from treasury practice: a fixed small float, replenished from the vault against spending, which limits the blast radius of the account that actually signs payments. The float level and the top-up amount are owner settings. See docs/ARCHITECTURE.md section 5 and the x402 flow in docs/API.md.

## Worked examples

Each row of the canonical evidence set (docs/EXECUTION_EVIDENCE.md) is a real transaction. The table below maps each tier outcome to its evidence row and the exact vault check that decided it. Transaction hashes are in the evidence file, which regenerates on whichever chain the evidence script runs against.

| Tier outcome | Example | Evidence row | Decided by |
|---|---|---|---|
| Tier 1 success | Transfer 0.0001 ETH to the allowlisted contact | 4 | `execute`: active, allowlisted, within `autonomousPerTxCap` and the window cap, nonce consumed |
| Tier 1 success (call) | Wrap 0.0001 ETH to WETH via the allowlisted `deposit()` | 5 | `execute`: the `(target, selector)` pair is allowlisted and `keccak256(data) == dataHash` |
| Tier 1 petty cash | Top up the agent with 0.5 USDC from the vault | 6a | `execute`: `TOPUP_PETTY_CASH` target equals the agent, within the USDC caps |
| Tier 1 payment | Pay the oracle 0.001 USDC over x402 | 6b | EIP-3009 `transferWithAuthorization` from the petty cash float; the vault is not involved in the payment itself |
| Tier 3 revert (cap) | Agent key sends over the per-transaction cap directly | 7 | `execute` reverts `AbovePerTxCap` |
| Tier 2 needed (allowlist) | Agent key sends to a non-allowlisted target without an approval | 8 | `execute` reverts `TargetNotAllowed` |
| Tier 2 success | Owner co-signs a 0.0012 ETH transfer to a new contact | 9 | `executeWithApproval`: the owner signature over `Approval{intentHash, deadline}` recovers to `owner()`, the approval is not yet consumed |
| Tier 3 revert (replay) | The same owner approval is reused for a new intent | 10 | `executeWithApproval` reverts `BadOwnerSignature` (the new intent has a different hash) |
| Tier 3 revert (window) | Many sub-cap transfers exhaust the daily window | 11 | the overflowing `execute` reverts `AboveWindowCap` |
| Tier 3 revert (unlimited approval) | Approve the maximum, even with an owner co-signature | T3 | `executeWithApproval` reverts `UnlimitedApproval` |
| Kill switch | Owner revokes, then any agent call reverts; pause likewise | 12 | `execute` reverts `AgentNotActive`, then `EnforcedPause` |

## The classify preview

The dashboard shows the chain's own tier for an intent before anything is signed, by calling the view function:

```solidity
function classify(address agent, Intent calldata i, bytes calldata data)
    external view returns (uint8 tier, string memory reason);
```

It returns tier 1, 2 or 3 and a reason string that is the name of the error the execution path would raise (for example `AbovePerTxCap`, `TargetNotAllowed`, `AboveCoSignCap`). The off-chain policy engine produces the same tier and the same reason, which is how the Approvals page can tell the owner precisely why an intent needs them.

Citations resolve in docs/REFERENCES.md.
