/**
 * Live privacy-pool acceptance on Sepolia (spec/privacy-pool.md): a real deposit, a
 * fresh Groth16 withdrawal proof generated from the on-chain tree state, and an
 * on-chain withdraw that pays out, consumes the nullifier, and inserts the remainder.
 *
 *   cd infra && npx tsx scripts/e2e-privacy-pool.ts
 *
 * Env: SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY. Uses the deployed pool in
 * deployments/sepolia.json and the circuit artifacts in circuits/v2/build.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
// @ts-expect-error untyped
import { buildPoseidon } from "circomlibjs";
// @ts-expect-error untyped
import * as snarkjs from "snarkjs";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEP = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "deployments", "sepolia.json"), "utf-8"),
);
const POOL = DEP.contracts.OpaquePrivacyPool as string;
const CIRCUITS = path.join(__dirname, "..", "..", "..", "circuits");
const WASM = path.join(CIRCUITS, "v2", "build", "withdrawal_js", "withdrawal.wasm");
const ZKEY = path.join(CIRCUITS, "v2", "build", "withdrawal_final.zkey");
const LEVELS = 20;

const POOL_ABI = [
  "function deposit(uint256 precommitment) payable returns (bytes32)",
  "function scope() view returns (uint256)",
  "function getLastRoot() view returns (bytes32)",
  "function nextIndex() view returns (uint32)",
  "function setAspRoot(uint256 newRoot)",
  "function aspRoot() view returns (uint256)",
  "function context((address recipient,address feeRecipient,uint256 fee) params) view returns (uint256)",
  "function nullifierSpent(bytes32) view returns (bool)",
  "function withdraw(uint256[2] a,uint256[2][2] b,uint256[2] c,uint256 withdrawnValue,uint256 stateRoot,uint256 nullifierHash,uint256 newCommitment,(address recipient,address feeRecipient,uint256 fee) params)",
  "event Deposit(bytes32 indexed commitment, uint256 label, uint256 value, uint32 leafIndex)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const signer = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY!, provider);
  const pool = new ethers.Contract(POOL, POOL_ABI, signer);
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

  console.log("pool:", POOL);
  const scope = BigInt(await pool.scope());
  const leafIndex = Number(await pool.nextIndex());
  console.log("scope:", scope.toString(), "nextIndex:", leafIndex);

  // ── Deposit ────────────────────────────────────────────────────────────────
  const value = ethers.parseEther("0.002");
  const nullifier = BigInt(ethers.hexlify(ethers.randomBytes(31)));
  const secret = BigInt(ethers.hexlify(ethers.randomBytes(31)));
  const precommitment = H([nullifier, secret]);
  const label = H([scope, BigInt(leafIndex)]);
  const commitment = H([value, label, precommitment]);

  console.log("depositing 0.002 ETH ...");
  const depTx = await pool.deposit(precommitment, { value });
  const depRc = await depTx.wait();
  console.log("  deposit tx:", depRc.hash);

  const stateRoot = BigInt(await pool.getLastRoot());
  if (stateRoot !== singleLeafRoot(commitment)) {
    throw new Error("on-chain root != locally computed single-leaf root");
  }
  console.log("  state root matches local commitment tree");

  // ── ASP: approve this label (single-leaf association set) ───────────────────
  const aspRoot = singleLeafRoot(label);
  await (await pool.setAspRoot(aspRoot)).wait();
  console.log("  ASP root set");

  // ── Build the withdrawal proof from the on-chain tree state ─────────────────
  const recipient = ethers.Wallet.createRandom().address; // a fresh address
  const params = { recipient, feeRecipient: ethers.ZeroAddress, fee: 0n };
  const context = BigInt(await pool.context(params));

  const withdrawnValue = ethers.parseEther("0.0008");
  const remainder = value - withdrawnValue;
  const newNullifier = BigInt(ethers.hexlify(ethers.randomBytes(31)));
  const newSecret = BigInt(ethers.hexlify(ethers.randomBytes(31)));
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
  console.log("generating withdrawal proof ...");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  if (publicSignals[3] !== nullifierHash.toString()) throw new Error("nullifier hash mismatch");

  const a = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
  const b = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ];
  const c = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];

  const before = await provider.getBalance(recipient);
  console.log("withdrawing 0.0008 ETH to a fresh address ...");
  const wTx = await pool.withdraw(
    a, b, c, withdrawnValue, stateRoot, nullifierHash, newCommitment, params,
    { gasLimit: 1_500_000 },
  );
  const wRc = await wTx.wait();
  console.log("  withdraw tx:", wRc.hash);

  const after = await provider.getBalance(recipient);
  const spent = await pool.nullifierSpent(
    "0x" + nullifierHash.toString(16).padStart(64, "0"),
  );
  const newIndex = Number(await pool.nextIndex());

  console.log("\nACCEPTANCE:");
  console.log("  recipient received:", ethers.formatEther(after - before), "ETH (expected 0.0008)");
  console.log("  nullifier consumed:", spent);
  console.log("  remainder inserted (nextIndex):", newIndex, "(expected 2)");
  if (after - before !== withdrawnValue || !spent || newIndex !== leafIndex + 2) {
    throw new Error("acceptance assertions failed");
  }
  console.log("  PASS — live deposit -> proof -> withdraw on Sepolia");
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
