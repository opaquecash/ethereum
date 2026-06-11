import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { concatHex, pad, getAddress } from "viem";
import { network } from "hardhat";

const SOURCE_CHAIN_ETH = 2; // Wormhole chain id for Ethereum
const SOURCE_CHAIN_SOL = 1; // Wormhole chain id for Solana
const CONSISTENCY_FINALIZED = 200;

// 33-byte compressed ephemeral key, a 20-byte stealth address, view tag + 4 metadata bytes.
const EPHEMERAL = ("0x02" + "11".repeat(32)) as `0x${string}`;
const STEALTH = "0x0000000000000000000000000000000000000001" as const;
const VIEW_TAG = "0x09";
const META = "0x09deadbeef" as `0x${string}`; // view tag 0x09, tail deadbeef

// A 32-byte Solana emitter (stand-in for the uab emitter PDA).
const SOL_EMITTER = ("0x" + "ab".repeat(32)) as `0x${string}`;

// The canonical 96-byte payload for the fixtures above (spec/payload-format.md).
function expectedPayload(): `0x${string}` {
  return concatHex([
    VIEW_TAG as `0x${string}`, // [0] view tag
    EPHEMERAL, // [1..34) ephemeral pubkey (33)
    pad(STEALTH, { size: 32 }), // [34..66) stealth, left-padded
    "0x0002", // [66..68) source chain id = 2
    "0x00000001", // [68..72) scheme id = 1
    pad("0xdeadbeef", { size: 24, dir: "right" }), // [72..96) metadata tail, right-padded
  ]);
}

describe("UABSender", async function () {
  const { viem } = await network.connect();

  async function deploy() {
    const wormhole = await viem.deployContract("MockWormhole" as any);
    const sender = await viem.deployContract("UABSender" as any, [
      wormhole.address,
      SOURCE_CHAIN_ETH,
    ]);
    return { wormhole, sender };
  }

  it("emits the legacy Announcement and publishes the 96-byte payload", async function () {
    const { wormhole, sender } = await deploy();
    const [caller] = await viem.getWalletClients();

    await viem.assertions.emitWithArgs(
      sender.write.announceWithRelay([1n, getAddress(STEALTH), EPHEMERAL, META, CONSISTENCY_FINALIZED]),
      sender,
      "Announcement",
      [1n, getAddress(STEALTH), getAddress(caller!.account.address), EPHEMERAL, META],
    );

    const published = (await wormhole.read.lastPayload()) as string;
    assert.equal(published.toLowerCase(), expectedPayload().toLowerCase(), "payload layout mismatch");

    const consistency = await wormhole.read.lastConsistency();
    assert.equal(Number(consistency), CONSISTENCY_FINALIZED);
  });

  it("rejects a wrong-length ephemeral key", async function () {
    const { sender } = await deploy();
    await viem.assertions.revertWithCustomError(
      sender.write.announceWithRelay([1n, getAddress(STEALTH), "0x0204", META, CONSISTENCY_FINALIZED]),
      sender,
      "EphemeralKeyLength",
    );
  });

  it("rejects empty metadata (no view tag)", async function () {
    const { sender } = await deploy();
    await viem.assertions.revertWithCustomError(
      sender.write.announceWithRelay([1n, getAddress(STEALTH), EPHEMERAL, "0x", CONSISTENCY_FINALIZED]),
      sender,
      "MissingViewTag",
    );
  });

  it("rejects metadata longer than the 24-byte v1 budget", async function () {
    const { sender } = await deploy();
    const tooLong = ("0x09" + "cc".repeat(25)) as `0x${string}`; // view tag + 25 tail bytes
    await viem.assertions.revertWithCustomError(
      sender.write.announceWithRelay([1n, getAddress(STEALTH), EPHEMERAL, tooLong, CONSISTENCY_FINALIZED]),
      sender,
      "MetadataTooLong",
    );
  });

  it("rejects a scheme id that does not fit in uint32", async function () {
    const { sender } = await deploy();
    await viem.assertions.revertWithCustomError(
      sender.write.announceWithRelay([2n ** 33n, getAddress(STEALTH), EPHEMERAL, META, CONSISTENCY_FINALIZED]),
      sender,
      "SchemeIdTooLarge",
    );
  });

  it("refunds any overpayment above the Wormhole message fee", async function () {
    const { wormhole, sender } = await deploy();
    await wormhole.write.setFee([100n]);
    const publicClient = await viem.getPublicClient();

    // Overpay by 1 ETH; the contract must end the tx holding nothing.
    await sender.write.announceWithRelay(
      [1n, getAddress(STEALTH), EPHEMERAL, META, CONSISTENCY_FINALIZED],
      { value: 10n ** 18n + 100n },
    );
    const locked = await publicClient.getBalance({ address: sender.address });
    assert.equal(locked, 0n, "no ether may remain locked in UABSender");
    const feePaid = await publicClient.getBalance({ address: wormhole.address });
    assert.equal(feePaid, 100n, "exactly the fee goes to the core bridge");
  });

  it("requires the Wormhole message fee", async function () {
    const { wormhole, sender } = await deploy();
    await wormhole.write.setFee([1000n]);
    await viem.assertions.revertWithCustomError(
      sender.write.announceWithRelay([1n, getAddress(STEALTH), EPHEMERAL, META, CONSISTENCY_FINALIZED]),
      sender,
      "InsufficientFee",
    );
    // Paying the fee succeeds.
    const tx = await sender.write.announceWithRelay(
      [1n, getAddress(STEALTH), EPHEMERAL, META, CONSISTENCY_FINALIZED],
      { value: 1000n },
    );
    assert.ok(tx);
  });
});

describe("UABReceiver", async function () {
  const { viem } = await network.connect();

  async function deploy() {
    const wormhole = await viem.deployContract("MockWormhole" as any);
    const [admin] = await viem.getWalletClients();
    const receiver = await viem.deployContract("UABReceiver" as any, [
      wormhole.address,
      admin!.account.address,
      SOURCE_CHAIN_SOL,
      SOL_EMITTER,
    ]);
    return { wormhole, receiver };
  }

  async function makeVaa(
    wormhole: any,
    opts: { chain?: number; emitter?: `0x${string}`; sequence?: bigint; payload?: `0x${string}`; valid?: boolean },
  ) {
    return wormhole.read.encodeVaa([
      opts.chain ?? SOURCE_CHAIN_SOL,
      opts.emitter ?? SOL_EMITTER,
      opts.sequence ?? 0n,
      opts.payload ?? expectedPayload(),
      opts.valid ?? true,
      "",
    ]);
  }

  it("re-emits CrossChainAnnouncement for a valid VAA from the trusted emitter", async function () {
    const { wormhole, receiver } = await deploy();
    const vaa = (await makeVaa(wormhole, { sequence: 7n })) as `0x${string}`;

    await viem.assertions.emitWithArgs(
      receiver.write.receiveAnnouncement([vaa]),
      receiver,
      "CrossChainAnnouncement",
      [SOURCE_CHAIN_SOL, SOL_EMITTER, 7n, expectedPayload()],
    );
  });

  it("rejects an invalid VAA", async function () {
    const { wormhole, receiver } = await deploy();
    const vaa = (await makeVaa(wormhole, { valid: false })) as `0x${string}`;
    await viem.assertions.revertWithCustomError(receiver.write.receiveAnnouncement([vaa]), receiver, "InvalidVAA");
  });

  it("rejects an unknown emitter", async function () {
    const { wormhole, receiver } = await deploy();
    const wrong = ("0x" + "cd".repeat(32)) as `0x${string}`;
    const vaa = (await makeVaa(wormhole, { emitter: wrong })) as `0x${string}`;
    await viem.assertions.revertWithCustomError(receiver.write.receiveAnnouncement([vaa]), receiver, "UnknownEmitter");
  });

  it("rejects a wrong source chain", async function () {
    const { wormhole, receiver } = await deploy();
    const vaa = (await makeVaa(wormhole, { chain: 5 })) as `0x${string}`;
    await viem.assertions.revertWithCustomError(receiver.write.receiveAnnouncement([vaa]), receiver, "UnknownEmitter");
  });

  it("rejects a payload that is not 96 bytes", async function () {
    const { wormhole, receiver } = await deploy();
    const vaa = (await makeVaa(wormhole, { payload: "0x1234" })) as `0x${string}`;
    await viem.assertions.revertWithCustomError(receiver.write.receiveAnnouncement([vaa]), receiver, "BadPayloadLength");
  });

  it("rejects a replayed VAA", async function () {
    const { wormhole, receiver } = await deploy();
    const vaa = (await makeVaa(wormhole, { sequence: 1n })) as `0x${string}`;
    await receiver.write.receiveAnnouncement([vaa]);
    await viem.assertions.revertWithCustomError(receiver.write.receiveAnnouncement([vaa]), receiver, "AlreadyConsumed");
  });

  it("lets the admin reconfigure the trusted emitter and rejects non-admins", async function () {
    const { receiver } = await deploy();
    const [, stranger] = await viem.getWalletClients();
    const newEmitter = ("0x" + "12".repeat(32)) as `0x${string}`;

    await receiver.write.setExpectedEmitter([SOURCE_CHAIN_SOL, newEmitter]);
    assert.equal((await receiver.read.expectedEmitter()).toLowerCase(), newEmitter.toLowerCase());

    await viem.assertions.revertWithCustomError(
      receiver.write.setExpectedEmitter([SOURCE_CHAIN_SOL, SOL_EMITTER], {
        account: stranger!.account,
      }),
      receiver,
      "Unauthorized",
    );
  });
});
