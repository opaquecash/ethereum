// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/// @notice Two-input Poseidon hasher (circomlib-compatible, deployed from circomlibjs).
interface IPoseidon2 {
    function poseidon(bytes32[2] calldata input) external pure returns (bytes32);
}

/// @title MerkleTreeWithHistory
/// @notice Append-only incremental Merkle tree with a ring buffer of recent roots,
///         Poseidon(2)-hashed to match `withdrawal.circom` / `association.circom`
///         (spec/privacy-pool.md §2). Empty-leaf value is 0; zeros[i] =
///         Poseidon(zeros[i-1], zeros[i-1]). Adapted from Tornado's
///         MerkleTreeWithHistory with the Poseidon hasher injected.
contract MerkleTreeWithHistory {
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 public immutable levels;
    IPoseidon2 public immutable hasher2;

    uint32 public constant ROOT_HISTORY_SIZE = 30;
    mapping(uint256 => bytes32) public filledSubtrees;
    mapping(uint256 => bytes32) public roots;
    /// @dev Cached zero-subtree roots, computed once at construction (zeros[0..levels]).
    mapping(uint256 => bytes32) private _zeros;
    uint32 public currentRootIndex;
    uint32 public nextIndex;

    error TreeFull();
    error LevelsRange();

    constructor(uint32 _levels, IPoseidon2 _hasher2) {
        if (_levels == 0 || _levels >= 32) revert LevelsRange();
        levels = _levels;
        hasher2 = _hasher2;
        // Compute the zero-subtree roots once (O(levels) Poseidon calls) and cache them;
        // _insert then reads cached zeros in O(1), keeping insertion O(levels).
        bytes32 z = bytes32(0);
        _zeros[0] = z;
        for (uint32 i = 0; i < _levels; i++) {
            filledSubtrees[i] = z;
            z = _hasher2.poseidon([z, z]);
            _zeros[i + 1] = z;
        }
        roots[0] = z;
    }

    function hashLeftRight(bytes32 left, bytes32 right) public view returns (bytes32) {
        require(uint256(left) < FIELD_SIZE && uint256(right) < FIELD_SIZE, "out of field");
        return hasher2.poseidon([left, right]);
    }

    /// @dev Append a leaf; returns its index. O(levels) Poseidon calls.
    function _insert(bytes32 leaf) internal returns (uint32 index) {
        uint32 _nextIndex = nextIndex;
        if (_nextIndex == uint32(2) ** levels) revert TreeFull();
        uint32 currentIndex = _nextIndex;
        bytes32 currentLevelHash = leaf;
        bytes32 left;
        bytes32 right;

        for (uint32 i = 0; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros(i);
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hashLeftRight(left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentLevelHash;
        nextIndex = _nextIndex + 1;
        return _nextIndex;
    }

    /// @notice Whether `root` is in the recent-root ring buffer.
    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == 0) return false;
        uint32 i = currentRootIndex;
        do {
            if (root == roots[i]) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE;
            i--;
        } while (i != currentRootIndex);
        return false;
    }

    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }

    /// @notice Precomputed zero-subtree root at level `i` (cached at construction).
    ///         zeros(0) = 0 (empty leaf); zeros(i) = Poseidon(zeros(i-1), zeros(i-1)).
    function zeros(uint256 i) public view returns (bytes32) {
        return _zeros[i];
    }
}
