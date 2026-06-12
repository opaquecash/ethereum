// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import {MerkleTreeWithHistory, IPoseidon2} from "./MerkleTreeWithHistory.sol";

interface IPoseidon3 {
    function poseidon(bytes32[3] calldata input) external pure returns (bytes32);
}

interface IWithdrawalVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[6] calldata input
    ) external view returns (bool);
}

/// @title OpaquePrivacyPool
/// @notice Native-asset privacy pool (spec/privacy-pool.md). Deposits insert a
///         commitment = Poseidon(value, label, precommitment) into an append-only
///         Merkle tree; withdrawals prove (in zero knowledge) membership in the state
///         tree AND membership of the deposit's label in the ASP association set, plus
///         a nullifier and value accounting, paying out to a fresh stealth address and
///         re-inserting the remainder. The label is contract-assigned
///         (Poseidon(scope, depositIndex)) so the ASP curates real deposits.
///
///         Testnet only; mainnet is gated on circuit + contract audits, a production
///         trusted-setup ceremony, and a legal opinion (see DISCLAIMER.md).
contract OpaquePrivacyPool is MerkleTreeWithHistory {
    IWithdrawalVerifier public immutable verifier;
    IPoseidon3 public immutable hasher3;

    /// @notice Pool-binding scope folded into every label (spec §1).
    uint256 public immutable scope;

    /// @notice ASP authority that posts the association-set root (testnet: single address).
    address public aspAuthority;
    /// @notice Current association-set root the withdrawal proof must attest against.
    uint256 public aspRoot;

    /// @notice Consumed nullifier hashes (consume-once; spec §3).
    mapping(bytes32 => bool) public nullifierSpent;

    uint256 private constant MAX_VALUE = 2 ** 128; // value range bound (spec §4.1)

    /// @notice A withdrawal's public, contract-recomputed parameters bound via `context`.
    struct WithdrawalParams {
        address recipient; // fresh stealth address
        address feeRecipient; // relayer / processooor (may be zero)
        uint256 fee; // paid to feeRecipient out of withdrawnValue
    }

    event Deposit(bytes32 indexed commitment, uint256 label, uint256 value, uint32 leafIndex);
    event Withdrawal(
        bytes32 indexed nullifierHash,
        bytes32 newCommitment,
        uint256 withdrawnValue,
        address indexed recipient
    );
    event ASPRootUpdated(uint256 indexed newRoot);
    event ASPAuthorityTransferred(address indexed previous, address indexed next);

    error ZeroValue();
    error ValueTooLarge();
    error UnknownStateRoot();
    error StaleAspRoot();
    error NullifierAlreadySpent();
    error InvalidProof();
    error FeeExceedsWithdrawn();
    error PayoutFailed();
    error NotAspAuthority();
    error ZeroAddress();

    constructor(
        uint32 _levels,
        IPoseidon2 _hasher2,
        IPoseidon3 _hasher3,
        IWithdrawalVerifier _verifier,
        address _aspAuthority
    ) MerkleTreeWithHistory(_levels, _hasher2) {
        if (_aspAuthority == address(0)) revert ZeroAddress();
        hasher3 = _hasher3;
        verifier = _verifier;
        aspAuthority = _aspAuthority;
        scope =
            uint256(keccak256(abi.encodePacked(address(this), block.chainid))) % FIELD_SIZE;
    }

    // --------------------------------------------------------------- deposit

    /// @notice Deposit `msg.value` against `precommitment = Poseidon(nullifier, secret)`.
    ///         The contract assigns `label = Poseidon(scope, leafIndex)` and inserts
    ///         `commitment = Poseidon(value, label, precommitment)`.
    function deposit(uint256 precommitment) external payable returns (bytes32 commitment) {
        if (msg.value == 0) revert ZeroValue();
        if (msg.value >= MAX_VALUE) revert ValueTooLarge();
        uint32 leafIndex = nextIndex;
        uint256 label = uint256(hasher3Two(scope, uint256(leafIndex)));
        commitment = hasher3.poseidon([
            bytes32(msg.value),
            bytes32(label),
            bytes32(precommitment)
        ]);
        _insert(commitment);
        emit Deposit(commitment, label, msg.value, leafIndex);
    }

    /// @dev label = Poseidon(scope, leafIndex) via the 2-input hasher.
    function hasher3Two(uint256 a, uint256 b) internal view returns (bytes32) {
        return hasher2.poseidon([bytes32(a), bytes32(b)]);
    }

    // --------------------------------------------------------------- withdraw

    /// @notice Withdraw using a Groth16 proof from `withdrawal.circom`. Public signals:
    ///         [withdrawnValue, stateRoot, aspRoot, nullifierHash, newCommitment, context].
    function withdraw(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint256 withdrawnValue,
        uint256 stateRoot,
        uint256 nullifierHash,
        uint256 newCommitment,
        WithdrawalParams calldata params
    ) external {
        if (!isKnownRoot(bytes32(stateRoot))) revert UnknownStateRoot();
        bytes32 nh = bytes32(nullifierHash);
        if (nullifierSpent[nh]) revert NullifierAlreadySpent();
        if (params.fee > withdrawnValue) revert FeeExceedsWithdrawn();

        uint256 ctx = _context(params);
        uint[6] memory input =
            [withdrawnValue, stateRoot, aspRoot, nullifierHash, newCommitment, ctx];
        if (!verifier.verifyProof(a, b, c, input)) revert InvalidProof();

        // Effects: consume the nullifier, insert the remainder commitment.
        nullifierSpent[nh] = true;
        _insert(bytes32(newCommitment));

        // Interactions: pay out (recipient gets withdrawnValue - fee; feeRecipient the fee).
        uint256 toRecipient = withdrawnValue - params.fee;
        if (toRecipient > 0) {
            (bool ok, ) = payable(params.recipient).call{value: toRecipient}("");
            if (!ok) revert PayoutFailed();
        }
        if (params.fee > 0 && params.feeRecipient != address(0)) {
            (bool ok, ) = payable(params.feeRecipient).call{value: params.fee}("");
            if (!ok) revert PayoutFailed();
        }

        emit Withdrawal(nh, bytes32(newCommitment), withdrawnValue, params.recipient);
    }

    /// @notice The `context` public input: binds the proof to this withdrawal's payout
    ///         params and the pool scope (spec §4.1, §5), reduced into the field.
    function context(WithdrawalParams calldata params) external view returns (uint256) {
        return _context(params);
    }

    function _context(WithdrawalParams calldata params) internal view returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encode(params.recipient, params.feeRecipient, params.fee, scope)
                )
            ) % FIELD_SIZE;
    }

    // --------------------------------------------------------------- ASP admin

    function setAspRoot(uint256 newRoot) external {
        if (msg.sender != aspAuthority) revert NotAspAuthority();
        aspRoot = newRoot;
        emit ASPRootUpdated(newRoot);
    }

    function transferAspAuthority(address next) external {
        if (msg.sender != aspAuthority) revert NotAspAuthority();
        if (next == address(0)) revert ZeroAddress();
        emit ASPAuthorityTransferred(aspAuthority, next);
        aspAuthority = next;
    }
}
