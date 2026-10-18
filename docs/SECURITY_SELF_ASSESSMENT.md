# Security self-assessment

Why read this: it is the required security self-assessment deliverable. It summarises the permission-tier implementation, maps every control to a layer, an authority and its test evidence, states how keys are managed, records the contract test coverage, and lists every known risk with a severity and a status. It is honest about what is not done.

Status in one line: this is a testnet research prototype. The vault contract is unaudited. Do not use it with real funds.

## 1. Permission-tier implementation summary

The four tiers (plus the kill switch) are implemented in two places that must agree: the off-chain policy engine (`packages/core`) and the on-chain vault (`packages/contracts`). The vault is the authority. See docs/PERMISSION_TIERS.md for the full table and worked examples.

- Tier 0 (observe) is enforced by the runtime: read tools never sign, and there is no raw send tool.
- Tier 1 (autonomous) is enforced by the policy engine and by the vault's `execute`, which checks active, not expired, nonce, allowlist, per-transaction cap and window cap.
- Tier 2 (co-sign) is enforced by the vault's `executeWithApproval`, which recovers the owner's EIP-712 signature over `Approval{intentHash, deadline}`, checks the deadline and the co-sign ceiling, and marks the approval consumed.
- Tier 3 (forbidden) has no code path in the vault: unlimited approvals revert, amounts above the co-sign ceiling revert, non-allowlisted selectors revert, and the setters are `onlyOwner`.
- Kill switch: `pause()` and `revokeAgent()` are `onlyOwner`; any agent call after them reverts.

The off-chain engine and the on-chain window accounting are pinned to the same answers by a shared fixture (`packages/core/fixtures/window.json`), tested on both sides.

## 2. Control matrix

| Control | Layer | Authority | Test evidence |
|---|---|---|---|
| Untrusted content is data, never an instruction | L0 | [OWASP-LLM01] [Beurer-Kellner 2025] [CaMeL] | `apps/api/test/pipeline.test.ts` (the planner never sees the payload); `packages/core/test/injection.test.ts` |
| Decoded or translated content cannot fill an intent slot | L0, L2 | [INC-GROK-BANKR] | `packages/core/test/engine.test.ts` (decoded_content deny); `injection.test.ts` (Morse, Base64, homoglyph) |
| Every action is a typed, signed intent | L1 | [EIP-712] | `packages/core/test/intent.test.ts`; `packages/contracts/test/Fixtures.t.sol` (hashes agree) |
| Per-transaction cap | L2, L4 | [NIST-SP800-53 AC-6] | `MandateVault.t.sol` `test_revert_abovePerTxCap`; `Fuzz.t.sol` `testFuzz_perTxCapIsAHardBoundary` |
| Per-window cap (fixed window) | L2, L4 | [NIST-SP800-53 AC-6] | `test_windowCap_exhaustedByManySmallTransfers_thenRollsOver`; `Fuzz.t.sol` `testFuzz_windowCapHoldsForAnySequence`; `Invariants.t.sol` |
| Target and selector allowlists | L2, L4 | [NIST-SP800-53 AC-3] [NIST-SP800-207] | `test_revert_targetNotAllowed`, `test_revert_selectorNotAllowed`, `test_revert_callToNonAllowlistedContract_evenWithAllowedSelectorElsewhere` |
| Sanctions screening, fail closed | L2 | [OFAC-SDN] [FATF-R15] | `packages/core/test/engine.test.ts` (missing, stale and hit all deny) |
| Address poisoning detection | L2 | [INC-ADDRPOISON] | `engine.test.ts` (prefix-suffix deny, no false positive); `similarity.test.ts` |
| No unlimited approvals | L2, L4 | [OWASP-SC-TOP10] | `test_revert_unlimitedApproval_bothPaths`; `engine.test.ts` |
| Provenance: untrusted values the owner did not state escalate | L2 | [OWASP-ASI01] | `engine.test.ts` (escalate; allow when it matches an owner statement) |
| Pre-flight simulation, fail closed | L3 | [OWASP-LLM05] | `engine.test.ts` (deviation and unavailable both deny); `pipeline.test.ts` (eth_simulateV1 deltas) |
| On-chain enforcement of every bound | L4 | [MM-SEC-AUG26] | the whole `MandateVault.t.sol` suite; `Invariants.t.sol` |
| Owner co-signature verified on-chain | L4, L5 | [EIP-712] [NIST-AI-RMF] | `test_approval_nonAllowlistedTarget_succeeds`, `test_revert_approval_badOwnerSignature`, `test_revert_approval_replayedForAnotherIntent` |
| Approval replay protection | L4 | [OWASP-ASI03] | `test_revert_approval_replayedForAnotherIntent`, `test_revert_approval_consumedTwice` |
| Reentrancy protection | L4 | [OWASP-SC-TOP10] | `nonReentrant` on every state-changing external function; `test_revert_nativeTransferToRejectingContract` |
| Agent cannot call owner functions | L4 | [NIST-SP800-53 AC-6] | `test_agentCannotCallOwnerFunctions`, `test_agentCannotChangeItsOwnMandateThroughCall` |
| Kill switch (revoke and pause) | K, L4 | [MM-SEC-AUG26] | `test_revokeAgent_thenEveryCallReverts`, `test_pause_blocksBothPaths_unpauseRestores` |
| Hash-chained, tamper-evident audit log | L6 | [NIST-SP800-53 AU-10] [NIST-SP800-92] | `packages/core/test/audit.test.ts` (edit, drop, reorder, forge all detected) |
| ERC-1271: only the owner can bind the vault as a wallet | L7 | [ERC-1271] [ERC-8004] | `packages/contracts/test/Identity.t.sol` `test_vaultIsValidSignature_onlyForOwner`, `test_agentRegisters_andBindsVaultAsWallet_withOwnerConsent` |
| Petty cash policy: cap, daily cap, asset, chain, screening, Know Your Agent | L2, L7 | [NIST-SP800-53 AC-6] [ERC-8004] [FATF-R15] | `apps/api/test/pettycash.test.ts` |
| Testnet-only startup assertion | build | 2.4 of the brief | `apps/api/src/config.ts`, `packages/contracts/script/env.ts`, `apps/api/test/pipeline.test.ts` (startup checks) |

## 3. Contract test coverage

Measured with `forge coverage` on 18 October 2026, excluding scripts, tests and the mock contracts:

| Contract | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| MandateMath.sol | 100.00% (4/4) | 100.00% (4/4) | 100.00% (1/1) | 100.00% (1/1) |
| MandateVault.sol | 91.33% (158/173) | 85.47% (200/234) | 68.25% (43/63) | 89.29% (25/28) |
| Total | 91.53% (162/177) | 85.71% (204/238) | 68.75% (44/64) | 89.66% (26/29) |

The uncovered branches are mostly defensive `require` arms on owner-only setters and view-function early returns that the unit tests exercise through the execution path rather than the view. The numbers are reported exactly as the tool measures them; we have not hand-tuned them.

The Foundry suite is 58 tests: unit tests for every revert path, fuzz tests that treat the caps and the expiry as hard boundaries for arbitrary inputs, four invariants (window spend bounded, nonce counts executions, outflow accounted for, owner unchanged) run over random sequences of agent calls, owner co-signs, pauses, revokes and time warps, and fixture tests that pin the Solidity EIP-712 hashes and window accounting to the TypeScript side.

## 4. Static analysis

Slither was not installed in the build environment, so a Slither run is not included in this submission. The Foundry linter (`forge lint`) was run; its findings are informational (block-timestamp comparisons, which are intended for the expiry and deadline checks, and reentrancy-events notes, which are mitigated by `nonReentrant` and the effects-before-interactions ordering). Running Slither and triaging its findings is a named next step in the roadmap. We prefer to say this plainly rather than present a Slither run we did not do.

## 5. Key management

| Key | Where it lives | Exposure | Mitigation |
|---|---|---|---|
| Agent key | `.env`, created with viem `generatePrivateKey` | On the host | Never logged (addresses only); `.env` excluded from git; the vault bounds the damage to the mandate; testnet only |
| Owner key (local mode) | `.env`, behind a passkey prompt for each sensitive action | On the host | Passkey (WebAuthn) gate; MetaMask mode removes the server-held key entirely |
| Oracle key | `.env` | On the host | Receives payments only; testnet only |
| Owner passkey | The owner's device | The device | Standard WebAuthn; a fresh assertion per approval |

Keys are generated locally by `pnpm keys:generate`, which prints addresses only and never a private key. The generator refuses to overwrite a key that is already set. `.env` is written with mode 600. See [NIST-SP800-57] for the key-management principles we follow at the level a prototype can.

## 6. Dependency and supply-chain notes

- The code uses an OpenAI-compatible LLM abstraction (`@ai-sdk/openai-compatible`), so no model-vendor SDK is a dependency and the endpoint is configured by environment variables.
- Solidity dependencies are OpenZeppelin Contracts 5 and forge-std, installed into `lib/` (not committed) by `pnpm --filter @mandate/contracts setup`.
- x402 is the published `@x402/*` v2 packages.
- A `THIRD_PARTY_NOTICES.md` is generated from the dependency tree.
- Supply-chain risk ([OWASP-LLM03], [OWASP-ASI04]) is reduced by pinning versions and by the lockfile; it is not eliminated.

## 7. Known-risk list

Severity is our own judgement for a testnet prototype. Status is one of: accepted (a deliberate trade-off), open (would be closed before any real use), or mitigated.

| # | Risk | Severity | Status | Note |
|---|---|---|---|---|
| 1 | The vault is unaudited | High | Open | Tested, fuzzed, invariant-checked, but no third-party audit. Testnet only. |
| 2 | Owner key held by the server in local mode | Medium | Mitigated | Passkey gate; MetaMask mode removes it. |
| 3 | Agent key in `.env` on the host | Medium | Accepted | This is the threat the vault is designed for; the float is the only at-risk balance. |
| 4 | LLM non-determinism | Medium | Mitigated | MockPlanner for the demo; structured outputs; the vault is the backstop. |
| 5 | RPC trust | Medium | Accepted | Fail closed on unavailability; a lying-but-available RPC is residual. |
| 6 | Sanctions snapshot freshness | Low | Mitigated | Fail closed when stale; refreshed by a script. |
| 7 | No relayer; the agent pays its own gas | Low | Accepted | A relayer and gas abstraction are future work. |
| 8 | Slither not run in this build | Low | Open | Named next step. |
| 9 | EIP-7702 account variant not built | Low | Open | P2 stretch; the extra risks of 7702 delegates are noted in ADR-013. |
| 10 | Security Lab uses a scripted attacker, small N | Low | Accepted | Stated in docs/EVALUATION.md limitations. |
| 11 | Mock USDC and mock registry on local chains | Low | Accepted | Mirror the real contracts' interfaces and domains; on Base Sepolia the real ones are used. |

## 8. What the guarantee is, and is not

The guarantee is: a compromised agent process cannot move value outside the mandate, because the vault re-checks every bound and the vault trusts only the owner. The Security Lab measures this directly (docs/EVALUATION.md): with the off-chain layers removed, a compromised key drains the funds, and only the on-chain layer stops it.

The guarantee is not: that the agent is correct, that the LLM is safe, or that the contract is bug-free. It is a containment guarantee, not a correctness guarantee. That is why the owner keeps the kill switch and why the caps are small.

Citations resolve in docs/REFERENCES.md.
