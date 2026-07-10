// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

/// @title MockSchemaRegistry
/// @notice Test-only mock of the `isActive()` surface OpaqueReputationVerifierV2 binds to,
///         so tests can exercise the schema-registry binding (OPQ-006) without deploying and
///         populating a full OpaqueSchemaRegistry.
contract MockSchemaRegistry {
    bool public active = true;

    function setActive(bool a) external {
        active = a;
    }

    function isActive(bytes32) external view returns (bool) {
        return active;
    }
}
