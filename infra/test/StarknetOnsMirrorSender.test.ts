/**
 * StarknetOnsMirrorSender: the Ethereum -> Starknet leg of the ONS mirror.
 *
 * Validates that the sender produces exactly the felt payload the Cairo `OpaqueNameMirror`
 * consumer deserializes. The inputs and expected 11-felt layout mirror the Starknet-side
 * snforge test (opaquecash/starknet, contracts/ons_mirror), so the two halves are proven
 * wire-compatible offline — the live sequencer hop is the only untested step and needs L1
 * funds. MockStarknetMessaging stands in for the Starknet Core Contract.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress } from "viem";

// Same fixture as the Cairo snforge test.
const NAME_HASH = "0x0a11ce0000000000000000000000000000000000000000000000000000000001" as const;
const SPEND_X = ("0x" + "11".repeat(32)) as `0x${string}`;
const VIEW_X = ("0x" + "22".repeat(32)) as `0x${string}`;
const ETH_OWNER = getAddress("0x000000000000000000000000000000000000abcd");
const L2_MIRROR = 0x1d0821469d516a81cddfd6ee6d88b5073657db561d9de2f6e723649ad4ff14an;
const HANDLE_MIRROR_SELECTOR =
  0x360577db805f50b45e209751e6dffb846a56316ba61d4405e9f32514ae003cen;

const LOW_128 = (1n << 128n) - 1n;
const lo = (v: bigint) => v & LOW_128;
const hi = (v: bigint) => v >> 128n;

describe("StarknetOnsMirrorSender", async function () {
  const { viem } = await network.connect();

  async function deploy() {
    const [authority, other] = await viem.getWalletClients();
    const core = await viem.deployContract("MockStarknetMessaging");
    const sender = await viem.deployContract("StarknetOnsMirrorSender", [
      core.address,
      L2_MIRROR,
      authority.account.address,
    ]);
    return { core, sender, authority, other };
  }

  it("encodes an upsert to the exact Cairo felt layout", async function () {
    const { core, sender } = await deploy();

    await sender.write.mirrorUpsert([NAME_HASH, 2, SPEND_X, 3, VIEW_X, ETH_OWNER]);

    assert.equal(await core.read.lastToAddress(), L2_MIRROR);
    assert.equal(await core.read.lastSelector(), HANDLE_MIRROR_SELECTOR);

    const payload = (await core.read.getLastPayload()) as bigint[];
    assert.deepEqual(payload, [
      1n, // sequence (first call)
      1n, // action = upsert
      lo(BigInt(NAME_HASH)),
      hi(BigInt(NAME_HASH)),
      2n, // spend prefix
      lo(BigInt(SPEND_X)),
      hi(BigInt(SPEND_X)),
      3n, // view prefix
      lo(BigInt(VIEW_X)),
      hi(BigInt(VIEW_X)),
      BigInt(ETH_OWNER),
    ]);
  });

  it("encodes a revoke with zeroed keys and action 2", async function () {
    const { core, sender } = await deploy();

    await sender.write.mirrorRevoke([NAME_HASH]);

    const payload = (await core.read.getLastPayload()) as bigint[];
    assert.deepEqual(payload, [
      1n, // sequence
      2n, // action = revoke
      lo(BigInt(NAME_HASH)),
      hi(BigInt(NAME_HASH)),
      0n, 0n, 0n, 0n, 0n, 0n, 0n, // keys + eth_owner zeroed
    ]);
  });

  it("increments the sequence monotonically across messages", async function () {
    const { core, sender } = await deploy();

    await sender.write.mirrorUpsert([NAME_HASH, 2, SPEND_X, 3, VIEW_X, ETH_OWNER]);
    assert.equal((await core.read.getLastPayload())[0], 1n);
    await sender.write.mirrorRevoke([NAME_HASH]);
    assert.equal((await core.read.getLastPayload())[0], 2n);
    await sender.write.mirrorUpsert([NAME_HASH, 2, SPEND_X, 3, VIEW_X, ETH_OWNER]);
    assert.equal((await core.read.getLastPayload())[0], 3n);
    assert.equal(await sender.read.sequence(), 3n);
  });

  it("rejects a caller that is not the authority", async function () {
    const { sender, other } = await deploy();
    await assert.rejects(
      sender.write.mirrorUpsert([NAME_HASH, 2, SPEND_X, 3, VIEW_X, ETH_OWNER], {
        account: other.account,
      }),
      /NotAuthority/,
    );
  });

  it("transfers authority and enforces the new one", async function () {
    const { sender, authority, other } = await deploy();
    await sender.write.transferAuthority([other.account.address]);
    assert.equal(
      getAddress(await sender.read.authority()),
      getAddress(other.account.address),
    );
    // The old authority can no longer publish.
    await assert.rejects(
      sender.write.mirrorRevoke([NAME_HASH], { account: authority.account }),
      /NotAuthority/,
    );
    // The new one can.
    await sender.write.mirrorRevoke([NAME_HASH], { account: other.account });
  });

  it("forwards the L1->L2 fee to the core contract", async function () {
    const { core, sender } = await deploy();
    await sender.write.mirrorRevoke([NAME_HASH], { value: 1234n });
    assert.equal(await core.read.lastValue(), 1234n);
  });
});
