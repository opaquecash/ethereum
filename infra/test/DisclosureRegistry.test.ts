/**
 * Phase 7.3a — OpaqueDisclosureRegistry + DisclosureVerifier
 * (spec/conditional-disclosure.md §5–§6).
 *
 *  1. Vkey pinning (always runs): the committed circuits fixture verifies
 *     against the deployed DisclosureVerifier — locks the transcribed vkey to
 *     the production conditional_disclosure circuit.
 *  2. BIP-340 verification (always runs): @noble/curves schnorr signatures
 *     accepted on-chain via the ecrecover trick; tampered/odd-Y/foreign-key
 *     signatures rejected. (A FROST aggregate is byte-identical to a
 *     single-signer BIP-340 signature — the quorum property is exercised in
 *     the Phase 7.5 acceptance run.)
 *  3. Full disclose flow (needs circuits/v2/build): fresh proof bound to a
 *     real (policyId, caseId, requester) context → happy path, replay,
 *     wrong-sender, bad-signature, wrong-threshold, unknown-root rejections.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { network } from "hardhat";
import { schnorr } from "@noble/curves/secp256k1";
// @ts-expect-error untyped
import { buildPoseidon } from "circomlibjs";
// @ts-expect-error untyped
import * as snarkjs from "snarkjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer the circuits submodule of this repo (present in CI: committed fixtures only);
// fall back to a sibling monorepo checkout, which also carries the generated
// v2/build artifacts (wasm/zkeys) for local proving.
const circuitsPath = (...segs: string[]): string => {
  const sub = path.join(__dirname, "..", "..", "circuits", ...segs);
  return existsSync(sub) ? sub : path.join(__dirname, "..", "..", "..", "circuits", ...segs);
};
const FIXTURES = circuitsPath("test", "fixtures", "disclosure");
const D_WASM = circuitsPath("v2", "build", "conditional_disclosure_js", "conditional_disclosure.wasm");
const D_ZKEY = circuitsPath("v2", "build", "conditional_disclosure_final.zkey");
const LEVELS = 20;
const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// keccak256("opaque/disclosure/v1") mod r — spec §7.
const DOMAIN_DISCLOSURE =
  2892858644728810973983554811705195156385130922452064297470708309156017996001n;
const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

const load = async (f: string) => JSON.parse(await readFile(path.join(FIXTURES, f), "utf8"));
const b32 = (x: bigint) => ("0x" + x.toString(16).padStart(64, "0")) as Hex;

/** lift_x: the even-Y point for x (BIP-340). p ≡ 3 (mod 4) so sqrt = ^((p+1)/4). */
function liftY(x: bigint): bigint {
  const modpow = (base: bigint, exp: bigint, mod: bigint) => {
    let r = 1n;
    base %= mod;
    while (exp > 0n) {
      if (exp & 1n) r = (r * base) % mod;
      base = (base * base) % mod;
      exp >>= 1n;
    }
    return r;
  };
  const y = modpow((x * x * x + 7n) % SECP_P, (SECP_P + 1n) / 4n, SECP_P);
  return y % 2n === 0n ? y : SECP_P - y;
}

/** BIP-340 sign over a 32-byte message; returns the on-chain SchnorrSig tuple. */
function signSchnorr(msg32: Uint8Array, priv: Uint8Array) {
  const sig = schnorr.sign(msg32, priv); // 64 bytes: Rx ‖ s
  const rx = BigInt("0x" + Buffer.from(sig.slice(0, 32)).toString("hex"));
  const s = BigInt("0x" + Buffer.from(sig.slice(32)).toString("hex"));
  return { rx, ry: liftY(rx), s };
}

const toBytes32 = (x: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

describe("OpaqueDisclosureRegistry", async () => {
  const { viem } = await network.connect();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (xs: bigint[]) => F.toObject(poseidon(xs)) as bigint;

  const zeros: bigint[] = [0n];
  for (let i = 1; i <= LEVELS; i++) zeros.push(H([zeros[i - 1], zeros[i - 1]]));
  const singleLeafRoot = (leaf: bigint) => {
    let n = leaf;
    for (let i = 0; i < LEVELS; i++) n = H([n, zeros[i]]);
    return n;
  };

  after(async () => {
    if ((globalThis as any).curve_bn128) await (globalThis as any).curve_bn128.terminate();
  });

  const priv = new Uint8Array(32).fill(7); // custodian group secret stand-in
  const groupKeyX = BigInt("0x" + Buffer.from(schnorr.getPublicKey(priv)).toString("hex"));

  async function deployAll() {
    const wallets = await viem.getWalletClients();
    const verifier = await viem.deployContract("DisclosureVerifier" as any);
    const pool = await viem.deployContract("MockPoolRoots" as any);
    const registry = await viem.deployContract("OpaqueDisclosureRegistry" as any, [
      verifier.address,
    ]);
    return { verifier, pool, registry, wallets };
  }

  const contextOf = (policyId: bigint, caseId: Hex, requester: Address) =>
    BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "bytes32" }, { type: "address" }],
          [policyId, caseId, requester],
        ),
      ),
    ) % FIELD;

  // ── 1. Vkey pinning ─────────────────────────────────────────────────────────

  it("the committed circuits fixture verifies against the deployed verifier", async () => {
    const { verifier } = await deployAll();
    const proof = await load("proof.json");
    const pub: string[] = await load("public.json");
    const ok = await verifier.read.verifyProof([
      [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
      [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ],
      [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
      pub.map(BigInt) as any,
    ]);
    assert.equal(ok, true, "production fixture must verify on-chain (vkey pinned)");
  });

  // ── 2. BIP-340 via ecrecover ────────────────────────────────────────────────

  it("accepts a @noble BIP-340 signature and rejects tampering", async () => {
    const { registry } = await deployAll();
    const msg = toBytes32(123456789n);
    const sig = signSchnorr(msg, priv);

    assert.equal(
      await registry.read.verifySchnorr([groupKeyX, b32(123456789n), sig]),
      true,
      "valid signature accepted",
    );
    assert.equal(
      await registry.read.verifySchnorr([groupKeyX, b32(123456790n), sig]),
      false,
      "different message rejected",
    );
    assert.equal(
      await registry.read.verifySchnorr([groupKeyX, b32(123456789n), { ...sig, s: sig.s ^ 1n }]),
      false,
      "tampered s rejected",
    );
    assert.equal(
      await registry.read.verifySchnorr([
        groupKeyX,
        b32(123456789n),
        { ...sig, ry: SECP_P - sig.ry },
      ]),
      false,
      "odd-Y R rejected",
    );
    const otherKeyX = BigInt(
      "0x" + Buffer.from(schnorr.getPublicKey(new Uint8Array(32).fill(9))).toString("hex"),
    );
    assert.equal(
      await registry.read.verifySchnorr([otherKeyX, b32(123456789n), sig]),
      false,
      "foreign key rejected",
    );
  });

  it("validates policy registration", async () => {
    const { registry, pool } = await deployAll();
    await assert.rejects(
      registry.write.registerPolicy([pool.address, 0n, 1n, 2, 3]),
      /InvalidGroupKey/,
    );
    await assert.rejects(
      registry.write.registerPolicy([pool.address, groupKeyX, 1n, 3, 2]),
      /InvalidGroupKey/,
    );
    await registry.write.registerPolicy([pool.address, groupKeyX, 1n, 2, 3]);
    assert.equal(await registry.read.policyCount(), 1n);
  });

  // ── 3. Full disclose flow (fresh proof) ─────────────────────────────────────

  const canProve = existsSync(D_WASM) && existsSync(D_ZKEY);

  it(
    "quorum-authorized disclosure: happy path + every rejection",
    { skip: canProve ? false : "needs circuits/v2/build (circom 2.x + setup)", timeout: 180_000 },
    async () => {
      const { registry, pool, wallets } = await deployAll();
      const publicClient = await viem.getPublicClient();
      const requester = wallets[0]!.account.address as Address;
      const stranger = wallets[1]!;

      // Policy: threshold 0.5e18, 2-of-3 custodians.
      const threshold = 500_000_000_000_000_000n;
      await registry.write.registerPolicy([pool.address, groupKeyX, threshold, 2, 3]);
      const policyId = 0n;
      const caseId = ("0x" + "ca5e".padEnd(64, "0")) as Hex;

      // A qualifying note in a single-leaf state tree the mock pool recognizes.
      const value = 2_000_000_000_000_000_000n;
      const label = H([515151n, 0n]);
      const nullifier = 987654321987654321987654321n;
      const secret = 123123123123123123123123123n;
      const commitment = H([value, label, H([nullifier, secret])]);
      const stateRoot = singleLeafRoot(commitment);
      await pool.write.setKnownRoot([b32(stateRoot), true]);

      const ctx = contextOf(policyId, caseId, requester);
      const disclosureNullifier = H([nullifier, ctx, DOMAIN_DISCLOSURE]);

      const input = {
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        state_siblings: zeros.slice(0, LEVELS).map(String),
        state_index: Array(LEVELS).fill(0),
        value: value.toString(),
        label: label.toString(),
        threshold: threshold.toString(),
        state_root: stateRoot.toString(),
        disclosure_nullifier: disclosureNullifier.toString(),
        context: ctx.toString(),
      };
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, D_WASM, D_ZKEY);
      const a = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])] as const;
      const b = [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ] as const;
      const c = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])] as const;
      const signals = publicSignals.map(BigInt) as [bigint, bigint, bigint, bigint, bigint, bigint];

      // The custodian quorum signs the context (blind: no note data in it).
      const sig = signSchnorr(toBytes32(ctx), priv);

      // Wrong threshold signal → ThresholdMismatch (use a too-low policy id? no:
      // tamper the signal — proof will also fail, but threshold check fires first).
      await assert.rejects(
        registry.write.disclose([
          a, b, c, [signals[0], signals[1], signals[2] + 1n, signals[3], signals[4], signals[5]],
          policyId, caseId, sig,
        ]),
        /ThresholdMismatch/,
      );

      // Stranger submits the intercepted proof+sig → ContextMismatch.
      await assert.rejects(
        registry.write.disclose([a, b, c, signals, policyId, caseId, sig], {
          account: stranger.account,
        }),
        /ContextMismatch/,
      );

      // Bad quorum signature → InvalidQuorumSignature.
      await assert.rejects(
        registry.write.disclose([a, b, c, signals, policyId, caseId, { ...sig, s: sig.s ^ 1n }]),
        /InvalidQuorumSignature/,
      );

      // Unknown state root → UnknownStateRoot.
      await pool.write.setKnownRoot([b32(stateRoot), false]);
      await assert.rejects(
        registry.write.disclose([a, b, c, signals, policyId, caseId, sig]),
        /UnknownStateRoot/,
      );
      await pool.write.setKnownRoot([b32(stateRoot), true]);

      // Happy path: Disclosure event with the disclosed (label, value).
      const hash = await registry.write.disclose([a, b, c, signals, policyId, caseId, sig]);
      await publicClient.waitForTransactionReceipt({ hash });
      const events = await registry.getEvents.Disclosure();
      assert.equal(events.length, 1);
      assert.equal(events[0]!.args.value, value);
      assert.equal(events[0]!.args.label, label);
      assert.equal(events[0]!.args.requester?.toLowerCase(), requester.toLowerCase());
      assert.equal(await registry.read.nullifierConsumed([b32(disclosureNullifier)]), true);

      // Replay → NullifierAlreadyConsumed.
      await assert.rejects(
        registry.write.disclose([a, b, c, signals, policyId, caseId, sig]),
        /NullifierAlreadyConsumed/,
      );
    },
  );
});
