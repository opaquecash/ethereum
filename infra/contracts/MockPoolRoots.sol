// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/// @dev Test stand-in for OpaquePrivacyPool's root history.
contract MockPoolRoots {
    mapping(bytes32 => bool) public known;

    function setKnownRoot(bytes32 root, bool isKnown) external {
        known[root] = isKnown;
    }

    function isKnownRoot(bytes32 root) external view returns (bool) {
        return known[root];
    }
}
