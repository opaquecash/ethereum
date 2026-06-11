/**
 * Phase 3.1: announce on chain A -> relay -> owned on chain B scanner, with the real
 * UABSender / UABReceiver contracts in the loop and the canonical CSAP test-vector
 * recipient. MockWormhole stands in for the guardian hop (signature verification is
 * the core bridge's code, not ours); everything Opaque-owned, including the DKSAP
 * scanner math asserting ownership, runs for real. The Solana half of the matrix
 * lives in solana/tests/integration.ts (genesis-loaded posted-VAA fixture).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { concatHex, pad, getAddress, slice, hexToBytes, bytesToHex } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { network } from "hardhat";

const CHAIN_ETH = 2;
const CHAIN_SOL = 1;
const CONSISTENCY_FINALIZED = 200;
const SOL_EMITTER = ("0x" + "ab".repeat(32)) as `0x${string}`;

// Canonical DKSAP vector (cross-validated against the Rust scanner, the SDK, and the
// Python generator). The recipient's keys derive the same stealth address everywhere.
const vector = JSON.parse(
  readFileSync(new URL("../../circuits/test/test_vectors.json", import.meta.url), "utf8"),
).dksap[0] as {
  viewing_private_key: string;
  spending_public_key: string;
  ephemeral_public_key: string;
  stealth_address: string;
  view_tag: number;
};

const EPHEMERAL = vector.ephemeral_public_key as `0x${string}`;
const STEALTH = getAddress(vector.stealth_address);
const VIEW_TAG_HEX = `0x${vector.view_tag.toString(16).padStart(2, "0")}` as `0x${string}`;

/** The 96-byte canonical payload for the vector payment (spec/payload-format.md). */
function vectorPayload(sourceChain: number): `0x${string}` {
  return concatHex([
    VIEW_TAG_HEX,
    EPHEMERAL,
    pad(STEALTH.toLowerCase() as `0x${string}`, { size: 32 }),
    `0x${sourceChain.toString(16).padStart(4, "0")}` as `0x${string}`,
    "0x00000001", // scheme id 1
    ("0x" + "00".repeat(24)) as `0x${string}`, // empty metadata tail
  ]);
}

/**
 * Receiver-side DKSAP derivation (CSAP 2.3): this IS the scanner ownership check.
 * shared = view_priv * EphPub; s_h = keccak256(shared); stealth = SpendPub + s_h * G.
 */
function scannerOwns(payload: `0x${string}`): boolean {
  const viewTag = hexToBytes(slice(payload, 0, 1))[0]!;
  const ephemeral = hexToBytes(slice(payload, 1, 34));
  const stealth = slice(payload, 46, 66); // low 20 bytes of the address field

  const shared = secp256k1.getSharedSecret(
    hexToBytes(vector.viewing_private_key as `0x${string}`),
    ephemeral,
    true,
  );
  const sH = keccak_256(shared);
  if (sH[0] !== viewTag) return false;
  const sHScalar = BigInt(bytesToHex(sH)) % secp256k1.CURVE.n;
  const stealthPoint = secp256k1.ProjectivePoint.fromHex(
    vector.spending_public_key.slice(2),
  ).add(secp256k1.ProjectivePoint.BASE.multiply(sHScalar));
  const address = bytesToHex(keccak_256(stealthPoint.toRawBytes(false).slice(1)).slice(12));
  return getAddress(address) === getAddress(stealth);
}

describe("Cross-chain announce -> relay -> scan (Phase 3.1)", async function () {
  const { viem } = await network.connect();

  it("Ethereum announce publishes a payload the chain-B scanner owns", async function () {
    const wormhole = await viem.deployContract("MockWormhole" as any);
    const sender = await viem.deployContract("UABSender" as any, [
      wormhole.address,
      CHAIN_ETH,
    ]);

    await sender.write.announceWithRelay([
      1n,
      STEALTH,
      EPHEMERAL,
      VIEW_TAG_HEX, // metadata: view tag only
      CONSISTENCY_FINALIZED,
    ]);

    const published = (await wormhole.read.lastPayload()) as `0x${string}`;
    assert.equal(published.toLowerCase(), vectorPayload(CHAIN_ETH).toLowerCase());
    // The Solana-side reader re-emits these exact bytes; ownership holds on arrival.
    assert.equal(scannerOwns(published), true, "recipient scanner must own the payload");
  });

  it("Solana-origin VAA re-emitted by UABReceiver is owned by the scanner", async function () {
    const wormhole = await viem.deployContract("MockWormhole" as any);
    const [admin] = await viem.getWalletClients();
    const receiver = await viem.deployContract("UABReceiver" as any, [
      wormhole.address,
      admin!.account.address,
      CHAIN_SOL,
      SOL_EMITTER,
    ]);

    const payload = vectorPayload(CHAIN_SOL);
    const vaa = (await wormhole.read.encodeVaa([
      CHAIN_SOL,
      SOL_EMITTER,
      7n,
      payload,
      true,
      "",
    ])) as `0x${string}`;

    // Delivery (the relayer's receiveAnnouncementOnEth path) re-emits the payload.
    await viem.assertions.emitWithArgs(
      receiver.write.receiveAnnouncement([vaa]),
      receiver,
      "CrossChainAnnouncement",
      [CHAIN_SOL, SOL_EMITTER, 7n, payload],
    );

    // Scan: read the re-emitted event back like the EVM adapter does and check ownership.
    const publicClient = await viem.getPublicClient();
    const events = await publicClient.getContractEvents({
      address: receiver.address,
      abi: receiver.abi,
      eventName: "CrossChainAnnouncement",
      fromBlock: 0n,
    });
    assert.equal(events.length, 1);
    const scanned = (events[0] as any).args.payload as `0x${string}`;
    assert.equal(scannerOwns(scanned), true, "recipient scanner must own the payload");

    // A decoy payment to someone else must NOT match.
    const decoy = (("0x" + vector.view_tag.toString(16).padStart(2, "0") + "03" + "22".repeat(32)) +
      vectorPayload(CHAIN_SOL).slice(70)) as `0x${string}`;
    assert.equal(scannerOwns(decoy), false, "decoy must not match");
  });
});
