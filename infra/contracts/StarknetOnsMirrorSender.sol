// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import {IStarknetMessaging} from "./interfaces/IStarknetMessaging.sol";

/// @title StarknetOnsMirrorSender
/// @notice Ethereum -> Starknet leg of the ONS mirror. Publishes each canonical ONS state
///         change (upsert / revoke) to the Starknet `OpaqueNameMirror` via native L1->L2
///         messaging, so a Starknet client resolves `name -> CSAP meta-address` from one
///         local read. This is the Starknet counterpart of the Wormhole path that feeds the
///         Solana mirror (spec/ONS.md §3); Wormhole has no Starknet endpoint.
///
///         The contract owns a strictly increasing `sequence`, so the mirror's monotonic
///         floor holds by construction. The Starknet mirror checks the sequencer-injected
///         L1 sender against its emitter allowlist, so only this contract (once allowlisted
///         there) can write.
///
///         Payload layout (Cairo Serde of `(u64 sequence, u8 action, u256 name_hash,
///         MetaKey spend, MetaKey view, felt eth_owner)`, MetaKey = `(u8 prefix, u256 x)`),
///         one felt per element:
///           [0]  sequence
///           [1]  action           (1 = upsert, 2 = revoke)
///           [2]  name_hash.low     (low 128 bits)
///           [3]  name_hash.high    (high 128 bits)
///           [4]  spend.prefix      (0x02 / 0x03; 0 on revoke)
///           [5]  spend.x.low
///           [6]  spend.x.high
///           [7]  view.prefix
///           [8]  view.x.low
///           [9]  view.x.high
///           [10] eth_owner         (20-byte address)
contract StarknetOnsMirrorSender {
    uint8 internal constant ACTION_UPSERT = 1;
    uint8 internal constant ACTION_REVOKE = 2;
    uint256 internal constant LOW_128_MASK = (1 << 128) - 1;

    /// @notice Starknet Core Contract (L1->L2 messaging).
    IStarknetMessaging public immutable starknetCore;
    /// @notice The `OpaqueNameMirror` contract address on Starknet.
    uint256 public immutable l2Mirror;
    /// @notice sn_keccak("handle_mirror") — the mirror's l1_handler selector.
    uint256 public constant HANDLE_MIRROR_SELECTOR =
        0x360577db805f50b45e209751e6dffb846a56316ba61d4405e9f32514ae003ce;

    /// @notice The only address allowed to publish mirror updates (the ONS registry or an admin).
    address public authority;
    /// @notice Strictly increasing message sequence.
    uint64 public sequence;

    event MirrorUpserted(bytes32 indexed nameHash, uint64 sequence, address ethOwner);
    event MirrorRevoked(bytes32 indexed nameHash, uint64 sequence);
    event AuthorityTransferred(address indexed previous, address indexed next);

    error NotAuthority();
    error ZeroAddress();

    modifier onlyAuthority() {
        if (msg.sender != authority) revert NotAuthority();
        _;
    }

    constructor(address _starknetCore, uint256 _l2Mirror, address _authority) {
        if (_starknetCore == address(0) || _authority == address(0)) revert ZeroAddress();
        starknetCore = IStarknetMessaging(_starknetCore);
        l2Mirror = _l2Mirror;
        authority = _authority;
    }

    /// @notice Mirror an upsert (register / update / transfer) to Starknet. `msg.value` pays
    ///         the L1->L2 message fee. `spendX` / `viewX` are the 32-byte x-coordinates of the
    ///         compressed secp256k1 keys; `spendPrefix` / `viewPrefix` are their 0x02/0x03 tags.
    function mirrorUpsert(
        bytes32 nameHash,
        uint8 spendPrefix,
        bytes32 spendX,
        uint8 viewPrefix,
        bytes32 viewX,
        address ethOwner
    ) external payable onlyAuthority returns (uint64 seq) {
        seq = ++sequence;
        uint256[] memory payload = new uint256[](11);
        payload[0] = seq;
        payload[1] = ACTION_UPSERT;
        (payload[2], payload[3]) = _u256Felts(uint256(nameHash));
        payload[4] = spendPrefix;
        (payload[5], payload[6]) = _u256Felts(uint256(spendX));
        payload[7] = viewPrefix;
        (payload[8], payload[9]) = _u256Felts(uint256(viewX));
        payload[10] = uint256(uint160(ethOwner));

        starknetCore.sendMessageToL2{value: msg.value}(
            l2Mirror, HANDLE_MIRROR_SELECTOR, payload
        );
        emit MirrorUpserted(nameHash, seq, ethOwner);
    }

    /// @notice Mirror a revoke to Starknet. The keys are sent zeroed; the mirror tombstones
    ///         in place (OPQ-004) regardless of the payload keys.
    function mirrorRevoke(bytes32 nameHash) external payable onlyAuthority returns (uint64 seq) {
        seq = ++sequence;
        uint256[] memory payload = new uint256[](11);
        payload[0] = seq;
        payload[1] = ACTION_REVOKE;
        (payload[2], payload[3]) = _u256Felts(uint256(nameHash));
        // payload[4..10] left zero.

        starknetCore.sendMessageToL2{value: msg.value}(
            l2Mirror, HANDLE_MIRROR_SELECTOR, payload
        );
        emit MirrorRevoked(nameHash, seq);
    }

    /// @notice Transfer the publishing authority (owner-style; the authority is also the owner).
    function transferAuthority(address next) external onlyAuthority {
        if (next == address(0)) revert ZeroAddress();
        emit AuthorityTransferred(authority, next);
        authority = next;
    }

    /// @dev Split a 256-bit value into Cairo `u256` felts `(low, high)`.
    function _u256Felts(uint256 v) internal pure returns (uint256 low, uint256 high) {
        low = v & LOW_128_MASK;
        high = v >> 128;
    }
}
