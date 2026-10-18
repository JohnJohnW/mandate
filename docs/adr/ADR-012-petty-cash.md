# ADR-012 A petty-cash float for x402 payments

## Context
x402 payments settle with an EIP-3009 `transferWithAuthorization` signed by the paying account. If the vault itself were the payer, the vault would need to sign EIP-3009 authorizations, which a minimal vault should not do, and every micro-payment would be a vault transaction.

## Decision
Give the agent's own account a small USDC float (the petty cash), replenished from the vault by a `TOPUP_PETTY_CASH` intent whose target must be the agent and which is bounded by the USDC caps. The agent signs x402 authorizations from this float.

## Alternatives considered
- The vault pays directly: requires EIP-3009 support in the vault and makes every micro-payment a vault call.
- A standing approval to a payment contract: a larger standing authorisation than micro-payments need.

## Consequences
This is the imprest-account pattern from treasury practice: a fixed small float, replenished against spending, which limits the blast radius of the account that actually signs. Only the float is at risk if the agent account is compromised, and the top-up itself passes the full policy and vault checks. The float level and top-up amount are owner settings; the x402 petty cash policy caps each payment and the daily total.
