// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import {IWormhole} from "./interfaces/IWormhole.sol";

/// @title UABReceiver
/// @notice Universal Announcement Bus receiver (Ethereum). Verifies an incoming Wormhole VAA,
///         checks it came from the registered cross-chain sender, and re-emits the 96-byte
///         payload as a local event so Ethereum scanners see the other chain's announcement.
///         See spec/UAB.md.
contract UABReceiver {
    /// @notice Wormhole Core Contract.
    IWormhole public immutable wormhole;

    /// @notice Admin that may (re)configure the trusted source emitter.
    address public admin;

    /// @notice Wormhole chain id of the trusted source (Solana = 1).
    uint16 public expectedEmitterChain;

    /// @notice 32-byte Wormhole emitter address of the trusted source (Solana emitter PDA).
    bytes32 public expectedEmitter;

    /// @notice Consumed VAA keys (emitterChain, emitter, sequence) — one-time delivery.
    mapping(bytes32 => bool) public consumed;

    /// @notice Emitted for each verified cross-chain announcement; payload is spec/payload-format.md.
    event CrossChainAnnouncement(
        uint16 indexed sourceChain,
        bytes32 indexed sourceEmitter,
        uint64 sequence,
        bytes payload
    );

    event ExpectedEmitterUpdated(uint16 chainId, bytes32 emitter);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    error InvalidVAA(string reason);
    error UnknownEmitter();
    error AlreadyConsumed();
    error BadPayloadLength();
    error Unauthorized();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    /// @param _wormhole             Wormhole Core Contract.
    /// @param _admin                Admin that configures the trusted emitter.
    /// @param _expectedEmitterChain Source Wormhole chain id (Solana = 1); 0 until configured.
    /// @param _expectedEmitter      Source emitter (32 bytes); 0 until configured.
    constructor(
        address _wormhole,
        address _admin,
        uint16 _expectedEmitterChain,
        bytes32 _expectedEmitter
    ) {
        if (_wormhole == address(0) || _admin == address(0)) revert ZeroAddress();
        wormhole = IWormhole(_wormhole);
        admin = _admin;
        expectedEmitterChain = _expectedEmitterChain;
        expectedEmitter = _expectedEmitter;
    }

    /// @notice Set the trusted source emitter once the opposite chain's sender is deployed.
    function setExpectedEmitter(uint16 chainId, bytes32 emitter) external onlyAdmin {
        expectedEmitterChain = chainId;
        expectedEmitter = emitter;
        emit ExpectedEmitterUpdated(chainId, emitter);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Verify a VAA from the trusted source emitter and re-emit its payload locally.
    function receiveAnnouncement(bytes calldata encodedVaa) external {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole.parseAndVerifyVM(encodedVaa);
        if (!valid) revert InvalidVAA(reason);
        if (vm.emitterChainId != expectedEmitterChain || vm.emitterAddress != expectedEmitter) {
            revert UnknownEmitter();
        }
        if (vm.payload.length != 96) revert BadPayloadLength();

        bytes32 key = keccak256(abi.encodePacked(vm.emitterChainId, vm.emitterAddress, vm.sequence));
        if (consumed[key]) revert AlreadyConsumed();
        consumed[key] = true;

        emit CrossChainAnnouncement(vm.emitterChainId, vm.emitterAddress, vm.sequence, vm.payload);
    }
}
