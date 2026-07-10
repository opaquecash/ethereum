// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

/// @title OpaqueReputationVerifierV2
/// @notice Verifies Groth16 proofs from the V2 stealth_reputation circuit: that the
///         prover holds a schema-bound attestation at a stealth address, without
///         revealing the address. Tracks valid Merkle roots and spent nullifiers.
/// @dev    Public signals (snarkjs order = circuit declaration order):
///           [0] merkle_root
///           [1] attestation_id      (= schema_id; schema binding enforced in-circuit)
///           [2] external_nullifier
///           [3] nullifier_hash      (= Poseidon(stealth_pk, external_nullifier))
///         The leaf/tree are built off-chain; the admin submits the Merkle root, so
///         no on-chain Poseidon is needed.
interface IGroth16VerifierV2 {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals
    ) external view returns (bool);
}

/// @notice Minimal view surface of OpaqueSchemaRegistry used to bind a proof's
///         `attestation_id` to a live, registered schema.
interface IOpaqueSchemaRegistry {
    function isActive(bytes32 schemaId) external view returns (bool);
}

contract OpaqueReputationVerifierV2 {
    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidProof();
    error NullifierAlreadyUsed();
    error InvalidMerkleRoot();
    error Unauthorized();
    error ZeroAddress();
    /// @notice The proof's attestation_id is not a live registered schema (OPQ-006).
    error SchemaNotRegistered();

    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted when a V2 reputation proof is successfully verified.
    event ReputationVerified(
        uint256 indexed attestationId,
        uint256 indexed nullifierHash,
        address indexed verifier,
        bytes32 merkleRoot,
        uint256 externalNullifier
    );

    /// @notice Emitted when a new Merkle root is submitted.
    event MerkleRootUpdated(bytes32 indexed root, uint256 blockNumber);

    /// @notice Emitted on admin transfer.
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    /// @notice Emitted when the schema-registry binding is set (address(0) disables it).
    event SchemaRegistryUpdated(address indexed registry);

    // =========================================================================
    // State
    // =========================================================================

    /// @notice The V2 Groth16 verifier (generated from the V2 circuit's verification key).
    IGroth16VerifierV2 public immutable groth16Verifier;

    /// @notice Optional schema registry. When set, `verifyReputation` requires the proof's
    ///         `attestation_id` to reference a live registered schema, so a proof cannot
    ///         claim reputation under a schema that was never registered by an authority
    ///         (OPQ-006). address(0) disables the check. Note this binds the SCHEMA only;
    ///         binding the ISSUER (that an authorized key attested) additionally requires the
    ///         in-circuit commitment to the schema authority — the tracked full remediation.
    IOpaqueSchemaRegistry public schemaRegistry;

    /// @notice Admin authorized to submit Merkle roots.
    address public admin;

    /// @notice Spent nullifier hashes — prevents double-claiming the same action.
    mapping(uint256 => bool) public usedNullifiers;

    /// @notice Valid Merkle roots and their submission timestamps.
    mapping(bytes32 => uint256) public merkleRoots;

    /// @notice Maximum age of a Merkle root before it is considered stale.
    uint256 public constant ROOT_EXPIRY = 1 hours;

    /// @notice Ordered list of recent roots (circular buffer for UI enumeration).
    bytes32[] public rootHistory;

    /// @notice Maximum number of roots kept in history.
    uint256 public constant MAX_ROOT_HISTORY = 100;

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    /// @param _verifier Address of the deployed Groth16VerifierV2.
    /// @param _admin Address authorized to submit new Merkle roots.
    constructor(address _verifier, address _admin) {
        if (_verifier == address(0) || _admin == address(0)) revert ZeroAddress();
        groth16Verifier = IGroth16VerifierV2(_verifier);
        admin = _admin;
    }

    // =========================================================================
    // Root management
    // =========================================================================

    /// @notice Submit a new Merkle root from the off-chain attestation tree.
    function updateMerkleRoot(bytes32 root) external onlyAdmin {
        merkleRoots[root] = block.timestamp;

        if (rootHistory.length >= MAX_ROOT_HISTORY) {
            bytes32 oldest = rootHistory[0];
            delete merkleRoots[oldest];
            rootHistory[0] = rootHistory[rootHistory.length - 1];
            rootHistory.pop();
        }
        rootHistory.push(root);

        emit MerkleRootUpdated(root, block.number);
    }

    /// @notice Whether a Merkle root is known and not expired.
    function isRootValid(bytes32 root) public view returns (bool) {
        uint256 ts = merkleRoots[root];
        if (ts == 0) return false;
        return (block.timestamp - ts) <= ROOT_EXPIRY;
    }

    function rootHistoryLength() external view returns (uint256) {
        return rootHistory.length;
    }

    // =========================================================================
    // Proof verification
    // =========================================================================

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    /// @notice Verify a V2 stealth-reputation proof and consume its nullifier.
    /// @param proof             Groth16 proof points.
    /// @param root              Merkle root used by the proof (must be recent + valid).
    /// @param attestationId     Schema id being proven (= circuit `attestation_id`).
    /// @param externalNullifier Action-scoped domain separator.
    /// @param nullifierHash     Poseidon(stealth_pk, external_nullifier); Sybil-resistant.
    /// @return valid            True if the proof verifies and all checks pass.
    function verifyReputation(
        Proof calldata proof,
        bytes32 root,
        uint256 attestationId,
        uint256 externalNullifier,
        uint256 nullifierHash
    ) external returns (bool valid) {
        if (usedNullifiers[nullifierHash]) revert NullifierAlreadyUsed();
        if (!isRootValid(root)) revert InvalidMerkleRoot();
        if (!_schemaAllowed(attestationId)) revert SchemaNotRegistered();

        uint256[4] memory pubSignals;
        pubSignals[0] = uint256(root);
        pubSignals[1] = attestationId;
        pubSignals[2] = externalNullifier;
        pubSignals[3] = nullifierHash;

        if (!groth16Verifier.verifyProof(proof.a, proof.b, proof.c, pubSignals)) revert InvalidProof();

        usedNullifiers[nullifierHash] = true;

        emit ReputationVerified(attestationId, nullifierHash, msg.sender, root, externalNullifier);
        return true;
    }

    /// @notice Read-only verification (does not consume the nullifier).
    function verifyReputationView(
        Proof calldata proof,
        bytes32 root,
        uint256 attestationId,
        uint256 externalNullifier,
        uint256 nullifierHash
    ) external view returns (bool valid) {
        if (usedNullifiers[nullifierHash]) return false;
        if (!isRootValid(root)) return false;
        if (!_schemaAllowed(attestationId)) return false;

        uint256[4] memory pubSignals;
        pubSignals[0] = uint256(root);
        pubSignals[1] = attestationId;
        pubSignals[2] = externalNullifier;
        pubSignals[3] = nullifierHash;

        return groth16Verifier.verifyProof(proof.a, proof.b, proof.c, pubSignals);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    /// @notice Transfer the admin role. Use address(0) to renounce root submission.
    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Set (or, with address(0), disable) the schema-registry binding (OPQ-006).
    function setSchemaRegistry(address registry) external onlyAdmin {
        schemaRegistry = IOpaqueSchemaRegistry(registry);
        emit SchemaRegistryUpdated(registry);
    }

    /// @dev True unless a registry is configured and `attestationId` is not a live schema.
    function _schemaAllowed(uint256 attestationId) internal view returns (bool) {
        IOpaqueSchemaRegistry registry = schemaRegistry;
        return address(registry) == address(0) || registry.isActive(bytes32(attestationId));
    }
}
