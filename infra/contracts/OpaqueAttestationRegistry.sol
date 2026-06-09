// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IOpaqueSchemaRegistry} from "./interfaces/IOpaqueSchemaRegistry.sol";
import {IOpaqueResolver} from "./interfaces/IOpaqueResolver.sol";

/// @title OpaqueAttestationRegistry
/// @notice Ethereum mirror of the Solana `attestation-engine-v2` program. Issues
///         schema-bound attestations to stealth addresses: only a schema's authority
///         or a registered delegate may attest, and only while the schema is active.
///         Revocation is authority-only and preserves the attestation data for audit.
/// @dev    The ZK Merkle tree of attestation leaves is built off-chain by provers
///         (the leaf commits to private values `stealth_pk`/`nonce`); the root is
///         submitted to OpaqueReputationVerifierV2. This registry is the canonical,
///         queryable record of issued attestations — exactly like the Solana PDAs.
///         The Solana "slot" is modelled with `block.number`.
contract OpaqueAttestationRegistry {
    // =========================================================================
    // Limits
    // =========================================================================

    uint256 public constant MAX_DATA_BYTES = 512;

    // =========================================================================
    // Types
    // =========================================================================

    struct Attestation {
        bool exists;
        bytes32 schemaId;
        address issuer;
        bytes32 stealthAddressHash;
        uint256 createdAt; // block.number
        uint256 expirationBlock; // 0 = no expiry
        uint256 revocationBlock; // 0 = not revoked
        bytes32 refUid; // optional chaining to a prior attestation
        bytes data; // ABI-encoded payload, <= MAX_DATA_BYTES
    }

    /// @notice Schema registry this engine validates against (immutable).
    IOpaqueSchemaRegistry public immutable schemaRegistry;

    /// @notice uid => Attestation. uid = sha256(schemaId || issuer || stealthAddressHash || block.number).
    mapping(bytes32 => Attestation) private _attestations;

    // =========================================================================
    // Errors
    // =========================================================================

    error NotAuthorizedIssuer();
    error SchemaInactive();
    error DataTooLong();
    error AttestationAlreadyExists();
    error AttestationNotFound();
    error NotRevocable();
    error NotAuthority();
    error AlreadyRevoked();
    error ZeroAddress();

    // =========================================================================
    // Events
    // =========================================================================

    event Attested(
        bytes32 indexed uid,
        bytes32 indexed schemaId,
        address indexed issuer,
        bytes32 stealthAddressHash,
        uint256 expirationBlock,
        bytes32 refUid
    );
    event Revoked(bytes32 indexed uid, bytes32 indexed schemaId, uint256 revocationBlock);

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address _schemaRegistry) {
        if (_schemaRegistry == address(0)) revert ZeroAddress();
        schemaRegistry = IOpaqueSchemaRegistry(_schemaRegistry);
    }

    // =========================================================================
    // Issuance
    // =========================================================================

    /// @notice Compute the deterministic attestation uid.
    /// @dev Matches Solana: SHA256(schema_id || issuer || stealth_address_hash || slot).
    function computeUid(
        bytes32 schemaId,
        address issuer,
        bytes32 stealthAddressHash,
        uint256 blockNumber
    ) public pure returns (bytes32) {
        return sha256(abi.encodePacked(schemaId, issuer, stealthAddressHash, blockNumber));
    }

    /// @notice Issue an attestation for a stealth address under a schema.
    /// @param schemaId            The target schema.
    /// @param stealthAddressHash  Hash of the recipient's stealth address (never the address itself).
    /// @param data                ABI-encoded attestation payload (<= 512 bytes).
    /// @param expirationBlock     Block at/after which the attestation is invalid (0 = never).
    /// @param refUid              Optional reference to a prior attestation (0 = none).
    /// @return uid                The attestation uid.
    function attest(
        bytes32 schemaId,
        bytes32 stealthAddressHash,
        bytes calldata data,
        uint256 expirationBlock,
        bytes32 refUid
    ) external returns (bytes32 uid) {
        if (!schemaRegistry.isAuthorizedIssuer(schemaId, msg.sender)) revert NotAuthorizedIssuer();
        if (!schemaRegistry.isActive(schemaId)) revert SchemaInactive();
        if (data.length > MAX_DATA_BYTES) revert DataTooLong();

        uid = computeUid(schemaId, msg.sender, stealthAddressHash, block.number);
        Attestation storage a = _attestations[uid];
        if (a.exists) revert AttestationAlreadyExists();

        a.exists = true;
        a.schemaId = schemaId;
        a.issuer = msg.sender;
        a.stealthAddressHash = stealthAddressHash;
        a.createdAt = block.number;
        a.expirationBlock = expirationBlock;
        a.revocationBlock = 0;
        a.refUid = refUid;
        a.data = data;

        emit Attested(uid, schemaId, msg.sender, stealthAddressHash, expirationBlock, refUid);

        // Resolver hook (after state commit; CEI). Reverting rejects the attestation.
        address resolver = schemaRegistry.getResolver(schemaId);
        if (resolver != address(0)) {
            IOpaqueResolver(resolver).onAttest(schemaId, msg.sender, stealthAddressHash, uid, data);
        }
    }

    // =========================================================================
    // Revocation (authority-only; delegates cannot revoke)
    // =========================================================================

    /// @notice Revoke an attestation. Only the schema authority, only if the schema
    ///         is revocable. Data is preserved for auditability.
    function revoke(bytes32 uid) external {
        Attestation storage a = _attestations[uid];
        if (!a.exists) revert AttestationNotFound();
        if (!schemaRegistry.isRevocable(a.schemaId)) revert NotRevocable();
        if (msg.sender != schemaRegistry.getAuthority(a.schemaId)) revert NotAuthority();
        if (a.revocationBlock != 0) revert AlreadyRevoked();

        a.revocationBlock = block.number;

        emit Revoked(uid, a.schemaId, block.number);

        address resolver = schemaRegistry.getResolver(a.schemaId);
        if (resolver != address(0)) {
            IOpaqueResolver(resolver).onRevoke(a.schemaId, uid, block.number);
        }
    }

    // =========================================================================
    // Views
    // =========================================================================

    /// @notice True if the attestation exists, is not revoked, and not expired.
    function isValid(bytes32 uid) external view returns (bool) {
        Attestation storage a = _attestations[uid];
        if (!a.exists) return false;
        if (a.revocationBlock != 0) return false;
        return a.expirationBlock == 0 || block.number < a.expirationBlock;
    }

    function getAttestation(bytes32 uid)
        external
        view
        returns (
            bytes32 schemaId,
            address issuer,
            bytes32 stealthAddressHash,
            uint256 createdAt,
            uint256 expirationBlock,
            uint256 revocationBlock,
            bytes32 refUid,
            bytes memory data
        )
    {
        Attestation storage a = _attestations[uid];
        if (!a.exists) revert AttestationNotFound();
        return (
            a.schemaId,
            a.issuer,
            a.stealthAddressHash,
            a.createdAt,
            a.expirationBlock,
            a.revocationBlock,
            a.refUid,
            a.data
        );
    }

    function exists(bytes32 uid) external view returns (bool) {
        return _attestations[uid].exists;
    }
}
