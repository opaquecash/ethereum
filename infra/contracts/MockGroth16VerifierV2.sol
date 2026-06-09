// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

/// @title MockGroth16VerifierV2
/// @notice Test-only mock matching the V2 verifier interface (4 public signals).
///         Configurable return value so tests can exercise both accept and reject
///         paths of OpaqueReputationVerifierV2 without a real proof.
contract MockGroth16VerifierV2 {
    bool public result = true;

    function setResult(bool r) external {
        result = r;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[4] calldata
    ) external view returns (bool) {
        return result;
    }
}
