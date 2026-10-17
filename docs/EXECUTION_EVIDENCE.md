# Execution evidence

Why read this: every row is a real transaction hash returned by the RPC when we ran `pnpm evidence:run`. Reverted rows are evidence too: they show the chain refusing what the agent key tried. Nothing in this file is written by hand; the script regenerates it.

| Field | Value |
|---|---|
| Chain | 31337 (Anvil (local)) |
| Vault | 0xcf773Cb96D0dC8Aa21D79c140c9Df5A2098dbf76 |
| Owner | 0x53d37b71366BEdd941382a9EBb77BCB74dbC76Fb |
| Agent | 0x87F89a384B6571990254006C78397ADc0e04553C |
| Allowlisted contact | 0x1234567890AbcdEF1234567890aBcdef12345678 |
| Non-allowlisted stranger | 0xC0FFeE00000000000000000000000000000000Cc |
| ETH mandate | per tx 0.0002, window 0.001 per 86400 s, co-sign ceiling 0.005 |
| USDC mandate | per tx 1, window 5 per 86400 s, co-sign ceiling 50 |
| Run at | 2026-10-17T14:22:39.123Z |
| Repository commit | 6303e4c |

Note: this run was against a local Anvil chain, so the hashes are not browsable on a public explorer. The same script produces the Base Sepolia table once the owner address is funded.

| Step | What | Function | Tx hash(es) | Block(s) | Outcome | What it proves |
|---|---|---|---|---|---|---|
| 1 | Vault deployment | constructor(owner) | `0x1ab24a56cb5e7425123e92dbd2107fcc381d83448755801162894aaa0a631a22` | 101 | success: MandateVault at 0xcf773Cb96D0dC8Aa21D79c140c9Df5A2098dbf76 | The enforcement contract exists on-chain with the owner as Ownable2Step owner. Source verification status is recorded in the runbook. |
| 2 | Owner sets agent, asset mandates, allowlists | setAgent, setAssetMandate, setAssetMandate, setAllowedTarget, setAllowedTarget, setAllowedSelector | `0xed86c28db01f71ef4c1ac91dc9789352a5dcee56310bdc03ee7f2433d6d773ef`<br>`0xe4ea2f9ee1104e63d02d8edc4a6d71e6095ca796d36ab45d5dfb82963c31c4dc`<br>`0xca39b5bc2b9759c5e0221e3f6332cc3f2c066be2b5b13c460d780a5a89e4d910`<br>`0x97754c3b84489870dcb4022e1e311a175a353e2386b1ae7a253af1e4e2e295f2`<br>`0x69cbe9d60fa94415c0297210365c0ea67b55e78cacae0a0fcddbaab44b01ab8b`<br>`0x777059b57f179ec2e7e28de9bebed789659bfc2feb5c9ed6a369e6ef083343b4` | 102<br>103<br>104<br>105<br>106<br>107 | success: 6 owner transactions | The mandate (expiry, per-asset caps, allowlisted targets and selectors) is on-chain state set only by the owner. |
| 3 | ERC-8004 registration and setAgentWallet | IdentityRegistry.register, setAgentWallet | (none) |  | pending: Phase 5 (identity) not yet run | The agent and the oracle agent have on-chain identities; the vault is bound as the agent's wallet. |
| 4 | Tier 1 autonomous ETH transfer to an allowlisted contact | execute | `0xecf1b4c6ff2fe3ca492db8081f899c9ea16f3727b7e46f803c48cb65434e3dcb` | 172 | success: 0.0001 ETH to 0x1234567890AbcdEF1234567890aBcdef12345678 | Inside the mandate the agent transacts alone: active agent, allowlisted target, within per-tx and window caps, nonce consumed. |
| 5 | Tier 1 WETH wrap through an allowlisted contract call | execute (CALL deposit()) | `0xcf037637af02efb1cb39b296a75aa76ca6a29f5aaec816304686b84a5cdc9400` | 176 | success: 0.0001 ETH wrapped at 0x990047DB5848d0Bfaf4597D3e148Ce05Fa295144 | Contract calls are restricted to allowlisted (target, selector) pairs and the calldata hash is bound into the signed intent. |
| 6a | Petty cash top-up from the vault to the agent EOA | execute (TOPUP_PETTY_CASH) | `0x904af47a229bc6ce431202aaa8f360a229a223633d73eaced9d77fc85c8a0c83` | 180 | success: 0.5 USDC to the agent | The imprest float: a small, capped USDC balance the agent can spend on x402 invoices, replenished only from the vault and only to itself. |
| 6b | x402 USDC payment to the oracle agent | EIP-3009 transferWithAuthorization via facilitator | (none) |  | pending: Phase 5 (payments) not yet run | Machine-to-machine payment settled on-chain from the petty cash float. |
| 7 | Over-cap attempt by the agent key, directly against the vault | execute | `0xc96df33f19b6a8b4a300f4f81349c3f81b8e920d23e4bb16cfafc96c07dd92fe` | 184 | reverted: AbovePerTxCap(200000000000001, 200000000000000) | The per-transaction cap is enforced by the chain, not by the agent software. A compromised agent key cannot exceed it. |
| 8 | Transfer to a non-allowlisted target | execute | `0x9496b98dc922607adcaf7bae9b573cbca0fd9807f4e844ee3187d2646c1bbe3b` | 188 | reverted: TargetNotAllowed(0xC0FFeE00000000000000000000000000000000Cc) | Counterparties outside the allowlist need an owner co-signature; without one the chain reverts. |
| 9 | Tier 2 co-signed transfer: owner EIP-712 approval verified on-chain | executeWithApproval | `0x7b4c374fb7fc4a690272d588bf436468f1269c519dddb3944b75b17edf3a8a3d` | 208 | success: 0.0012 ETH to 0xC0FFeE00000000000000000000000000000000Cc with owner approval 0xdc1f47db... | Above the autonomous caps or outside the allowlist, the contract itself checks the owner's signature over this exact intent hash and deadline. |
| 10 | Replay of the same owner approval on a new intent | executeWithApproval | `0x3c211eff6ef181243db4bc8f64aa51fd0e8be0c3795943e8a2e0bcc2e1cd9379` | 212 | reverted: BadOwnerSignature() | An approval is bound to one intent hash; the nonce makes every intent hash unique, so a captured approval cannot be reused. |
| 11 | Window cap exhaustion through repeated sub-cap transfers | execute x4 | `0xd87486b0d07842013b2b8a9765f66c91552198eb0df21cb7950de4a403345c19`<br>`0x33dae94c87d181837b3657441b41d9f52bbcec7517ceb2ae81760307f58ba555`<br>`0xb67d7174121c2497a1315b1f724e84bf6544f96823e672dc3b5df3b044ce0f9f`<br>`0x37404249fab0c9e87e7d609fdb97d829fd5cc750f1005a6823e0dca4fac732b1` | 192<br>196<br>200<br>204 | reverted: 3 succeeded, then AboveWindowCap(1000000000000000, 200000000000000, 1000000000000000) | The daily window is a blast-radius bound: many small transfers cannot add up to more than the owner allowed. |
| 12 | Kill switch: revokeAgent then any agent call reverts; pause likewise | revokeAgent, execute, setAgent, pause, execute, unpause | `0x9ef0672e7ac59b61392c87c6d18c05432dee3139d3bf2dc09dd1b3b2e00298a8`<br>`0x1e7d4eb1e2e8df00c6f5978578c09f1978b2ab02548f0c5fb16eaca24d90e10b`<br>`0xd540ebd572a781868686a5a96eefa82a5a5e998342ef7c3955a74d4912b2265c`<br>`0xbaa03ac21490e941986dcfd58bba9752caa9f32d9646a0f8cd4ad9863e5a9257`<br>`0xbd87f7a44144d2ee8af9cca224880d60d8a5ae26327639b74cbd3e75f3acf786`<br>`0xb99988d6512071cbb9798c4249b7d06451fee9ebc3766d02559b7c8391bf2e33` | 220<br>224<br>228<br>232<br>236<br>240 | reverted: after revoke: AgentNotActive(); after pause: EnforcedPause() | One owner transaction ends the agent's authority. In-flight and future agent transactions revert on-chain. |
| 13 | EIP-7702 delegation and one execution through MandateAccount7702 | type-4 transaction | (none) |  | pending: P2 stretch goal not reached |  |
| T3 | Tier 3: unlimited token approval, even with an owner approval | executeWithApproval (APPROVE_ERC20 max) | `0x67e04e9c892dca27524b690e9a267a210a3c97be2c660b89e35bc1e7b76eecda` | 216 | reverted: UnlimitedApproval() | Some actions have no code path at all. No signature lifts a Tier 3 restriction. |

Summary: 6 rows succeeded, 6 rows reverted as intended, 3 pending later phases, 0 skipped.

Raw log: `packages/contracts/evidence/` (JSON, one file per run).

Citations: [EIP-712] for the signed intent and approval structures, [MM-SEC-AUG26] for the principle that agent authority should be scoped, time-bounded and enforced on-chain. See docs/REFERENCES.md.
