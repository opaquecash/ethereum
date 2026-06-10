import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import hre from "hardhat";

/// V2 proof round-trip against the real Groth16 verifier (Phase 1.2).
///
/// The fixture in circuits/test/fixtures/v2/ (git submodule) is a real Groth16
/// proof generated with the production proving key — the same trusted setup
/// whose verification key is transcribed into Groth16VerifierV2.sol. If any
/// transcribed constant drifted from the circuit's verification_key.json, the
/// pairing check below would fail.

const FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "circuits", "test", "fixtures", "v2"
);
const load = (f: string) => JSON.parse(readFileSync(join(FIXTURES, f), "utf8"));

/// snarkjs proof.json → verifyProof calldata. G2 coordinates are swapped
/// (imaginary part first) per the EVM pairing precompile convention.
function calldata() {
  const proof = load("proof.json");
  const pub = load("public.json");
  const a = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])] as [bigint, bigint];
  const b = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ] as [[bigint, bigint], [bigint, bigint]];
  const c = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])] as [bigint, bigint];
  const signals = pub.map(BigInt) as [bigint, bigint, bigint, bigint];
  return { a, b, c, signals };
}

describe("Groth16VerifierV2", () => {
  it("verifies a real V2 proof from the production trusted setup", async () => {
    const { viem } = await hre.network.connect();
    const verifier = await viem.deployContract("Groth16VerifierV2" as any);
    const { a, b, c, signals } = calldata();

    const ok = await verifier.read.verifyProof([a, b, c, signals]);
    assert.equal(ok, true, "production fixture proof must verify");
  });

  it("rejects the same proof with a tampered public signal", async () => {
    const { viem } = await hre.network.connect();
    const verifier = await viem.deployContract("Groth16VerifierV2" as any);
    const { a, b, c, signals } = calldata();
    signals[3] ^= 1n; // flip nullifier_hash

    const ok = await verifier.read.verifyProof([a, b, c, signals]);
    assert.equal(ok, false, "tampered public signal must not verify");
  });

  it("returns false for a bogus (all-zero) proof", async () => {
    const { viem } = await hre.network.connect();
    const verifier = await viem.deployContract("Groth16VerifierV2" as any);
    const zero = [0n, 0n] as [bigint, bigint];
    const zeroB = [[0n, 0n], [0n, 0n]] as [[bigint, bigint], [bigint, bigint]];
    const pub = [0n, 0n, 0n, 0n] as [bigint, bigint, bigint, bigint];

    const ok = await verifier.read.verifyProof([zero, zeroB, zero, pub]);
    assert.equal(ok, false, "a non-proof must not verify");
  });
});
