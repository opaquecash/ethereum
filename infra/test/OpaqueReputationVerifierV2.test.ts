import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { getAddress, keccak256, toHex } from "viem";

const PROOF = {
  a: [1n, 2n] as [bigint, bigint],
  b: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]],
  c: [7n, 8n] as [bigint, bigint],
};

describe("OpaqueReputationVerifierV2", () => {
  async function deployFixture() {
    const { viem } = await hre.network.connect();
    const [admin, user, other] = await viem.getWalletClients();
    const mockVerifier = await viem.deployContract("MockGroth16VerifierV2" as any);
    const verifier = await viem.deployContract("OpaqueReputationVerifierV2" as any, [
      mockVerifier.address,
      admin.account.address,
    ]);
    return { viem, verifier, mockVerifier, admin, user, other };
  }

  it("deploys with the correct admin and verifier", async () => {
    const { verifier, mockVerifier, admin } = await deployFixture();
    assert.equal(getAddress(await verifier.read.admin()), getAddress(admin.account.address));
    assert.equal(getAddress(await verifier.read.groth16Verifier()), getAddress(mockVerifier.address));
  });

  it("admin can update a merkle root; non-admin cannot", async () => {
    const { verifier, admin, user } = await deployFixture();
    const root = keccak256(toHex("v2-root"));
    await verifier.write.updateMerkleRoot([root], { account: admin.account });
    assert.ok(await verifier.read.isRootValid([root]));
    await assert.rejects(
      verifier.write.updateMerkleRoot([keccak256(toHex("x"))], { account: user.account }),
      "non-admin should not update roots"
    );
  });

  it("binds the proof to a live registered schema when a registry is configured (OPQ-006)", async () => {
    const { viem, verifier, admin, user } = await deployFixture();
    const registry = await viem.deployContract("MockSchemaRegistry" as any);
    const root = keccak256(toHex("v2-root"));
    await verifier.write.updateMerkleRoot([root], { account: admin.account });

    // Default: no registry configured, so a proof for any attestationId is accepted.
    await verifier.write.verifyReputation([PROOF, root, 42n, 1n, 1001n], { account: user.account });

    // Configure the registry (admin-only) and make it report the schema inactive.
    await assert.rejects(
      verifier.write.setSchemaRegistry([registry.address], { account: user.account }),
      "non-admin cannot set the schema registry"
    );
    await verifier.write.setSchemaRegistry([registry.address], { account: admin.account });
    await registry.write.setActive([false]);

    // A proof whose attestation_id is not a live schema is now rejected before the pairing.
    await assert.rejects(
      verifier.write.verifyReputation([PROOF, root, 42n, 2n, 1002n], { account: user.account }),
      "unregistered schema must be rejected"
    );
    assert.equal(await verifier.read.verifyReputationView([PROOF, root, 42n, 2n, 1002n]), false);

    // Once the schema is live again, the proof verifies.
    await registry.write.setActive([true]);
    await verifier.write.verifyReputation([PROOF, root, 42n, 3n, 1003n], { account: user.account });
    assert.ok(await verifier.read.usedNullifiers([1003n]));
  });

  it("verifies a V2 proof and consumes the nullifier hash", async () => {
    const { verifier, admin, user } = await deployFixture();
    const root = keccak256(toHex("v2-root"));
    await verifier.write.updateMerkleRoot([root], { account: admin.account });

    const attestationId = 42n;
    const externalNullifier = 1001n;
    const nullifierHash = 7777n;

    await verifier.write.verifyReputation([PROOF, root, attestationId, externalNullifier, nullifierHash], {
      account: user.account,
    });
    assert.ok(await verifier.read.usedNullifiers([nullifierHash]), "nullifier hash should be consumed");

    // reuse rejected
    await assert.rejects(
      verifier.write.verifyReputation([PROOF, root, attestationId, externalNullifier, nullifierHash], {
        account: user.account,
      }),
      "reused nullifier should revert"
    );
  });

  it("rejects an unregistered merkle root", async () => {
    const { verifier, user } = await deployFixture();
    await assert.rejects(
      verifier.write.verifyReputation([PROOF, keccak256(toHex("nope")), 1n, 2n, 3n], {
        account: user.account,
      }),
      "unregistered root should revert"
    );
  });

  it("rejects when the Groth16 verifier returns false", async () => {
    const { verifier, mockVerifier, admin, user } = await deployFixture();
    const root = keccak256(toHex("v2-root"));
    await verifier.write.updateMerkleRoot([root], { account: admin.account });
    await mockVerifier.write.setResult([false], { account: admin.account });

    await assert.rejects(
      verifier.write.verifyReputation([PROOF, root, 1n, 2n, 3n], { account: user.account }),
      "invalid proof should revert"
    );
  });

  it("allows admin transfer", async () => {
    const { verifier, admin, user } = await deployFixture();
    await verifier.write.transferAdmin([user.account.address], { account: admin.account });
    assert.equal(getAddress(await verifier.read.admin()), getAddress(user.account.address));
  });
});
