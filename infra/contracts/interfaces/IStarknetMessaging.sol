// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/// @title IStarknetMessaging
/// @notice Minimal interface to the Starknet Core Contract's L1->L2 messaging entrypoint.
///         Matches the deployed core ABI (Sepolia core: 0xE2Bb56ee936fd6433Dc0F6e7e3b8365C906AA057).
interface IStarknetMessaging {
    /// @notice Send a message to an L2 contract. The sequencer delivers `payload` to the
    ///         `#[l1_handler]` identified by `selector` on `toAddress`, injecting this
    ///         contract's address as the handler's `from_address`.
    /// @param toAddress  L2 recipient contract address (felt).
    /// @param selector   sn_keccak of the l1_handler function name (felt).
    /// @param payload    message payload, one felt per element.
    /// @return msgHash   the message hash.
    /// @return nonce     the L1->L2 message nonce.
    function sendMessageToL2(
        uint256 toAddress,
        uint256 selector,
        uint256[] calldata payload
    ) external payable returns (bytes32 msgHash, uint256 nonce);
}
