import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";

/// Sanity checks for the real V2 Groth16 verifier (constants transcribed from the
/// V2 circuit's verification key — the same key the Solana verifier uses).
///
/// A real end-to-end proof round-trip requires the circom-2 V2 build (unavailable in
/// this environment), so here we confirm the verifier deploys and that a non-proof
/// is rejected (returns false) rather than reverting — i.e. the pairing path runs.
describe("Groth16VerifierV2", () => {
  it("deploys and returns false for a bogus (all-zero) proof", async () => {
    const { viem } = await hre.network.connect();
    const verifier = await viem.deployContract("Groth16VerifierV2" as any);
    const a = [0n, 0n] as [bigint, bigint];
    const b = [[0n, 0n], [0n, 0n]] as [[bigint, bigint], [bigint, bigint]];
    const c = [0n, 0n] as [bigint, bigint];
    const pub = [0n, 0n, 0n, 0n] as [bigint, bigint, bigint, bigint];

    const ok = await verifier.read.verifyProof([a, b, c, pub]);
    assert.equal(ok, false, "a non-proof must not verify");
  });
});
