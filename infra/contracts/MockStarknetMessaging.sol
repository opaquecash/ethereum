// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import {IStarknetMessaging} from "./interfaces/IStarknetMessaging.sol";

/// @title MockStarknetMessaging
/// @notice Test double for the Starknet Core Contract: records the last `sendMessageToL2`
///         call so tests can assert the exact toAddress / selector / payload without a live
///         sequencer. Signature and delivery are the core bridge's concern, not ours.
contract MockStarknetMessaging is IStarknetMessaging {
    uint256 public lastToAddress;
    uint256 public lastSelector;
    uint256[] public lastPayload;
    uint256 public callCount;
    uint256 public lastValue;

    function sendMessageToL2(
        uint256 toAddress,
        uint256 selector,
        uint256[] calldata payload
    ) external payable returns (bytes32, uint256) {
        lastToAddress = toAddress;
        lastSelector = selector;
        lastPayload = payload;
        lastValue = msg.value;
        callCount += 1;
        return (bytes32(uint256(0xB0)), callCount);
    }

    function getLastPayload() external view returns (uint256[] memory) {
        return lastPayload;
    }
}
