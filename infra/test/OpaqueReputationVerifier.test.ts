import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { getAddress, parseEther, keccak256, toHex, encodeAbiParameters, parseAbiParameters } from "viem";

describe("OpaqueReputationVerifier", () => {
  async function deployFixture() {
    const { viem } = await hre.network.connect();
    const [admin, user, other] = await viem.getWalletClients();

    // Deploy a mock Groth16 verifier that always returns true
    const mockVerifier = await viem.deployContract("MockGroth16Verifier" as any);

    const verifier = await viem.deployContract("OpaqueReputationVerifier", [
      mockVerifier.address,
      admin.account.address,
    ]);

    const publicClient = await viem.getPublicClient();

    return { verifier, mockVerifier, admin, user, other, publicClient };
  }

  it("should deploy with correct admin and verifier", async () => {
    const { verifier, mockVerifier, admin } = await deployFixture();
    const storedAdmin = await verifier.read.admin();
    assert.equal(getAddress(storedAdmin), getAddress(admin.account.address));
    const storedVerifier = await verifier.read.groth16Verifier();
    assert.equal(getAddress(storedVerifier), getAddress(mockVerifier.address));
  });

  it("should allow admin to update merkle root", async () => {
    const { verifier, admin } = await deployFixture();
    const root = keccak256(toHex("test-root"));

    await verifier.write.updateMerkleRoot([root], { account: admin.account });

    const isValid = await verifier.read.isRootValid([root]);
    assert.ok(isValid, "Root should be valid after submission");
  });

  it("should reject non-admin root updates", async () => {
    const { verifier, user } = await deployFixture();
    const root = keccak256(toHex("test-root"));

    await assert.rejects(
      verifier.write.updateMerkleRoot([root], { account: user.account }),
      "Should reject non-admin"
    );
  });

  it("should mark nullifiers as used after verification", async () => {
    const { verifier, admin, user } = await deployFixture();
    const root = keccak256(toHex("test-root"));

    await verifier.write.updateMerkleRoot([root], { account: admin.account });

    const attestationId = 42n;
    const nullifier = 123456789n;

    const proof = {
      a: [1n, 2n] as [bigint, bigint],
      b: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]],
      c: [7n, 8n] as [bigint, bigint],
    };

    const externalNullifier = 1001n;

    await verifier.write.verifyReputation([proof, root, attestationId, externalNullifier, nullifier], {
      account: user.account,
    });

    const isUsed = await verifier.read.usedNullifiers([nullifier]);
    assert.ok(isUsed, "Nullifier should be marked as used");
  });

  it("should reject reused nullifiers", async () => {
    const { verifier, admin, user } = await deployFixture();
    const root = keccak256(toHex("test-root"));

    await verifier.write.updateMerkleRoot([root], { account: admin.account });

    const attestationId = 42n;
    const nullifier = 999n;
    const externalNullifier = 1001n;

    const proof = {
      a: [1n, 2n] as [bigint, bigint],
      b: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]],
      c: [7n, 8n] as [bigint, bigint],
    };

    await verifier.write.verifyReputation([proof, root, attestationId, externalNullifier, nullifier], {
      account: user.account,
    });

    await assert.rejects(
      verifier.write.verifyReputation([proof, root, attestationId, externalNullifier, nullifier], {
        account: user.account,
      }),
      "Should reject reused nullifier"
    );
  });

  it("should reject invalid merkle roots", async () => {
    const { verifier, user } = await deployFixture();

    const fakeRoot = keccak256(toHex("not-registered"));
    const proof = {
      a: [1n, 2n] as [bigint, bigint],
      b: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]],
      c: [7n, 8n] as [bigint, bigint],
    };

    await assert.rejects(
      verifier.write.verifyReputation([proof, fakeRoot, 42n, 1001n, 111n], {
        account: user.account,
      }),
      "Should reject unregistered root"
    );
  });

  it("should allow admin transfer", async () => {
    const { verifier, admin, user } = await deployFixture();

    await verifier.write.transferAdmin([user.account.address], {
      account: admin.account,
    });

    const newAdmin = await verifier.read.admin();
    assert.equal(getAddress(newAdmin), getAddress(user.account.address));
  });
});
