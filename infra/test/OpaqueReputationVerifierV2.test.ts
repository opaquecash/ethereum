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
    return { verifier, mockVerifier, admin, user, other };
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
