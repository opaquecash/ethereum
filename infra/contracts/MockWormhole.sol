// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import {IWormhole} from "./interfaces/IWormhole.sol";

/// @title MockWormhole
/// @notice Test double for the Wormhole Core Contract. publishMessage records the payload and
///         returns an incrementing sequence; parseAndVerifyVM decodes a test-crafted VAA so
///         UAB receiver logic can be exercised without guardian signatures.
contract MockWormhole is IWormhole {
    uint64 public sequenceCounter;
    uint256 public fee;
    bytes public lastPayload;
    uint8 public lastConsistency;

    event LogMessagePublished(
        address indexed sender,
        uint64 sequence,
        uint32 nonce,
        bytes payload,
        uint8 consistencyLevel
    );

    function setFee(uint256 f) external {
        fee = f;
    }

    function messageFee() external view returns (uint256) {
        return fee;
    }

    function publishMessage(uint32 nonce, bytes memory payload, uint8 consistencyLevel)
        external
        payable
        returns (uint64 sequence)
    {
        require(msg.value >= fee, "insufficient fee");
        sequence = sequenceCounter++;
        lastPayload = payload;
        lastConsistency = consistencyLevel;
        emit LogMessagePublished(msg.sender, sequence, nonce, payload, consistencyLevel);
    }

    /// @notice Test helper: encode a VAA blob this mock can verify.
    function encodeVaa(
        uint16 emitterChainId,
        bytes32 emitterAddress,
        uint64 sequence,
        bytes memory payload,
        bool valid,
        string memory reason
    ) external pure returns (bytes memory) {
        return abi.encode(emitterChainId, emitterAddress, sequence, payload, valid, reason);
    }

    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        pure
        returns (VM memory vm, bool valid, string memory reason)
    {
        (
            uint16 emitterChainId,
            bytes32 emitterAddress,
            uint64 sequence,
            bytes memory payload,
            bool v,
            string memory r
        ) = abi.decode(encodedVM, (uint16, bytes32, uint64, bytes, bool, string));
        vm.emitterChainId = emitterChainId;
        vm.emitterAddress = emitterAddress;
        vm.sequence = sequence;
        vm.payload = payload;
        valid = v;
        reason = r;
    }
}
