/**
 * Deploy the StarknetOnsMirrorSender (Ethereum L1->L2 leg of the ONS mirror) to Sepolia,
 * then publish one live mirror update to the Starknet OpaqueNameMirror.
 *
 * Run: cd infra && npx hardhat compile && STARKNET_L2_MIRROR=0x... tsx scripts/deploy-starknet-mirror-sender.ts
 * Env: SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY, STARKNET_L2_MIRROR (the OpaqueNameMirror
 *      contract address on Starknet). Optional: STARKNET_CORE (defaults to the Sepolia core),
 *      L1L2_FEE_ETH (message fee, default 0.001).
 *
 * After it prints the sender address, allowlist it on the Starknet side:
 *   sncast --account opaque_deployer invoke --contract-address $STARKNET_L2_MIRROR \
 *     --function set_l1_emitter --calldata <sender-address>
 * then re-run with SEND_TEST=1 to publish the live upsert.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(__dirname, "..", "artifacts", "contracts");

// Starknet Core Contract on Ethereum Sepolia (L1->L2 messaging).
const DEFAULT_STARKNET_CORE = "0xE2Bb56ee936fd6433DC0F6e7e3b8365C906AA057";

function artifact(name: string) {
  return JSON.parse(
    fs.readFileSync(path.join(ARTIFACTS, `${name}.sol`, `${name}.json`), "utf-8"),
  );
}

async function main() {
  const l2Mirror = process.env.STARKNET_L2_MIRROR;
  if (!l2Mirror) throw new Error("Set STARKNET_L2_MIRROR to the OpaqueNameMirror address on Starknet.");
  const starknetCore = process.env.STARKNET_CORE ?? DEFAULT_STARKNET_CORE;
  const feeEth = process.env.L1L2_FEE_ETH ?? "0.001";

  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const signer = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY!, provider);
  console.log("Deployer / authority:", signer.address);

  const a = artifact("StarknetOnsMirrorSender");
  const factory = new ethers.ContractFactory(a.abi, a.bytecode, signer);
  const sender = await factory.deploy(starknetCore, l2Mirror, signer.address);
  await sender.waitForDeployment();
  const senderAddress = await sender.getAddress();
  console.log("StarknetOnsMirrorSender:", senderAddress);
  console.log("\nNext: allowlist this sender on the Starknet mirror, then re-run with SEND_TEST=1:");
  console.log(
    `  sncast --account opaque_deployer invoke --url <rpc> --contract-address ${l2Mirror} ` +
      `--function set_l1_emitter --calldata ${senderAddress}`,
  );

  if (process.env.SEND_TEST === "1") {
    // A demo name -> meta-address record. name_hash is arbitrary here; the keys are the
    // CSAP canonical-vector spend/view pubkeys (prefix + 32-byte x).
    const nameHash = "0x0a11ce0000000000000000000000000000000000000000000000000000000001";
    const spendPrefix = 2;
    const spendX = "0x" + "11".repeat(32);
    const viewPrefix = 3;
    const viewX = "0x" + "22".repeat(32);
    const contract = new ethers.Contract(senderAddress, a.abi, signer);
    const tx = await contract.mirrorUpsert(
      nameHash,
      spendPrefix,
      spendX,
      viewPrefix,
      viewX,
      signer.address,
      { value: ethers.parseEther(feeEth) },
    );
    console.log("\nmirrorUpsert tx:", tx.hash);
    await tx.wait();
    console.log("Sent. The sequencer will deliver to the mirror in a few minutes.");
    console.log(`Verify on Starknet: mirror.resolve(${nameHash})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
