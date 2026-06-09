// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import {IWormhole} from "./interfaces/IWormhole.sol";

/// @title UABSender
/// @notice Universal Announcement Bus sender (Ethereum). Emits the legacy ERC-5564
///         Announcement event AND publishes the 96-byte cross-chain payload through the
///         Wormhole Core Contract so the other chain's scanner can see it. The deployed
///         StealthAddressAnnouncer singleton is left untouched; cross-chain relay is opt-in
///         here. Payload layout: spec/payload-format.md.
contract UABSender {
    /// @notice Wormhole Core Contract.
    IWormhole public immutable wormhole;

    /// @notice This chain's Wormhole chain id (Ethereum Sepolia/mainnet = 2). Stamped into the payload.
    uint16 public immutable sourceChainId;

    /// @notice ERC-5564 announcement, mirrored for backwards-compatible local scanning.
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    /// @notice Emitted after the payload is published to Wormhole.
    event RelayedAnnouncement(uint64 indexed sequence, bytes payload);

    error EphemeralKeyLength();
    error MissingViewTag();
    error SchemeIdTooLarge();
    error MetadataTooLong();
    error InsufficientFee();

    constructor(address _wormhole, uint16 _sourceChainId) {
        wormhole = IWormhole(_wormhole);
        sourceChainId = _sourceChainId;
    }

    /// @notice Announce a stealth transfer locally and relay it cross-chain via Wormhole.
    /// @param schemeId          ERC-5564 scheme (1 = secp256k1). Must fit in uint32 for the payload.
    /// @param stealthAddress    The recipient one-time address.
    /// @param ephemeralPubKey   Compressed secp256k1 ephemeral key (33 bytes).
    /// @param metadata          First byte is the view tag; up to 24 further bytes are carried.
    /// @param consistencyLevel  Wormhole finality (200 = finalized).
    /// @return sequence         The Wormhole emitter sequence of the published message.
    function announceWithRelay(
        uint256 schemeId,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence) {
        // 1. Legacy ERC-5564 announcement (so existing Ethereum scanners still see it).
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);

        // 2. Build the 96-byte cross-chain payload.
        bytes memory payload = _buildPayload(schemeId, stealthAddress, ephemeralPubKey, metadata);

        // 3. Publish through Wormhole (pay the message fee from msg.value).
        uint256 fee = wormhole.messageFee();
        if (msg.value < fee) revert InsufficientFee();
        sequence = wormhole.publishMessage{value: fee}(0, payload, consistencyLevel);

        emit RelayedAnnouncement(sequence, payload);
    }

    /// @notice Build the canonical 96-byte payload (see spec/payload-format.md).
    function _buildPayload(
        uint256 schemeId,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) internal view returns (bytes memory) {
        if (ephemeralPubKey.length != 33) revert EphemeralKeyLength();
        if (metadata.length < 1) revert MissingViewTag();
        if (schemeId > type(uint32).max) revert SchemeIdTooLarge();
        uint256 metaLen = metadata.length - 1;
        if (metaLen > 24) revert MetadataTooLong();

        bytes memory p = new bytes(96);

        // [0] view tag
        p[0] = metadata[0];

        // [1..34) ephemeral pubkey (33 bytes)
        for (uint256 i = 0; i < 33; i++) {
            p[1 + i] = ephemeralPubKey[i];
        }

        // [34..66) stealth address, left-padded: low 20 bytes occupy [46..66)
        bytes20 sa = bytes20(stealthAddress);
        for (uint256 i = 0; i < 20; i++) {
            p[46 + i] = sa[i];
        }

        // [66..68) source chain id (uint16, big-endian)
        p[66] = bytes1(uint8(sourceChainId >> 8));
        p[67] = bytes1(uint8(sourceChainId));

        // [68..72) scheme id (uint32, big-endian)
        p[68] = bytes1(uint8(schemeId >> 24));
        p[69] = bytes1(uint8(schemeId >> 16));
        p[70] = bytes1(uint8(schemeId >> 8));
        p[71] = bytes1(uint8(schemeId));

        // [72..96) metadata tail (after the view tag), zero-padded to 24 bytes
        for (uint256 i = 0; i < metaLen; i++) {
            p[72 + i] = metadata[1 + i];
        }

        return p;
    }
}
