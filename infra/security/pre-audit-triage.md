# Pre-audit static-analysis triage (Phase 3.3)

Status of every HIGH finding from the automated pass (`.github/workflows/security.yml`:
Slither + Aderyn). Reviewed 2026-06-11. Re-triage whenever a tool reports a NEW high;
the Phase 4 mainnet checklist turns unreviewed HIGHs into a blocking gate.

## Aderyn

| ID | Finding | Instances | Verdict |
|----|---------|-----------|---------|
| H-1 | Contract locks Ether without a withdraw function | `UABSender`, `MockWormhole` | **FIXED** (UABSender) / test-only (MockWormhole). `announceWithRelay` forwarded only `fee` to the core bridge and kept any overpayment forever. Fixed in source: excess is refunded to `msg.sender` (`RefundFailed` on failure), covered by the "refunds any overpayment" test. The DEPLOYED Sepolia UABSender (`0x872787…`) predates the fix; impact there is overpayment-only and the Sepolia message fee is 0. Deploy the fixed contract with the Phase 4 checklist before mainnet. `MockWormhole` is a test double and never deployed. |
| H-2 | Reentrancy: state change after external call | `OpaqueAttestationRegistry.attest` / `.revoke` | **False positive.** The "external calls" before the state writes are `view` functions (`isAuthorizedIssuer`, `isActive`, `isRevocable`, `getAuthority`) on the trusted `schemaRegistry` set at construction. Views execute as STATICCALL: no state can change, no reentrancy path exists. |
| H-3 | Yul block contains `return` | `Groth16VerifierV2` (4 sites) | **Intentional.** This is the unmodified snarkjs-generated Groth16 verifier; its verify function is a single assembly block that terminates with `return(0, 0x20)` by design, and nothing is meant to execute after it. Do not hand-edit generated verifier code. |

## Slither

Run via `crytic/slither-action` on `infra/contracts/` (solc 0.8.28). No HIGH findings
beyond the Aderyn overlap above at the time of review; see the CI artifact
`slither-report` on any run for the current list. If a new HIGH appears, triage it
here before merging.

## Gating plan

- Now (Phase 3): workflows report and upload artifacts, builds stay green.
- Phase 4 gate: flip Slither to `fail-on: high` and add an Aderyn high-count check,
  with this file as the documented-exception list.
