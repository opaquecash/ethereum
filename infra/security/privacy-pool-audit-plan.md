# Privacy Pool — audit & legal plan (mainnet gate)

The privacy pool is the **highest-regulatory-surface** component of Opaque. It is
**testnet-only** until every gate below is met. This document tracks those gates; it is
the prerequisite checklist for any mainnet consideration (mainnet deployment planning
itself is out of scope for the current plan).

## Status

| Gate | Status | Notes |
|------|--------|-------|
| Circuit audit (`withdrawal.circom`, `association.circom`) | 🔴 not started | Veridise / zkSecurity / Hexens; budget $20–50k |
| Contract audit (Solidity + Anchor) | 🔴 not started | OtterSec / Neodyme / Trail of Bits; budget $30–80k |
| Production trusted-setup ceremony | 🔴 not started | Multi-party Phase 2 over the committed `withdrawal` r1cs; testnet uses a single-contributor key |
| Legal opinion | 🔴 not started | Crypto-native firm; $5–15k; plus the mixer-distinction language in `DISCLAIMER.md` (done) |
| EF Security grant application | 🔴 not started | Submit to fund the audits; cite `spec/privacy-pool.md` + the testnet demo |
| Foundry invariant/fuzz suite | 🟡 partial | Hardhat tests cover tree compatibility, verifier acceptance, deposit/withdraw bookkeeping, and replay; add `forge test --fuzz-runs 10000` invariants (no-loss, nullifier-once, value-conservation) before audit |

## What is already true (testnet)

- **Circuits** build under circom 2.x, fit `pot16`, and a real proof verifies end-to-end
  (`circuits/test/pool.test.js`).
- **Contracts** (`OpaquePrivacyPool`, `MerkleTreeWithHistory`, `WithdrawalVerifier`)
  deploy and pass a deposit → fresh-proof → withdraw → replay-rejection test on a local
  fork; the on-chain Poseidon tree is verified to match the circuit's tree.
- **Association-set enforcement** is inside the withdrawal proof (no cross-proof binding
  gap); **nullifier consume-once** and **`context` binding** are implemented and tested.

## Trust assumptions to remove before mainnet

1. **Trusted setup.** Testnet uses a single-contributor Phase-2 key. A production
   deployment requires a real multi-party ceremony with published transcripts; a
   subverted setup would let an attacker forge withdrawals (theft). Highest priority.
2. **ASP centralisation.** The association-set root is posted by a single testnet
   authority. Decentralise (multiple ASPs / governance) before mainnet. Note: the ASP
   controls *which* deposits can withdraw, not pool *integrity* — it cannot steal or
   freeze funds, only curate eligibility.
3. **Audits.** No mainnet value until both the circuit and contract audits land and the
   findings are burned down.

## Invariants for the fuzz/audit suite

- **No loss:** the pool's balance always ≥ the sum of unspent commitment values implied
  by deposits minus withdrawals.
- **Nullifier-once:** a `nullifierHash` can be consumed at most once.
- **Value conservation:** `withdrawnValue + remainder == value` for every withdrawal
  (enforced in-circuit; assert no contract path violates it).
- **Root monotonicity:** every insert advances `nextIndex` and records a new known root;
  stale roots beyond the ring buffer are rejected.
- **Context binding:** a proof made for one `WithdrawalParams` cannot be replayed with
  different payout params.
