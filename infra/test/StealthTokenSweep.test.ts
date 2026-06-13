import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSignature } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { network } from "hardhat";

const SWEEP_TYPES = {
  Sweep: [
    { name: "token", type: "address" },
    { name: "owner", type: "address" },
    { name: "destination", type: "address" },
    { name: "value", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const TOKEN_NAME = "Test USD";

describe("StealthTokenSweep", async function () {
  const { viem } = await network.connect();

  async function deploy() {
    const [relayer, recipient] = await viem.getWalletClients();
    const sweep = await viem.deployContract("StealthTokenSweep" as any);
    const token = await viem.deployContract("MockERC20" as any, [TOKEN_NAME, "TUSD", 6]);
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    return { sweep, token, relayer: relayer!, recipient: recipient!, publicClient, chainId };
  }

  type Ctx = Awaited<ReturnType<typeof deploy>>;
  type Signer = { address: `0x${string}`; signTypedData: (a: any) => Promise<`0x${string}`> };

  async function signSweep(
    ctx: Ctx,
    signer: Signer,
    msg: {
      destination: `0x${string}`;
      value: bigint;
      fee: bigint;
      nonce: bigint;
      deadline: bigint;
    },
  ) {
    const message = {
      token: ctx.token.address,
      owner: signer.address,
      destination: msg.destination,
      value: msg.value,
      fee: msg.fee,
      nonce: msg.nonce,
      deadline: msg.deadline,
    };
    const ownerSig = await signer.signTypedData({
      domain: {
        name: "OpaqueStealthTokenSweep",
        version: "1",
        chainId: ctx.chainId,
        verifyingContract: ctx.sweep.address,
      },
      types: SWEEP_TYPES,
      primaryType: "Sweep",
      message,
    });
    return { message, ownerSig };
  }

  async function signPermit(ctx: Ctx, signer: Signer, value: bigint, deadline: bigint) {
    const sig = await signer.signTypedData({
      domain: {
        name: TOKEN_NAME,
        version: "1",
        chainId: ctx.chainId,
        verifyingContract: ctx.token.address,
      },
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message: {
        owner: signer.address,
        spender: ctx.sweep.address,
        value,
        nonce: 0n,
        deadline,
      },
    });
    const { r, s, v, yParity } = parseSignature(sig);
    return { value, deadline, v: Number(v ?? BigInt(yParity) + 27n), r, s };
  }

  it("sweepWithPermit pays the destination net and the relayer the fee, gaslessly", async function () {
    const ctx = await deploy();
    // A one-time stealth key with NO native balance: it only signs offline.
    const stealth = privateKeyToAccount(generatePrivateKey());
    const value = 1_000_000n;
    const fee = 10_000n;
    const destination = ctx.recipient.account.address;

    await ctx.token.write.mint([stealth.address, value]);
    const block = await ctx.publicClient.getBlock();
    const deadline = block.timestamp + 3600n;

    const { message, ownerSig } = await signSweep(ctx, stealth, {
      destination,
      value,
      fee,
      nonce: 0n,
      deadline,
    });
    const permit = await signPermit(ctx, stealth, value, deadline);

    const relayerBefore = await ctx.token.read.balanceOf([ctx.relayer.account.address]);
    await ctx.sweep.write.sweepWithPermit([message, ownerSig, permit], {
      account: ctx.relayer.account,
    });

    assert.equal(await ctx.token.read.balanceOf([destination]), value - fee);
    assert.equal(
      await ctx.token.read.balanceOf([ctx.relayer.account.address]),
      relayerBefore + fee,
    );
    assert.equal(await ctx.token.read.balanceOf([stealth.address]), 0n);
    assert.equal(await ctx.sweep.read.nonces([stealth.address]), 1n);
  });

  it("rejects a replayed authorization", async function () {
    const ctx = await deploy();
    const stealth = privateKeyToAccount(generatePrivateKey());
    const value = 500_000n;
    await ctx.token.write.mint([stealth.address, value * 2n]);
    const block = await ctx.publicClient.getBlock();
    const deadline = block.timestamp + 3600n;
    const { message, ownerSig } = await signSweep(ctx, stealth, {
      destination: ctx.recipient.account.address,
      value,
      fee: 0n,
      nonce: 0n,
      deadline,
    });
    const permit = await signPermit(ctx, stealth, value, deadline);
    await ctx.sweep.write.sweepWithPermit([message, ownerSig, permit], {
      account: ctx.relayer.account,
    });
    await assert.rejects(
      ctx.sweep.write.sweepWithPermit([message, ownerSig, permit], {
        account: ctx.relayer.account,
      }),
      /BadNonce/,
    );
  });

  it("rejects a tampered destination, an expired deadline, and fee > value", async function () {
    const ctx = await deploy();
    const stealth = privateKeyToAccount(generatePrivateKey());
    const value = 200_000n;
    await ctx.token.write.mint([stealth.address, value]);
    const block = await ctx.publicClient.getBlock();
    const deadline = block.timestamp + 3600n;

    // Sign for one destination, submit with another -> recovered signer != owner.
    const signed = await signSweep(ctx, stealth, {
      destination: ctx.recipient.account.address,
      value,
      fee: 0n,
      nonce: 0n,
      deadline,
    });
    const tampered = { ...signed.message, destination: ctx.relayer.account.address };
    await assert.rejects(
      ctx.sweep.write.sweep([tampered, signed.ownerSig], { account: ctx.relayer.account }),
      /InvalidSignature/,
    );

    // Expired.
    const expired = await signSweep(ctx, stealth, {
      destination: ctx.recipient.account.address,
      value,
      fee: 0n,
      nonce: 0n,
      deadline: block.timestamp - 1n,
    });
    await assert.rejects(
      ctx.sweep.write.sweep([expired.message, expired.ownerSig], { account: ctx.relayer.account }),
      /Expired/,
    );

    // Fee greater than value.
    const greedy = await signSweep(ctx, stealth, {
      destination: ctx.recipient.account.address,
      value,
      fee: value + 1n,
      nonce: 0n,
      deadline,
    });
    await assert.rejects(
      ctx.sweep.write.sweep([greedy.message, greedy.ownerSig], { account: ctx.relayer.account }),
      /FeeTooHigh/,
    );
  });

  it("sweep spends an allowance the owner already granted", async function () {
    const ctx = await deploy();
    // The owner here is a funded test wallet that pre-approves the forwarder.
    const owner = ctx.recipient;
    const value = 300_000n;
    const fee = 5_000n;
    await ctx.token.write.mint([owner.account.address, value]);
    await ctx.token.write.approve([ctx.sweep.address, value], { account: owner.account });

    const block = await ctx.publicClient.getBlock();
    const deadline = block.timestamp + 3600n;
    const { message, ownerSig } = await signSweep(
      ctx,
      { address: owner.account.address, signTypedData: (a) => owner.signTypedData(a) },
      {
        destination: ctx.relayer.account.address,
        value,
        fee,
        nonce: 0n,
        deadline,
      },
    );

    const relayerBefore = await ctx.token.read.balanceOf([ctx.relayer.account.address]);
    await ctx.sweep.write.sweep([message, ownerSig], { account: ctx.relayer.account });
    assert.equal(
      await ctx.token.read.balanceOf([ctx.relayer.account.address]),
      relayerBefore + value, // destination is the relayer here, so it receives net + fee
    );
    assert.equal(await ctx.token.read.balanceOf([owner.account.address]), 0n);
  });
});
