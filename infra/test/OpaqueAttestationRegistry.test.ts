import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { keccak256, toHex } from "viem";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const ZERO32 = ("0x" + "00".repeat(32)) as `0x${string}`;
const STEALTH_HASH = keccak256(toHex("stealth-recipient-1"));
const DATA = ("0x" + "ab".repeat(8)) as `0x${string}`; // 8-byte payload

describe("OpaqueAttestationRegistry", () => {
  async function deployFixture(revocable = true) {
    const { viem } = await hre.network.connect();
    const [authority, delegate, other] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const schemaRegistry = await viem.deployContract("OpaqueSchemaRegistry" as any);
    const attestations = await viem.deployContract("OpaqueAttestationRegistry" as any, [
      schemaRegistry.address,
    ]);

    await schemaRegistry.write.registerSchema(["badge", "uint8 level", revocable, ZERO_ADDR, 0n], {
      account: authority.account,
    });
    const schemaId = await schemaRegistry.read.computeSchemaId([authority.account.address, "badge"]);

    return { schemaRegistry, attestations, schemaId, authority, delegate, other, publicClient };
  }

  // Issues an attestation and returns its deterministic uid.
  async function attestAndUid(ctx: any, issuerAccount: any) {
    const { attestations, schemaId, publicClient } = ctx;
    const hash = await attestations.write.attest([schemaId, STEALTH_HASH, DATA, 0n, ZERO32], {
      account: issuerAccount,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return attestations.read.computeUid([schemaId, issuerAccount.address, STEALTH_HASH, receipt.blockNumber]);
  }

  it("authority can attest; record is valid and queryable", async () => {
    const ctx = await deployFixture();
    const uid = await attestAndUid(ctx, ctx.authority.account);

    assert.ok(await ctx.attestations.read.exists([uid]), "attestation should exist");
    assert.equal(await ctx.attestations.read.isValid([uid]), true);

    const record = (await ctx.attestations.read.getAttestation([uid])) as any[];
    // returns: schemaId, issuer, stealthAddressHash, createdAt, expiration, revocation, refUid, data
    assert.equal(record[0], ctx.schemaId);
    assert.equal(record[6], ZERO32);
  });

  it("a delegate can attest; an unauthorized account cannot", async () => {
    const ctx = await deployFixture();

    await assert.rejects(
      attestAndUid(ctx, ctx.other.account),
      "unauthorized issuer should revert"
    );

    await ctx.schemaRegistry.write.addDelegate([ctx.schemaId, ctx.delegate.account.address], {
      account: ctx.authority.account,
    });
    const uid = await attestAndUid(ctx, ctx.delegate.account);
    assert.ok(await ctx.attestations.read.exists([uid]), "delegate attestation should exist");
  });

  it("attesting on a deprecated schema reverts", async () => {
    const ctx = await deployFixture();
    await ctx.schemaRegistry.write.deprecateSchema([ctx.schemaId], { account: ctx.authority.account });
    await assert.rejects(attestAndUid(ctx, ctx.authority.account), "inactive schema should revert");
  });

  it("authority can revoke; data is preserved and the record becomes invalid", async () => {
    const ctx = await deployFixture();
    const uid = await attestAndUid(ctx, ctx.authority.account);

    await ctx.attestations.write.revoke([uid], { account: ctx.authority.account });
    assert.equal(await ctx.attestations.read.isValid([uid]), false);

    const record = (await ctx.attestations.read.getAttestation([uid])) as any[];
    assert.notEqual(record[5], 0n, "revocationBlock should be set");
    assert.equal(record[7], DATA, "data should be preserved after revoke");
  });

  it("only the authority may revoke (delegates cannot)", async () => {
    const ctx = await deployFixture();
    await ctx.schemaRegistry.write.addDelegate([ctx.schemaId, ctx.delegate.account.address], {
      account: ctx.authority.account,
    });
    const uid = await attestAndUid(ctx, ctx.delegate.account);

    await assert.rejects(
      ctx.attestations.write.revoke([uid], { account: ctx.delegate.account }),
      "delegate revoke should revert"
    );
  });

  it("cannot revoke under a non-revocable schema", async () => {
    const ctx = await deployFixture(false); // revocable = false
    const uid = await attestAndUid(ctx, ctx.authority.account);
    await assert.rejects(
      ctx.attestations.write.revoke([uid], { account: ctx.authority.account }),
      "non-revocable revoke should revert"
    );
  });
});
