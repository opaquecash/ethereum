// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

/// @title IOpaqueResolver
/// @notice Optional hook a schema can attach to gate or react to attestations. The
///         attestation engine calls these after committing state
///         (checks-effects-interactions); a resolver rejects by reverting.
interface IOpaqueResolver {
    /// @notice Called after a new attestation is recorded.
    function onAttest(
        bytes32 schemaId,
        address issuer,
        bytes32 stealthAddressHash,
        bytes32 uid,
        bytes calldata data
    ) external;

    /// @notice Called after an attestation is revoked.
    function onRevoke(bytes32 schemaId, bytes32 uid, uint256 revocationBlock) external;
}
