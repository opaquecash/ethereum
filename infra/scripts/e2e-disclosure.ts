/**
 * Live conditional-disclosure acceptance on Sepolia (spec/conditional-disclosure.md):
 * a REAL 2-of-3 FROST DKG + threshold signing via the frost-custodian CLI (no party
 * ever holds the group secret), a policy registration, a qualifying pool deposit, a
 * fresh Groth16 disclosure proof from the on-chain tree state, and an on-chain
 * disclose that consumes the nullifier — plus tampered-signature, below-threshold,
 * and replay rejections.
 *
 *   cd infra && npx tsx scripts/e2e-disclosure.ts
 *
 * Env: SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY, optional MAX_FEE_GWEI (fee-capped txs
 * for a congested Sepolia). Uses deployments/sepolia.json, circuits/v2/build, and
 * the frost-custodian binary in ../sdk/tools/frost-custodian/target/debug.
 */
import { ethers } from "ethers";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
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
const REGISTRY = DEP.contracts.OpaqueDisclosureRegistry as string;
const CIRCUITS = path.join(__dirname, "..", "..", "..", "circuits");
const WASM = path.join(CIRCUITS, "v2", "build", "conditional_disclosure_js", "conditional_disclosure.wasm");
const ZKEY = path.join(CIRCUITS, "v2", "build", "conditional_disclosure_final.zkey");
const FROST = path.join(__dirname, "..", "..", "..", "sdk", "tools", "frost-custodian", "target", "debug", "frost-custodian");
const LEVELS = 20;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DOMAIN_DISCLOSURE =
  2892858644728810973983554811705195156385130922452064297470708309156017996001n;

const POOL_ABI = [
  "function deposit(uint256 precommitment) payable returns (bytes32)",
  "function scope() view returns (uint256)",
  "function getLastRoot() view returns (bytes32)",
  "function nextIndex() view returns (uint32)",
  "function filledSubtrees(uint256) view returns (bytes32)",
];
const REGISTRY_ABI = [
  "function registerPolicy(address pool, uint256 groupKeyX, uint128 threshold, uint8 m, uint8 n) returns (uint256)",
  "function policyCount() view returns (uint256)",
  "function context(uint256 policyId, bytes32 caseId, address requester) pure returns (uint256)",
  "function nullifierConsumed(bytes32) view returns (bool)",
  "function verifySchnorr(uint256 px, bytes32 m, (uint256 rx,uint256 ry,uint256 s) sig) view returns (bool)",
  "function disclose(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[6] signals, uint256 policyId, bytes32 caseId, (uint256 rx,uint256 ry,uint256 s) sig)",
  "event Disclosure(uint256 indexed policyId, bytes32 indexed caseId, address indexed requester, uint256 label, uint256 value, bytes32 disclosureNullifier)",
];

const overrides = process.env.MAX_FEE_GWEI
  ? {
      maxFeePerGas: ethers.parseUnits(process.env.MAX_FEE_GWEI, "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits(process.env.PRIORITY_FEE_GWEI ?? "0.05", "gwei"),
    }
  : {};

function frost(args: string[]): string {
  return execFileSync(FROST, args, { encoding: "utf8" });
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const signer = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY!, provider);
  const pool = new ethers.Contract(POOL, POOL_ABI, signer);
  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, signer);
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (xs: bigint[]) => F.toObject(poseidon(xs)) as bigint;
  const zeros: bigint[] = [0n];
  for (let i = 1; i <= LEVELS; i++) zeros.push(H([zeros[i - 1], zeros[i - 1]]));

  console.log("pool:", POOL, "\nregistry:", REGISTRY);

  // ── 1. FROST ceremony: 2-of-3 DKG, no dealer ────────────────────────────────
  console.log("running 2-of-3 FROST DKG (frost-custodian) ...");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opaque-disclosure-eth-"));
  const ceremony = path.join(dir, "ceremony");
  for (const i of [1, 2, 3]) frost(["dkg-part1", "--id", `${i}`, "--min", "2", "--max", "3", "--dir", ceremony]);
  for (const i of [1, 2, 3]) frost(["dkg-part2", "--id", `${i}`, "--dir", ceremony]);
  for (const i of [1, 2, 3]) frost(["dkg-finalize", "--id", `${i}`, "--dir", ceremony]);
  const group = JSON.parse(fs.readFileSync(path.join(ceremony, "group.json"), "utf8"));
  const groupKeyX = BigInt("0x" + group.group_key_x);
  console.log("  group key (x-only): 0x" + group.group_key_x);

  // ── 2. Register the policy ───────────────────────────────────────────────────
  const threshold = ethers.parseEther("0.0001");
  console.log("registering policy (threshold 0.0001 ETH, 2-of-3) ...");
  const regTx = await registry.registerPolicy(POOL, groupKeyX, threshold, 2, 3, overrides);
  await regTx.wait();
  const policyId = (await registry.policyCount()) - 1n;
  console.log("  policyId:", policyId.toString());

  // ── 3. Deposit a qualifying note (0.0004 > 0.0001 ETH) ───────────────────────
  const scope = BigInt(await pool.scope());
  const leafIndex = Number(await pool.nextIndex());
  const value = ethers.parseEther("0.0004");
  const nullifier = BigInt(ethers.hexlify(ethers.randomBytes(31)));
  const secret = BigInt(ethers.hexlify(ethers.randomBytes(31)));
  const label = H([scope, BigInt(leafIndex)]);
  const commitment = H([value, label, H([nullifier, secret])]);
  console.log("depositing 0.0004 ETH (leaf", leafIndex, ") ...");
  const depTx = await pool.deposit(H([nullifier, secret]), { value, ...overrides });
  await depTx.wait();

  // ── 4. Sibling path for the just-inserted (rightmost) leaf ────────────────────
  // No event scan needed (free-tier RPCs cap eth_getLogs ranges): for the most
  // recent leaf, each level's sibling is the cached filledSubtrees[i] when the
  // index bit is 1 (we are the right child) and the zero subtree when it is 0.
  // Recomputing the root from this path and matching getLastRoot() proves it.
  console.log("deriving the sibling path from filledSubtrees ...");
  const siblings: bigint[] = [];
  const pathIdx: number[] = [];
  for (let lvl = 0; lvl < LEVELS; lvl++) {
    const bit = (leafIndex >> lvl) & 1;
    siblings.push(bit === 1 ? BigInt(await pool.filledSubtrees(lvl)) : zeros[lvl]);
    pathIdx.push(bit);
  }
  let node = commitment;
  for (let lvl = 0; lvl < LEVELS; lvl++) {
    node = pathIdx[lvl] === 1 ? H([siblings[lvl], node]) : H([node, siblings[lvl]]);
  }
  const stateRoot = node;
  if (stateRoot !== BigInt(await pool.getLastRoot())) throw new Error("root mismatch vs chain");
  console.log("  path recomputes the on-chain root ✓ (leaf", leafIndex, ")");

  // ── 5. Context + 2-of-3 threshold signature (custodians 2 and 3) ─────────────
  const caseId = ethers.encodeBytes32String("sepolia-acceptance-7.5");
  const context = BigInt(await registry.context(policyId, caseId, signer.address));
  const msgHex = context.toString(16).padStart(64, "0");
  console.log("custodians 2 + 3 co-sign the context (M=2 of N=3) ...");
  const signing = path.join(dir, "signing");
  for (const i of [2, 3]) frost(["sign-round1", "--id", `${i}`, "--key", path.join(ceremony, `keys/${i}.key.secret.json`), "--dir", signing]);
  for (const i of [2, 3]) frost(["sign-round2", "--id", `${i}`, "--key", path.join(ceremony, `keys/${i}.key.secret.json`), "--message", msgHex, "--dir", signing]);
  frost(["aggregate", "--group", path.join(ceremony, "group.json"), "--message", msgHex, "--dir", signing]);
  const sigFile = JSON.parse(fs.readFileSync(path.join(signing, "signature.json"), "utf8"));
  const sig = { rx: BigInt("0x" + sigFile.rx), ry: BigInt("0x" + sigFile.ry), s: BigInt("0x" + sigFile.s) };
  if (!(await registry.verifySchnorr(groupKeyX, "0x" + msgHex, sig))) {
    throw new Error("on-chain verifySchnorr rejected the FROST aggregate");
  }
  console.log("  aggregate BIP-340 signature verifies on-chain ✓");

  // ── 6. Below-threshold qualification is unsatisfiable ────────────────────────
  const disclosureNullifier = H([nullifier, context, DOMAIN_DISCLOSURE]);
  const input = {
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    state_siblings: siblings.map(String),
    state_index: pathIdx,
    value: value.toString(),
    label: label.toString(),
    threshold: threshold.toString(),
    state_root: stateRoot.toString(),
    disclosure_nullifier: disclosureNullifier.toString(),
    context: context.toString(),
  };
  try {
    await snarkjs.groth16.fullProve({ ...input, threshold: value.toString() }, WASM, ZKEY);
    throw new Error("below-threshold witness unexpectedly satisfiable");
  } catch (e) {
    if (String(e).includes("unexpectedly")) throw e;
    console.log("  below-threshold note is unsatisfiable ✓");
  }

  // ── 7. Prove + disclose ───────────────────────────────────────────────────────
  console.log("generating disclosure proof ...");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const a: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ];
  const c: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
  const signals = publicSignals.map(BigInt);

  // Tampered quorum signature → revert (estimateGas surfaces it without spending).
  try {
    await registry.disclose.estimateGas(a, b, c, signals, policyId, caseId, { ...sig, s: sig.s ^ 1n });
    throw new Error("tampered signature unexpectedly accepted");
  } catch (e: any) {
    if (String(e.message).includes("unexpectedly")) throw e;
    console.log("  tampered quorum signature rejected ✓");
  }

  console.log("submitting disclose ...");
  const tx = await registry.disclose(a, b, c, signals, policyId, caseId, sig, overrides);
  const rc = await tx.wait();
  console.log("  disclose tx:", rc.hash);

  const nh = "0x" + disclosureNullifier.toString(16).padStart(64, "0");
  if (!(await registry.nullifierConsumed(nh))) throw new Error("nullifier not consumed");
  console.log("  disclosure nullifier consumed ✓");

  try {
    await registry.disclose.estimateGas(a, b, c, signals, policyId, caseId, sig);
    throw new Error("replay unexpectedly accepted");
  } catch (e: any) {
    if (String(e.message).includes("unexpectedly")) throw e;
    console.log("  replay rejected ✓");
  }

  console.log("\nACCEPTANCE (Ethereum Sepolia) ✓");
  console.log("  2-of-3 custodians authorized one qualifying disclosure;");
  console.log("  the group secret never existed in one place (FROST DKG);");
  console.log("  value disclosed:", ethers.formatEther(value), "ETH; label:", label.toString());
  if ((globalThis as any).curve_bn128) await (globalThis as any).curve_bn128.terminate();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
