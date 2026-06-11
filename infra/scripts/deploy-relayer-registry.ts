/**
 * Deploy the RelayerRegistry (spec/relayer-market.md): combined relayer stake
 * registry + gas-private job escrow. No constructor arguments; testnet constants
 * (MINIMUM_STAKE, UNSTAKE_COOLDOWN) are compiled in.
 *
 * Run:
 *   cd infra && npx hardhat compile && tsx scripts/deploy-relayer-registry.ts
 *
 * Env (.env): SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY.
 * Updates deployments/sepolia.json; rerun `npm run generate` afterwards.
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT = path.join(
  __dirname,
  "..",
  "artifacts",
  "contracts",
  "RelayerRegistry.sol",
  "RelayerRegistry.json",
);
const DEPLOYMENTS = path.join(__dirname, "..", "deployments", "sepolia.json");

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const signer = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY!, provider);
  console.log(`Deployer: ${signer.address}`);

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, "utf-8"));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`RelayerRegistry deployed at: ${address}`);

  const record = JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf-8"));
  record.contracts.RelayerRegistry = address;
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(record, null, 2) + "\n");
  console.log(`Updated ${DEPLOYMENTS}; run \`npm run generate\` to refresh the SDK registry.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
