/**
 * Deploy conditional disclosure (spec/conditional-disclosure.md) to Sepolia:
 *   - DisclosureVerifier (snarkjs-generated Groth16 verifier, 6 public signals)
 *   - OpaqueDisclosureRegistry (policies + BIP-340 quorum check + nullifiers)
 *
 * Run: cd infra && npx hardhat compile && tsx scripts/deploy-disclosure.ts
 * Env: SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY. Updates deployments/sepolia.json.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(__dirname, "..", "artifacts", "contracts");
const DEPLOYMENTS = path.join(__dirname, "..", "deployments", "sepolia.json");

function artifact(name: string) {
  return JSON.parse(
    fs.readFileSync(path.join(ARTIFACTS, `${name}.sol`, `${name}.json`), "utf-8"),
  );
}

/** Optional fee ceiling (gwei) so deploys can wait out a basefee spike. */
const overrides = process.env.MAX_FEE_GWEI
  ? {
      maxFeePerGas: ethers.parseUnits(process.env.MAX_FEE_GWEI, "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits(process.env.PRIORITY_FEE_GWEI ?? "0.05", "gwei"),
    }
  : {};

async function deploy(
  signer: ethers.Wallet,
  name: string,
  args: unknown[],
  gasLimit?: number,
): Promise<string> {
  const a = artifact(name);
  const factory = new ethers.ContractFactory(a.abi, a.bytecode, signer);
  // An explicit gasLimit skips estimateGas, which RPCs reject while the fee cap
  // is below the current basefee — the tx waits in the mempool instead.
  const c = await factory.deploy(...args, { ...overrides, ...(gasLimit ? { gasLimit } : {}) });
  await c.waitForDeployment();
  return c.getAddress();
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const signer = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY!, provider);
  console.log("Deployer:", signer.address);

  const gasLimits = process.env.MAX_FEE_GWEI ? { verifier: 600_000, registry: 1_700_000 } : {};
  const verifier = await deploy(signer, "DisclosureVerifier", [], gasLimits.verifier);
  console.log("DisclosureVerifier:", verifier);
  const registry = await deploy(signer, "OpaqueDisclosureRegistry", [verifier], gasLimits.registry);
  console.log("OpaqueDisclosureRegistry:", registry);

  const record = JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf-8"));
  record.contracts.OpaqueDisclosureRegistry = registry;
  record.contracts.DisclosureVerifier = verifier;
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(record, null, 2) + "\n");
  console.log(`Updated ${DEPLOYMENTS}; run \`npm run generate\` to refresh the SDK registry.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
