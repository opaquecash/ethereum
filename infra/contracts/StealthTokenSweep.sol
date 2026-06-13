// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/// @title StealthTokenSweep
/// @notice Gasless ERC-20 sweep out of a one-time stealth address (spec/relayer-market.md,
///         fee-in-token). A stealth address typically holds a token but no native gas. The one-time
///         stealth key signs an EIP-712 `Sweep` authorization binding the destination, amount, and
///         relayer fee; a relayer submits it (paying gas) and is reimbursed the fee in the token.
///         Funds move `owner -> destination` and `owner -> relayer` directly via `transferFrom`; this
///         contract never custodies the token. Allowance comes from an accompanying EIP-2612 permit
///         (`sweepWithPermit`) or a prior `approve` (`sweep`). Because the owner signs destination,
///         value, and fee, a relayer cannot redirect funds or inflate its cut.
contract StealthTokenSweep {
    /// @notice EIP-712 type hash for a sweep authorization.
    bytes32 public constant SWEEP_TYPEHASH = keccak256(
        "Sweep(address token,address owner,address destination,uint256 value,uint256 fee,uint256 nonce,uint256 deadline)"
    );

    uint256 internal immutable INITIAL_CHAIN_ID;
    bytes32 internal immutable INITIAL_DOMAIN_SEPARATOR;

    /// @notice Per-owner authorization nonce; each sweep consumes the current value.
    mapping(address => uint256) public nonces;

    /// @dev Minimal reentrancy guard (token transfers call out to arbitrary token code).
    uint256 private entered = 1;

    /// @notice Owner's signed sweep authorization. `fee` is paid to the submitting relayer in `token`.
    struct Sweep {
        address token;
        address owner;
        address destination;
        uint256 value;
        uint256 fee;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice EIP-2612 permit fields granting this contract allowance over `Sweep.token`.
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    event Swept(
        address indexed token,
        address indexed owner,
        address indexed destination,
        address relayer,
        uint256 value,
        uint256 fee
    );

    error Expired();
    error BadNonce();
    error FeeTooHigh();
    error InvalidSignature();
    error Reentrant();
    error TransferFailed();

    constructor() {
        INITIAL_CHAIN_ID = block.chainid;
        INITIAL_DOMAIN_SEPARATOR = _computeDomainSeparator();
    }

    modifier nonReentrant() {
        if (entered != 1) revert Reentrant();
        entered = 2;
        _;
        entered = 1;
    }

    /// @notice Sweep using an EIP-2612 permit to obtain allowance in the same transaction.
    /// @dev The permit is signed by `s.owner` (the stealth key); set `p.value >= s.value`.
    function sweepWithPermit(Sweep calldata s, bytes calldata ownerSig, PermitData calldata p)
        external
        nonReentrant
    {
        _authorize(s, ownerSig);
        IERC20Permit(s.token).permit(s.owner, address(this), p.value, p.deadline, p.v, p.r, p.s);
        _settle(s);
    }

    /// @notice Sweep using an allowance the owner already granted this contract (non-permit tokens).
    function sweep(Sweep calldata s, bytes calldata ownerSig) external nonReentrant {
        _authorize(s, ownerSig);
        _settle(s);
    }

    /// @dev Validate deadline, fee, nonce, and the owner's EIP-712 signature. Consumes the nonce
    ///      before any external call (checks-effects-interactions).
    function _authorize(Sweep calldata s, bytes calldata ownerSig) internal {
        if (block.timestamp > s.deadline) revert Expired();
        if (s.fee > s.value) revert FeeTooHigh();
        if (s.nonce != nonces[s.owner]) revert BadNonce();
        nonces[s.owner] = s.nonce + 1;

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        SWEEP_TYPEHASH,
                        s.token,
                        s.owner,
                        s.destination,
                        s.value,
                        s.fee,
                        s.nonce,
                        s.deadline
                    )
                )
            )
        );

        if (ownerSig.length != 65) revert InvalidSignature();
        bytes32 sigR;
        bytes32 sigS;
        uint8 sigV;
        assembly ("memory-safe") {
            sigR := calldataload(ownerSig.offset)
            sigS := calldataload(add(ownerSig.offset, 0x20))
            sigV := byte(0, calldataload(add(ownerSig.offset, 0x40)))
        }
        address signer = ecrecover(digest, sigV, sigR, sigS);
        if (signer == address(0) || signer != s.owner) revert InvalidSignature();
    }

    /// @dev Move `value - fee` to the destination and `fee` to the relayer, both from the owner.
    function _settle(Sweep calldata s) internal {
        uint256 net = s.value - s.fee;
        if (net > 0) _safeTransferFrom(s.token, s.owner, s.destination, net);
        if (s.fee > 0) _safeTransferFrom(s.token, s.owner, msg.sender, s.fee);
        emit Swept(s.token, s.owner, s.destination, msg.sender, s.value, s.fee);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    /// @notice EIP-712 domain separator (recomputed on chain fork).
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == INITIAL_CHAIN_ID ? INITIAL_DOMAIN_SEPARATOR : _computeDomainSeparator();
    }

    function _computeDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("OpaqueStealthTokenSweep"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
