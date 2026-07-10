// Targeted redeploy of the audit-fixed EVM contracts to fresh addresses, re-wired to the
// existing (unchanged) verifiers/hashers/Wormhole. Run: node scripts/redeploy-audited.mjs
import "dotenv/config";
import fs from "node:fs";
import { ethers } from "ethers";

const RPC = process.env.REDEPLOY_RPC_URL || process.env.SEPOLIA_RPC_URL;
const KEY = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
const fetchReq = new ethers.FetchRequest(RPC);
fetchReq.timeout = 180000; // 180s per request — Sepolia RPC is slow under deploy load
const provider = new ethers.JsonRpcProvider(fetchReq, { chainId: 11155111, name: "sepolia" }, { staticNetwork: true, pollingInterval: 5000 });
const wallet = new ethers.Wallet(KEY, provider);
const ADDRS_FILE = "/tmp/new-evm-addrs.json";
const saved = fs.existsSync(ADDRS_FILE) ? JSON.parse(fs.readFileSync(ADDRS_FILE, "utf8")) : {};

// Existing (unchanged) dependencies from deployments/sepolia.json.
const DEPLOYER = wallet.address;
const GROTH16 = "0x49A212bdbc52F1cb6C93623FC7814a61Fc71ddB5";
const POS2 = "0x738B557973a5C804260B1A3adb91Ee6049e2ef89";
const POS3 = "0x6f49bdEB8c92C79c74bfEe1B287126B75c1DC9fF";
const WVERIF = "0xa1add9daa1F4D0f9190c13fb9AD52e525f4726b5";
const WORMHOLE = "0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78";
const UAB_EMITTER_CHAIN = 1; // Solana
const UAB_EMITTER = "0x94170201d003110428411f94cd9c3d7aa4c7215d626ce5a032638ee2261e55f5";

const art = (n) => JSON.parse(fs.readFileSync(`artifacts/contracts/${n}.sol/${n}.json`, "utf8"));
async function deploy(name, args) {
  if (saved[name]) { console.log(`${name.padEnd(28)} = ${saved[name]} (already deployed, skip)`); return saved[name]; }
  const a = art(name);
  const f = new ethers.ContractFactory(a.abi, a.bytecode, wallet);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  saved[name] = addr;
  fs.writeFileSync(ADDRS_FILE, JSON.stringify(saved, null, 2)); // persist after each deploy
  console.log(`${name.padEnd(28)} = ${addr}`);
  return addr;
}

const out = saved;
console.log("deployer:", DEPLOYER, "\n");
// Reputation verifier: schema-registry binding stays DISABLED (address(0)); enabling it
// requires the attestation-id/schema-id encoding alignment (the deeper OPQ-006 fix).
out.OpaqueReputationVerifierV2 = await deploy("OpaqueReputationVerifierV2", [GROTH16, DEPLOYER]);
// Pool: OPQ-016 aspRoot history + validation, OPQ-029 fee-without-recipient. levels=20.
out.OpaquePrivacyPool = await deploy("OpaquePrivacyPool", [20, POS2, POS3, WVERIF, DEPLOYER]);
// UAB receiver: OPQ-022 source-chain check, OPQ-033 non-zero emitter (so pass the real emitter).
out.UABReceiver = await deploy("UABReceiver", [WORMHOLE, DEPLOYER, UAB_EMITTER_CHAIN, UAB_EMITTER]);
// Relayer registry: OPQ-023 submit deadline, OPQ-027 unstake cooldown. No constructor args.
out.RelayerRegistry = await deploy("RelayerRegistry", []);

fs.writeFileSync("/tmp/new-evm-addrs.json", JSON.stringify(out, null, 2));
console.log("\nNEW ADDRESSES:", JSON.stringify(out, null, 2));
