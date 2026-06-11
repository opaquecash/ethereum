import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseEther } from "viem";
import { network } from "hardhat";

const targetAbi = parseAbi([
  "function poke(uint256 value)",
  "function explode()",
]);

const X25519 = ("0x" + "ab".repeat(32)) as `0x${string}`;
const JOB_ID = ("0x" + "01".repeat(32)) as `0x${string}`;
const FEE = parseEther("0.001");
const STAKE = parseEther("0.05");

function payloadFor(target: `0x${string}`, data: `0x${string}`): `0x${string}` {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [target, data]),
  );
}

describe("RelayerRegistry", async function () {
  const { viem } = await network.connect();

  async function deploy() {
    const [creator, relayer, other] = await viem.getWalletClients();
    const registry = await viem.deployContract("RelayerRegistry" as any);
    const target = await viem.deployContract("MockJobTarget" as any);
    const publicClient = await viem.getPublicClient();
    return { registry, target, creator: creator!, relayer: relayer!, other: other!, publicClient };
  }

  /** Register `relayer` and create the standard job from `creator`. */
  async function setupJob(ctx: Awaited<ReturnType<typeof deploy>>, deadlineOffset = 3600) {
    const { registry, target, relayer, publicClient } = ctx;
    await registry.write.register([X25519, "http://localhost:8787"], {
      account: relayer.account,
      value: STAKE,
    });
    const data = encodeFunctionData({ abi: targetAbi, functionName: "poke", args: [42n] });
    const block = await publicClient.getBlock();
    const deadline = block.timestamp + BigInt(deadlineOffset);
    await registry.write.createJob([JOB_ID, payloadFor(target.address, data), deadline], {
      value: FEE,
    });
    return { data, deadline };
  }

  describe("staking", function () {
    it("registers with minimum stake and tracks free stake", async function () {
      const ctx = await deploy();
      await assert.rejects(
        ctx.registry.write.register([X25519, ""], { value: parseEther("0.001") }),
        /InsufficientStake/,
      );
      await ctx.registry.write.register([X25519, "http://x"], { value: STAKE });
      assert.equal(await ctx.registry.read.freeStakeOf([ctx.creator.account.address]), STAKE);
    });

    it("enforces the unstake cooldown", async function () {
      const ctx = await deploy();
      await ctx.registry.write.register([X25519, ""], { value: STAKE });
      await ctx.registry.write.requestUnstake([STAKE]);
      await assert.rejects(ctx.registry.write.withdraw(), /CooldownActive/);
      // After the request, nothing is free to bond.
      assert.equal(await ctx.registry.read.freeStakeOf([ctx.creator.account.address]), 0n);
    });
  });

  describe("job lifecycle", function () {
    it("create -> accept -> submit executes the payload and pays the fee", async function () {
      const ctx = await deploy();
      const { data } = await setupJob(ctx);

      await ctx.registry.write.acceptJob([JOB_ID], { account: ctx.relayer.account });
      // Bond reduces free stake by the fee.
      assert.equal(
        await ctx.registry.read.freeStakeOf([ctx.relayer.account.address]),
        STAKE - FEE,
      );

      const before = await ctx.publicClient.getBalance({
        address: ctx.relayer.account.address,
      });
      const hash = await ctx.registry.write.submitJob([JOB_ID, ctx.target.address, data], {
        account: ctx.relayer.account,
      });
      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await ctx.publicClient.getBalance({ address: ctx.relayer.account.address });

      // Inner call executed with the escrow as caller.
      assert.equal(await ctx.target.read.pokes(), 1n);
      assert.equal(
        (await ctx.target.read.lastCaller() as string).toLowerCase(),
        ctx.registry.address.toLowerCase(),
      );
      // Fee paid, bond released.
      assert.equal(after - before, FEE - gas);
      assert.equal(await ctx.registry.read.freeStakeOf([ctx.relayer.account.address]), STAKE);
    });

    it("rejects wrong payloads, foreign submitters, and double-submit", async function () {
      const ctx = await deploy();
      const { data } = await setupJob(ctx);
      await ctx.registry.write.acceptJob([JOB_ID], { account: ctx.relayer.account });

      const wrong = encodeFunctionData({ abi: targetAbi, functionName: "poke", args: [43n] });
      await assert.rejects(
        ctx.registry.write.submitJob([JOB_ID, ctx.target.address, wrong], {
          account: ctx.relayer.account,
        }),
        /PayloadMismatch/,
      );
      await assert.rejects(
        ctx.registry.write.submitJob([JOB_ID, ctx.target.address, data], {
          account: ctx.other.account,
        }),
        /NotJobRelayer/,
      );
      await ctx.registry.write.submitJob([JOB_ID, ctx.target.address, data], {
        account: ctx.relayer.account,
      });
      await assert.rejects(
        ctx.registry.write.submitJob([JOB_ID, ctx.target.address, data], {
          account: ctx.relayer.account,
        }),
        /JobClosed/,
      );
    });

    it("bubbles inner-call failure without paying or closing unfairly", async function () {
      const ctx = await deploy();
      const { registry, target, relayer, publicClient } = ctx;
      await registry.write.register([X25519, ""], { account: relayer.account, value: STAKE });
      const data = encodeFunctionData({ abi: targetAbi, functionName: "explode" });
      const block = await publicClient.getBlock();
      await registry.write.createJob(
        [JOB_ID, payloadFor(target.address, data), block.timestamp + 3600n],
        { value: FEE },
      );
      await registry.write.acceptJob([JOB_ID], { account: relayer.account });
      await assert.rejects(
        registry.write.submitJob([JOB_ID, target.address, data], { account: relayer.account }),
        /InnerCallFailed/,
      );
      // Revert rolled the whole submit back: still accepted, bond still held.
      assert.equal(await registry.read.freeStakeOf([relayer.account.address]), STAKE - FEE);
    });

    it("requires registration and free stake to accept", async function () {
      const ctx = await deploy();
      const { registry, target, publicClient, other } = ctx;
      const data = encodeFunctionData({ abi: targetAbi, functionName: "poke", args: [1n] });
      const block = await publicClient.getBlock();
      await registry.write.createJob(
        [JOB_ID, payloadFor(target.address, data), block.timestamp + 3600n],
        { value: FEE },
      );
      await assert.rejects(
        registry.write.acceptJob([JOB_ID], { account: other.account }),
        /NotRegistered/,
      );
    });
  });

  describe("slash and cancel", function () {
    it("slashes an accepted, unsubmitted job after the deadline", async function () {
      const ctx = await deploy();
      await setupJob(ctx, 60);
      await ctx.registry.write.acceptJob([JOB_ID], { account: ctx.relayer.account });

      await assert.rejects(ctx.registry.write.slashJob([JOB_ID]), /DeadlineNotReached/);

      const testClient = await viem.getTestClient();
      await testClient.increaseTime({ seconds: 120 });
      await testClient.mine({ blocks: 1 });

      const before = await ctx.publicClient.getBalance({ address: ctx.creator.account.address });
      const hash = await ctx.registry.write.slashJob([JOB_ID]);
      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await ctx.publicClient.getBalance({ address: ctx.creator.account.address });

      // Creator receives bond + fee refund; relayer stake shrank by the bond.
      assert.equal(after - before, FEE * 2n - gas);
      assert.equal(
        await ctx.registry.read.freeStakeOf([ctx.relayer.account.address]),
        STAKE - FEE,
      );
      // Too late to submit now.
      const data = encodeFunctionData({ abi: targetAbi, functionName: "poke", args: [42n] });
      await assert.rejects(
        ctx.registry.write.submitJob([JOB_ID, ctx.target.address, data], {
          account: ctx.relayer.account,
        }),
        /JobClosed/,
      );
    });

    it("cancels an unaccepted job after the deadline", async function () {
      const ctx = await deploy();
      await setupJob(ctx, 60);
      await assert.rejects(ctx.registry.write.cancelJob([JOB_ID]), /DeadlineNotReached/);

      const testClient = await viem.getTestClient();
      await testClient.increaseTime({ seconds: 120 });
      await testClient.mine({ blocks: 1 });

      const before = await ctx.publicClient.getBalance({ address: ctx.creator.account.address });
      const hash = await ctx.registry.write.cancelJob([JOB_ID]);
      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await ctx.publicClient.getBalance({ address: ctx.creator.account.address });
      assert.equal(after - before, FEE - gas);
    });

    it("blocks accepts after the deadline", async function () {
      const ctx = await deploy();
      await setupJob(ctx, 60);
      const testClient = await viem.getTestClient();
      await testClient.increaseTime({ seconds: 120 });
      await testClient.mine({ blocks: 1 });
      await assert.rejects(
        ctx.registry.write.acceptJob([JOB_ID], { account: ctx.relayer.account }),
        /DeadlinePassed/,
      );
    });
  });
});
