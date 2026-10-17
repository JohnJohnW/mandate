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
| Run at | 2026-10-17T15:43:22.816Z |
| Repository commit | b8bf18f |

Note: this run was against a local Anvil chain, so the hashes are not browsable on a public explorer. The same script produces the Base Sepolia table once the owner address is funded.

| Step | What | Function | Tx hash(es) | Block(s) | Outcome | What it proves |
|---|---|---|---|---|---|---|
| 1 | Vault deployment | constructor(owner) | `0x4d4f52bd29bdfeb0dbb75d0588cd38965afe3fcc874e2359283ac92b001dbdee` | 19 | success: MandateVault at 0x1e7f646b1447d4C6A2393FABa52A9bBf07de017f | The enforcement contract exists on-chain with the owner as Ownable2Step owner. Source verification status is recorded in the runbook. |
| 2 | Owner sets agent, asset mandates, allowlists | setAgent, setAssetMandate, setAssetMandate, setAllowedTarget, setAllowedTarget, setAllowedSelector | `0x791f1058e1e1358074a6f86491238a305dc778266a6424556cc21a50b7e19f1a`<br>`0x4f60d074b8d0a7bc34b2d26ffa79fdfdc93242d4d0a81b32930d6aba1b3e1184`<br>`0x2525fc4814059d13f677d9a45479793c55d04248029677e955be4d24d80a39a9`<br>`0x2b43d44c7b87998106943c55d180f676a7419eb01869f918cfecb74930e5f048`<br>`0x2eda61f774caa9625461e7aad4dcd28f0e59f074ae89e9edeb1a89452f0269b2`<br>`0x8ff66b5ed5e60a3fe1e9c180594ad847f0d191cc92f84f1b101e4dc9f2356709` | 20<br>21<br>22<br>23<br>24<br>25 | success: 6 owner transactions | The mandate (expiry, per-asset caps, allowlisted targets and selectors) is on-chain state set only by the owner. |
| 3 | ERC-8004 registration of both agents and setAgentWallet to the vault | register(agentURI) x2, setAgentWallet(agentId, vault, deadline, ownerSig) | `0x8eae3afc3cd58282df74e771b2c92ca7b9c49756a5c4eef424361ace548db020`<br>`0xb54c23ae68a01ee8d4296ddda50cdd2b197a349ae109300530f41eca06dfc1fd`<br>`0xc2b884fb05b29cfaa3b37abef5b962e6ecd3ce579916fa377c35a5fb9911db93` | 32<br>36<br>41 | success: our agent #0, oracle agent #1 in registry 0x990047DB5848d0Bfaf4597D3e148Ce05Fa295144; vault bound as agent wallet | Both agents carry a portable on-chain identity. The vault is the registered wallet of our agent, bound with the owner's ERC-1271 signature; the agent key alone cannot make that binding. |
| 4 | Tier 1 autonomous ETH transfer to an allowlisted contact | execute | `0x1f449524a70b57ae6b0415c29a30047b3c7a7aa7c5bf2910f54e3bb40d4c67c6` | 193 | success: 0.0001 ETH to 0x1234567890AbcdEF1234567890aBcdef12345678 | Inside the mandate the agent transacts alone: active agent, allowlisted target, within per-tx and window caps, nonce consumed. |
| 5 | Tier 1 WETH wrap through an allowlisted contract call | execute (CALL deposit()) | `0xded564975b597d65dd83dd2b776751919a98a588ce5c2875379396c77a1314d7` | 197 | success: 0.0001 ETH wrapped at 0xcf773Cb96D0dC8Aa21D79c140c9Df5A2098dbf76 | Contract calls are restricted to allowlisted (target, selector) pairs and the calldata hash is bound into the signed intent. |
| 6a | Petty cash top-up from the vault to the agent EOA | execute (TOPUP_PETTY_CASH) | `0x26f9c384bfe5b737c6121c3c57b24d18cd046b9c42ea9717be4b3f0bd9b4e599` | 201 | success: 0.5 USDC to the agent | The imprest float: a small, capped USDC balance the agent can spend on x402 invoices, replenished only from the vault and only to itself. |
| 6b | x402 USDC payment to the oracle agent from petty cash | USDC.transferWithAuthorization via the facilitator | `0xfc681e1950c9a41594ab56a65a86d7fc0efa2fa65640602750eb52ac266e8e85` | 205 | success: 0.001 USDC paid by 0x87F89a384B6571990254006C78397ADc0e04553C; HTTP 200 | An agent paying another agent per request: the EIP-3009 authorization is signed by the agent's petty cash account and settled on-chain by the facilitator. The vault is never involved in the payment itself. |
| 7 | Over-cap attempt by the agent key, directly against the vault | execute | `0x11595e084b87c7c30800c8fe8305b2aa1193f4528a3feb46f34f3d166b08849d` | 209 | reverted: AbovePerTxCap(200000000000001, 200000000000000) | The per-transaction cap is enforced by the chain, not by the agent software. A compromised agent key cannot exceed it. |
| 8 | Transfer to a non-allowlisted target | execute | `0x13ff738f069d60a50b5a6ad754585858c5ec5da64114c3237fcdb234d915cf77` | 213 | reverted: TargetNotAllowed(0xC0FFeE00000000000000000000000000000000Cc) | Counterparties outside the allowlist need an owner co-signature; without one the chain reverts. |
| 9 | Tier 2 co-signed transfer: owner EIP-712 approval verified on-chain | executeWithApproval | `0x4d79cba267f7eef48b85ca29511ea1054637b53c050025e6d292f1c6c43aa44c` | 237 | success: 0.0012 ETH to 0xC0FFeE00000000000000000000000000000000Cc with owner approval 0x95fa49a7... | Above the autonomous caps or outside the allowlist, the contract itself checks the owner's signature over this exact intent hash and deadline. |
| 10 | Replay of the same owner approval on a new intent | executeWithApproval | `0x1b81aef08901b89bc1ecdb4da5f1b7187027b07f5f43e8eb85aaa0d86ff77133` | 241 | reverted: BadOwnerSignature() | An approval is bound to one intent hash; the nonce makes every intent hash unique, so a captured approval cannot be reused. |
| 11 | Window cap exhaustion through repeated sub-cap transfers | execute x5 | `0x6aa2ce62130f529529208f89873d554f56568a7d2787fe583721c4a51ca9a15c`<br>`0x7e569212fae7433aa086d2aaff2fb0dc03b491cf42ca6b9f2806e77a8758a857`<br>`0xc09b60f0ba4961f7419b9f0f98a780e8462f5607214aa036c3858e03fb39fad9`<br>`0x329cf6fb78be8149bae58dbf80b8719b20f2f08a0930dffd22d82ffe7d36456e`<br>`0x1fea5e531f4ad54a5f22cb409ba5fef6c383590fb6de23e42e39f72d16403bfa` | 217<br>221<br>225<br>229<br>233 | reverted: 4 succeeded, then AboveWindowCap(1000000000000000, 200000000000000, 1000000000000000) | The daily window is a blast-radius bound: many small transfers cannot add up to more than the owner allowed. |
| 12 | Kill switch: revokeAgent then any agent call reverts; pause likewise | revokeAgent, execute, setAgent, pause, execute, unpause | `0x8fb3369a2ac900700c5c99238b0fb32e7d719889238582cc082f5210e2de9d39`<br>`0x34a373dd6eb6b757f18c2586b31d7e065a6ce40c291b18653c6f463cfc235d49`<br>`0x42ffaa4b59d30eebad7bb00d6583b366c480995694fea3c969f50fae87603ca7`<br>`0x1f578f4e25fdc3d2bbbbd3b381f0ab658a75e346ac8f7e034a835a6400b685ab`<br>`0x1c52f37a1e6682b78f1c1e22b1480ff9aa81a788fc30b56629935705e0697af9`<br>`0x70265d99be5cae1b035120efff0169f99ed8a2a092cde8af09083864b99fb225` | 249<br>253<br>257<br>261<br>265<br>269 | reverted: after revoke: AgentNotActive(); after pause: EnforcedPause() | One owner transaction ends the agent's authority. In-flight and future agent transactions revert on-chain. |
| 13 | EIP-7702 delegation and one execution through MandateAccount7702 | type-4 transaction | (none) |  | pending: P2 stretch goal not reached |  |
| T3 | Tier 3: unlimited token approval, even with an owner approval | executeWithApproval (APPROVE_ERC20 max) | `0xc30abc941a03a564d1dd465fed35fbfe536c92e8a32492a68960653f2746662e` | 245 | reverted: UnlimitedApproval() | Some actions have no code path at all. No signature lifts a Tier 3 restriction. |

Summary: 8 rows succeeded, 6 rows reverted as intended, 1 pending later phases, 0 skipped.

Raw log: `packages/contracts/evidence/` (JSON, one file per run).

Citations: [EIP-712] for the signed intent and approval structures, [MM-SEC-AUG26] for the principle that agent authority should be scoped, time-bounded and enforced on-chain. See docs/REFERENCES.md.
