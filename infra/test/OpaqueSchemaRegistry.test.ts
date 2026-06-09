import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { getAddress } from "viem";

describe("OpaqueSchemaRegistry", () => {
  async function deployFixture() {
    const { viem } = await hre.network.connect();
    const [authority, delegate, other] = await viem.getWalletClients();
    const registry = await viem.deployContract("OpaqueSchemaRegistry" as any);
    return { registry, authority, delegate, other };
  }

  const NAME = "kyc-tier";
  const FIELDS = "uint8 tier,uint64 issuedAt";

  it("registers a schema and exposes its fields", async () => {
    const { registry, authority } = await deployFixture();
    await registry.write.registerSchema([NAME, FIELDS, true, getAddress("0x0000000000000000000000000000000000000000"), 0n], {
      account: authority.account,
    });

    const schemaId = await registry.read.computeSchemaId([authority.account.address, NAME]);
    assert.ok(await registry.read.exists([schemaId]), "schema should exist");
    assert.equal(getAddress(await registry.read.getAuthority([schemaId])), getAddress(authority.account.address));
    assert.equal(await registry.read.isRevocable([schemaId]), true);
    assert.equal(await registry.read.isActive([schemaId]), true);
    // authority is implicitly an authorized issuer
    assert.equal(await registry.read.isAuthorizedIssuer([schemaId, authority.account.address]), true);
  });

  it("rejects duplicate registration of the same authority+name", async () => {
    const { registry, authority } = await deployFixture();
    await registry.write.registerSchema([NAME, FIELDS, true, getAddress("0x0000000000000000000000000000000000000000"), 0n], {
      account: authority.account,
    });
    await assert.rejects(
      registry.write.registerSchema([NAME, FIELDS, true, getAddress("0x0000000000000000000000000000000000000000"), 0n], {
        account: authority.account,
      }),
      "duplicate schema should revert"
    );
  });

  it("lets only the authority add/remove delegates, and authorizes them", async () => {
    const { registry, authority, delegate, other } = await deployFixture();
    await registry.write.registerSchema([NAME, FIELDS, true, getAddress("0x0000000000000000000000000000000000000000"), 0n], {
      account: authority.account,
    });
    const schemaId = await registry.read.computeSchemaId([authority.account.address, NAME]);

    // non-authority cannot add a delegate
    await assert.rejects(
      registry.write.addDelegate([schemaId, delegate.account.address], { account: other.account }),
      "non-authority addDelegate should revert"
    );

    await registry.write.addDelegate([schemaId, delegate.account.address], { account: authority.account });
    assert.equal(await registry.read.isAuthorizedIssuer([schemaId, delegate.account.address]), true);
    const delegates = await registry.read.getDelegates([schemaId]);
    assert.equal(delegates.length, 1);

    await registry.write.removeDelegate([schemaId, delegate.account.address], { account: authority.account });
    assert.equal(await registry.read.isAuthorizedIssuer([schemaId, delegate.account.address]), false);
  });

  it("deprecation deactivates the schema and is authority-only", async () => {
    const { registry, authority, other } = await deployFixture();
    await registry.write.registerSchema([NAME, FIELDS, true, getAddress("0x0000000000000000000000000000000000000000"), 0n], {
      account: authority.account,
    });
    const schemaId = await registry.read.computeSchemaId([authority.account.address, NAME]);

    await assert.rejects(
      registry.write.deprecateSchema([schemaId], { account: other.account }),
      "non-authority deprecate should revert"
    );

    await registry.write.deprecateSchema([schemaId], { account: authority.account });
    assert.equal(await registry.read.isActive([schemaId]), false);
  });

  it("rejects an over-long name", async () => {
    const { registry, authority } = await deployFixture();
    const longName = "x".repeat(65);
    await assert.rejects(
      registry.write.registerSchema([longName, FIELDS, true, getAddress("0x0000000000000000000000000000000000000000"), 0n], {
        account: authority.account,
      }),
      "name > 64 bytes should revert"
    );
  });
});
