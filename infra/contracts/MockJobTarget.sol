// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/// @title MockJobTarget
/// @notice Test double for RelayerRegistry inner calls: records the caller and
///         payload on success, reverts on demand.
contract MockJobTarget {
    event Poked(address indexed caller, uint256 value);

    uint256 public pokes;
    address public lastCaller;

    function poke(uint256 value) external {
        pokes += 1;
        lastCaller = msg.sender;
        emit Poked(msg.sender, value);
    }

    function explode() external pure {
        revert("MockJobTarget: boom");
    }
}
