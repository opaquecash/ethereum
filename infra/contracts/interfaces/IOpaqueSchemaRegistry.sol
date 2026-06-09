// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

/// @title IOpaqueSchemaRegistry
/// @notice Read surface of the schema registry used by the attestation engine.
///         Mirrors the validation helpers of the Solana `schema-registry` program
///         (`is_authorized_issuer`, `is_active`).
interface IOpaqueSchemaRegistry {
    /// @notice Whether a schema with this id has been registered.
    function exists(bytes32 schemaId) external view returns (bool);

    /// @notice The schema's immutable authority (creator).
    function getAuthority(bytes32 schemaId) external view returns (address);

    /// @notice The schema's optional resolver hook (address(0) if disabled).
    function getResolver(bytes32 schemaId) external view returns (address);

    /// @notice Whether attestations under this schema may be revoked.
    function isRevocable(bytes32 schemaId) external view returns (bool);

    /// @notice True if `candidate` is the authority or a registered delegate.
    function isAuthorizedIssuer(bytes32 schemaId, address candidate) external view returns (bool);

    /// @notice True if the schema is not deprecated and not past its expiry block.
    function isActive(bytes32 schemaId) external view returns (bool);
}
