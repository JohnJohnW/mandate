# Execution evidence

Why read this: every row is a real transaction hash returned by the RPC when we ran `pnpm evidence:run`. Reverted rows are evidence too: they show the chain refusing what the agent key tried. Nothing in this file is written by hand; the script regenerates it.

| Field | Value |
|---|---|
| Chain | 31337 (Anvil (local)) |
| Vault | 0x1e7f646b1447d4C6A2393FABa52A9bBf07de017f |
| Owner | 0x53d37b71366BEdd941382a9EBb77BCB74dbC76Fb |
| Agent | 0x87F89a384B6571990254006C78397ADc0e04553C |
| Allowlisted contact | 0x1234567890AbcdEF1234567890aBcdef12345678 |
| Non-allowlisted stranger | 0xC0FFeE00000000000000000000000000000000Cc |
| ETH mandate | per tx 0.0002, window 0.001 per 86400 s, co-sign ceiling 0.005 |
| USDC mandate | per tx 1, window 5 per 86400 s, co-sign ceiling 50 |
| Run at | 2026-10-18T02:55:54.242Z |
| Repository commit | 14c796d |

Note: this run was against a local Anvil chain, so the hashes are not browsable on a public explorer. The same script produces the Base Sepolia table once the owner address is funded.

| Step | What | Function | Tx hash(es) | Block(s) | Outcome | What it proves |
|---|---|---|---|---|---|---|
| 1 | Vault deployment | constructor(owner) | `0xe1d2817d96127008ef3dfda31425c3150f545fed1b7b1c19db7bfdb8d13c8f27` | 20 | success: MandateVault at 0x1e7f646b1447d4C6A2393FABa52A9bBf07de017f | The enforcement contract exists on-chain with the owner as Ownable2Step owner. Source verification status is recorded in the runbook. |
| 2 | Owner sets agent, asset mandates, allowlists | setAgent, setAssetMandate, setAssetMandate, setAllowedTarget, setAllowedTarget, setAllowedSelector | `0x36ce1b3110d86cc8d3104fe77c07d992ae76c52b2ea20aed8b0866e606f4b674`<br>`0x7cb927294aa7aa9b287220d938f9066a390c5f79d792851ca64fc827d69f52b4`<br>`0x88204cf2d5f26bef1b53eabbc337aa07481a7b2fcd242cdffabd9b2b58f599c5`<br>`0x668d787a2d705600aae12643d4843115c194b2d391793daba46a782283781330`<br>`0x118cd103ff2e58ba9a2ca648bd1f86505788cf6ce932f27e5391b04ec4d4f9ce`<br>`0xa96bf0d9c5b2bf133f56ea591ccc8cb29710e63dde4e8cb03dbd38a985746d37` | 21<br>22<br>23<br>24<br>25<br>26 | success: 6 owner transactions | The mandate (expiry, per-asset caps, allowlisted targets and selectors) is on-chain state set only by the owner. |
| 3 | ERC-8004 registration of both agents and setAgentWallet to the vault | register(agentURI) x2, setAgentWallet(agentId, vault, deadline, ownerSig) | `0x2fd7bc8b7a420bc127ae5a3cd866361fd0af5cd335ea6d634d77c1f7727bd5b8`<br>`0xb54a9a263e084f00efeb98ddeee7676b69a32f58ae1d7f9154b7e8aa15e916a7`<br>`0x1feb7e8cef18700f4b47ea67571098ef25c2d4a00ff8cceb980d1bd0f7975269` | 33<br>38<br>42 | success: our agent #0, oracle agent #1 in registry 0x990047DB5848d0Bfaf4597D3e148Ce05Fa295144; vault bound as agent wallet | Both agents carry a portable on-chain identity. The vault is the registered wallet of our agent, bound with the owner's ERC-1271 signature; the agent key alone cannot make that binding. |
| 4 | Tier 1 autonomous ETH transfer to an allowlisted contact | execute | `0xf37e3f7af4f5575543eb663e510017838d97291eabf14aeebce6dbd6723d66b9` | 63 | success: 0.0001 ETH to 0x1234567890AbcdEF1234567890aBcdef12345678 | Inside the mandate the agent transacts alone: active agent, allowlisted target, within per-tx and window caps, nonce consumed. |
| 5 | Tier 1 WETH wrap through an allowlisted contract call | execute (CALL deposit()) | `0x0c31f63c4a19203e4f0408910140c1437b1b6e31ab9d5c4a2a56a23460d64862` | 67 | success: 0.0001 ETH wrapped at 0xcf773Cb96D0dC8Aa21D79c140c9Df5A2098dbf76 | Contract calls are restricted to allowlisted (target, selector) pairs and the calldata hash is bound into the signed intent. |
| 6a | Petty cash top-up from the vault to the agent EOA | execute (TOPUP_PETTY_CASH) | `0x05f863129fe068ab79bbc5fb536b959102110b74fe971a4c6ab44c8251abfd11` | 71 | success: 0.5 USDC to the agent | The imprest float: a small, capped USDC balance the agent can spend on x402 invoices, replenished only from the vault and only to itself. |
| 6b | x402 USDC payment to the oracle agent from petty cash | USDC.transferWithAuthorization via the facilitator | `0x1b88dc02e4774756fd1f7cbaf0cb92e84a47f90022baafd2e8150160b30ac0c6` | 75 | success: 0.001 USDC paid by 0x87F89a384B6571990254006C78397ADc0e04553C; HTTP 200 | An agent paying another agent per request: the EIP-3009 authorization is signed by the agent's petty cash account and settled on-chain by the facilitator. The vault is never involved in the payment itself. |
| 7 | Over-cap attempt by the agent key, directly against the vault | execute | `0x8fa0227be97ebcb97e5ae582d4a712acc3f81b2ef80c6873e6b8524fefdf350d` | 79 | reverted: AbovePerTxCap(200000000000001, 200000000000000) | The per-transaction cap is enforced by the chain, not by the agent software. A compromised agent key cannot exceed it. |
| 8 | Transfer to a non-allowlisted target | execute | `0x92873af4def0e58697bbd091eadd7e69d1aea0be9a2529d492e6514a2f172b3a` | 83 | reverted: TargetNotAllowed(0xC0FFeE00000000000000000000000000000000Cc) | Counterparties outside the allowlist need an owner co-signature; without one the chain reverts. |
| 9 | Tier 2 co-signed transfer: owner EIP-712 approval verified on-chain | executeWithApproval | `0x61a86e6cdc8720a92ba1900b909219d1039599f28fbdd3a18fe00b86d6653199` | 107 | success: 0.0012 ETH to 0xC0FFeE00000000000000000000000000000000Cc with owner approval 0x853e6a3f... | Above the autonomous caps or outside the allowlist, the contract itself checks the owner's signature over this exact intent hash and deadline. |
| 10 | Replay of the same owner approval on a new intent | executeWithApproval | `0x2bc283b76ea16011736c4af842f7bdb3c8f82e1218dac62e5c379ddf071b288a` | 111 | reverted: BadOwnerSignature() | An approval is bound to one intent hash; the nonce makes every intent hash unique, so a captured approval cannot be reused. |
| 11 | Window cap exhaustion through repeated sub-cap transfers | execute x5 | `0x2728c7df1065f5c4e9a4f70fa3126da43680b5b83ae23966e6674ffbdb4ed2f3`<br>`0x6bf03b73c5a64c6be3177b9fb53b8f18fe84d38655a704e789bf5b5ed0816b0c`<br>`0x27f78cfe507fd3a8f3feb38c3a1e079d818475aae00441c5489c89235efd3514`<br>`0x6d2927411185de057afd71aad47d448683247944bd44e0a8b098340595dcde2a`<br>`0x0ee9d3a1787558690de95615d21c28f56b1617223a791309364e830aaac6968d` | 87<br>91<br>95<br>99<br>103 | reverted: 4 succeeded, then AboveWindowCap(1000000000000000, 200000000000000, 1000000000000000) | The daily window is a blast-radius bound: many small transfers cannot add up to more than the owner allowed. |
| 12 | Kill switch: revokeAgent then any agent call reverts; pause likewise | revokeAgent, execute, setAgent, pause, execute, unpause | `0xdcda52e0655f2fa23ff8e45ca17736aa9eb168670677f0201609ee2974ebf72f`<br>`0x4c72f05b8a1e0b4d3e50463714da8dd770a27b80e60c21f695fb0f268c0a2e96`<br>`0xd2c8168898541ce9681d68755f872e3b5d602af0d3220c4aa4be10715599f04f`<br>`0x5f17b7ad06aac7b9baacc3c8384860b4d11d67654204aa2e7165b7c68dbe35ad`<br>`0x639b02c8f0a110c54ad62d1873864113f28a51658c0e031d11409d1d97cd03b1`<br>`0xf30c5c1869b07399f97473060570f30fe58e1476bb24e0bc949d5b1f52c96c4a` | 119<br>123<br>127<br>131<br>135<br>139 | reverted: after revoke: AgentNotActive(); after pause: EnforcedPause() | One owner transaction ends the agent's authority. In-flight and future agent transactions revert on-chain. |
| 13 | EIP-7702 delegation and one execution through MandateAccount7702 | type-4 transaction | (none) |  | pending: P2 stretch goal not reached |  |
| T3 | Tier 3: unlimited token approval, even with an owner approval | executeWithApproval (APPROVE_ERC20 max) | `0x5259cf73351d2ab3791f5d5f6bbec09aab79b76f160328778507adbad1f13cb3` | 115 | reverted: UnlimitedApproval() | Some actions have no code path at all. No signature lifts a Tier 3 restriction. |

Summary: 8 rows succeeded, 6 rows reverted as intended, 1 pending later phases, 0 skipped.

Raw log: `packages/contracts/evidence/` (JSON, one file per run).

Citations: [EIP-712] for the signed intent and approval structures, [MM-SEC-AUG26] for the principle that agent authority should be scoped, time-bounded and enforced on-chain. See docs/REFERENCES.md.
