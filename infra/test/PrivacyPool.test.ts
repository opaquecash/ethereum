import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEther, type Address } from "viem";
import { network } from "hardhat";
// @ts-expect-error untyped
import { buildPoseidon, poseidonContract } from "circomlibjs";
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
const POOL_FIXTURES = circuitsPath("test", "fixtures", "pool");
const W_WASM = circuitsPath("v2", "build", "withdrawal_js", "withdrawal.wasm");
const W_ZKEY = circuitsPath("v2", "build", "withdrawal_final.zkey");
const LEVELS = 20;
const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const load = async (f: string) => JSON.parse(await readFile(path.join(POOL_FIXTURES, f), "utf8"));

describe("OpaquePrivacyPool", async () => {
  const { viem } = await network.connect();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (xs: bigint[]) => F.toObject(poseidon(xs)) as bigint;

  // Zero-subtree roots (must match the contract + circuit).
  const zeros: bigint[] = [0n];
  for (let i = 1; i <= LEVELS; i++) zeros.push(H([zeros[i - 1], zeros[i - 1]]));
  const singleLeafRoot = (leaf: bigint) => {
    let n = leaf;
    for (let i = 0; i < LEVELS; i++) n = H([n, zeros[i]]);
    return n;
  };
  const b32 = (x: bigint) => ("0x" + x.toString(16).padStart(64, "0")) as `0x${string}`;

  // snarkjs leaves curve worker threads alive; terminate so node:test can exit.
  after(async () => {
    if ((globalThis as any).curve_bn128) await (globalThis as any).curve_bn128.terminate();
  });

  async function deployPoseidon(nInputs: number): Promise<Address> {
    const [wallet] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const abi = poseidonContract.generateABI(nInputs);
    let bytecode: string = poseidonContract.createCode(nInputs);
    if (!bytecode.startsWith("0x")) bytecode = `0x${bytecode}`;
    const hash = await wallet.deployContract({ abi, bytecode: bytecode as `0x${string}`, args: [] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return receipt.contractAddress as Address;
  }

  async function deployPool() {
    const [deployer] = await viem.getWalletClients();
    const hasher2 = await deployPoseidon(2);
    const hasher3 = await deployPoseidon(3);
    const verifier = await viem.deployContract("WithdrawalVerifier" as any);
    const pool = await viem.deployContract("OpaquePrivacyPool" as any, [
      LEVELS,
      hasher2,
      hasher3,
      verifier.address,
      deployer!.account.address,
    ]);
    return { pool, verifier, deployer: deployer! };
  }

  it("on-chain Poseidon tree matches the circuit (zeros + empty root)", async () => {
    const { pool } = await deployPool();
    for (const i of [0, 1, 5, 20]) {
      assert.equal(BigInt((await pool.read.zeros([BigInt(i)])) as bigint), zeros[i], `zeros[${i}]`);
    }
    assert.equal(BigInt((await pool.read.getLastRoot()) as bigint), zeros[LEVELS], "empty root");
  });

  it("verifier accepts the committed fixture proof and rejects tampering", async () => {
    const { verifier } = await deployPool();
    const proof = await load("proof.json");
    const pub: string[] = await load("public.json");
    const a = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
    const b = [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ];
    const c = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
    const input = pub.map(BigInt);
    assert.equal(await verifier.read.verifyProof([a, b, c, input]), true);

    const bad = [...input];
    bad[3] = bad[3] ^ 1n; // flip nullifier_hash
    assert.equal(await verifier.read.verifyProof([a, b, c, bad]), false);
  });

  it("deposit inserts the contract-assigned commitment and advances the root", async () => {
    const { pool } = await deployPool();
    const scope = BigInt((await pool.read.scope()) as bigint);
    const value = parseEther("1");
    const precommitment = H([111n, 222n]);

    const label = H([scope, 0n]);
    const expectedCommitment = H([value, label, precommitment]);

    const hash = await pool.write.deposit([precommitment], { value });
    const publicClient = await viem.getPublicClient();
    await publicClient.waitForTransactionReceipt({ hash });

    assert.equal(BigInt((await pool.read.getLastRoot()) as bigint), singleLeafRoot(expectedCommitment));
    assert.equal(await pool.read.isKnownRoot([b32(singleLeafRoot(expectedCommitment))]), true);
    assert.equal(Number(await pool.read.nextIndex()), 1);
  });

  it("rejects zero and oversized deposits", async () => {
    const { pool } = await deployPool();
    await assert.rejects(pool.write.deposit([1n], { value: 0n }), /ZeroValue/);
    await assert.rejects(pool.write.deposit([1n], { value: 2n ** 128n }), /ValueTooLarge/);
  });

  const canProve = existsSync(W_WASM) && existsSync(W_ZKEY);

  it(
    "full deposit -> prove -> withdraw pays out, consumes the nullifier, inserts the remainder",
    { skip: canProve ? false : "needs circuits/v2/build (circom 2.x + setup)", timeout: 120_000 },
    async () => {
      const { pool } = await deployPool();
      const publicClient = await viem.getPublicClient();
      const [, recipientWallet] = await viem.getWalletClients();
      const scope = BigInt((await pool.read.scope()) as bigint);

      // Deposit a commitment whose openings we know.
      const value = parseEther("1");
      const nullifier = 987654321098765432109876543210n;
      const secret = 123456789012345678901234567890n;
      const precommitment = H([nullifier, secret]);
      const label = H([scope, 0n]);
      const commitment = H([value, label, precommitment]);
      const depHash = await pool.write.deposit([precommitment], { value });
      await publicClient.waitForTransactionReceipt({ hash: depHash });

      const stateRoot = BigInt((await pool.read.getLastRoot()) as bigint);
      assert.equal(stateRoot, singleLeafRoot(commitment));

      // ASP: approve this label (single-leaf association tree).
      const aspRoot = singleLeafRoot(label);
      await pool.write.setAspRoot([aspRoot]);

      // Withdrawal params + the contract's context binding.
      const params = {
        recipient: recipientWallet!.account.address,
        feeRecipient: "0x0000000000000000000000000000000000000000" as Address,
        fee: 0n,
      };
      const context = BigInt((await pool.read.context([params])) as bigint);

      const withdrawnValue = parseEther("0.4");
      const remainder = value - withdrawnValue;
      const newNullifier = 555n;
      const newSecret = 666n;
      const newCommitment = H([remainder, label, H([newNullifier, newSecret])]);
      const nullifierHash = H([nullifier]);

      const input = {
        value: value.toString(),
        label: label.toString(),
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        new_nullifier: newNullifier.toString(),
        new_secret: newSecret.toString(),
        state_siblings: zeros.slice(0, LEVELS).map(String),
        state_index: Array(LEVELS).fill(0),
        asp_siblings: zeros.slice(0, LEVELS).map(String),
        asp_index: Array(LEVELS).fill(0),
        withdrawn_value: withdrawnValue.toString(),
        state_root: stateRoot.toString(),
        asp_root: aspRoot.toString(),
        nullifier_hash: nullifierHash.toString(),
        new_commitment: newCommitment.toString(),
        context: context.toString(),
      };
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, W_WASM, W_ZKEY);
      assert.equal(publicSignals[3], nullifierHash.toString());

      const a = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
      const b = [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ];
      const c = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];

      const before = await publicClient.getBalance({ address: params.recipient });
      const wHash = await pool.write.withdraw([
        a, b, c, withdrawnValue, stateRoot, nullifierHash, newCommitment, params,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: wHash });
      const after = await publicClient.getBalance({ address: params.recipient });

      assert.equal(after - before, withdrawnValue, "recipient received withdrawnValue");
      assert.equal(await pool.read.nullifierSpent([("0x" + nullifierHash.toString(16).padStart(64, "0")) as `0x${string}`]), true);
      assert.equal(Number(await pool.read.nextIndex()), 2, "remainder commitment inserted");

      // Replay is rejected.
      await assert.rejects(
        pool.write.withdraw([a, b, c, withdrawnValue, stateRoot, nullifierHash, newCommitment, params]),
        /NullifierAlreadySpent/,
      );
    },
  );
});
