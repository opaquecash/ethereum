/**
 * Deploy the privacy pool (spec/privacy-pool.md) to Sepolia:
 *   - Poseidon(2) + Poseidon(3) hashers (circomlib-compatible, from circomlibjs bytecode)
 *   - WithdrawalVerifier (snarkjs-generated Groth16 verifier)
 *   - OpaquePrivacyPool (depth-20 state tree; ASP authority = deployer on testnet)
 *
 * Run: cd infra && npx hardhat compile && tsx scripts/deploy-privacy-pool.ts
 * Env: SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY. Updates deployments/sepolia.json.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
// @ts-expect-error untyped
import { poseidonContract } from "circomlibjs";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(__dirname, "..", "artifacts", "contracts");
const DEPLOYMENTS = path.join(__dirname, "..", "deployments", "sepolia.json");
const LEVELS = 20;

function artifact(name: string) {
  return JSON.parse(
    fs.readFileSync(path.join(ARTIFACTS, `${name}.sol`, `${name}.json`), "utf-8"),
  );
}

async function deployPoseidon(signer: ethers.Wallet, nInputs: number): Promise<string> {
  const abi = poseidonContract.generateABI(nInputs);
  let bytecode: string = poseidonContract.createCode(nInputs);
  if (!bytecode.startsWith("0x")) bytecode = `0x${bytecode}`;
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const c = await factory.deploy();
  await c.waitForDeployment();
  return c.getAddress();
}

async function deploy(signer: ethers.Wallet, name: string, args: unknown[]): Promise<string> {
  const a = artifact(name);
  const factory = new ethers.ContractFactory(a.abi, a.bytecode, signer);
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c.getAddress();
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const signer = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY!, provider);
  console.log("Deployer:", signer.address);

  const hasher2 = await deployPoseidon(signer, 2);
  console.log("Poseidon2:", hasher2);
  const hasher3 = await deployPoseidon(signer, 3);
  console.log("Poseidon3:", hasher3);
  const verifier = await deploy(signer, "WithdrawalVerifier", []);
  console.log("WithdrawalVerifier:", verifier);
  const pool = await deploy(signer, "OpaquePrivacyPool", [
    LEVELS,
    hasher2,
    hasher3,
    verifier,
    signer.address, // ASP authority (testnet)
  ]);
  console.log("OpaquePrivacyPool:", pool);

  const record = JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf-8"));
  record.contracts.OpaquePrivacyPool = pool;
  record.contracts.WithdrawalVerifier = verifier;
  record.contracts.PoolPoseidon2 = hasher2;
  record.contracts.PoolPoseidon3 = hasher3;
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(record, null, 2) + "\n");
  console.log(`Updated ${DEPLOYMENTS}; run \`npm run generate\` to refresh the SDK registry.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
