// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/// @title IWormhole
/// @notice Minimal interface to the Wormhole Core Contract used by the UAB:
///         publishing a generic message and parsing/verifying an incoming VAA.
///         Matches the Wormhole core ABI so it binds to the deployed contract.
interface IWormhole {
    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint8 guardianIndex;
    }

    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        Signature[] signatures;
        bytes32 hash;
    }

    /// @notice Publish a message; guardians sign it into a VAA. Returns the emitter sequence.
    function publishMessage(uint32 nonce, bytes memory payload, uint8 consistencyLevel)
        external
        payable
        returns (uint64 sequence);

    /// @notice Parse and verify a signed VAA. `valid` is false (with `reason`) on any failure.
    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        returns (VM memory vm, bool valid, string memory reason);

    /// @notice Fee (in wei) required by publishMessage.
    function messageFee() external view returns (uint256);
}
