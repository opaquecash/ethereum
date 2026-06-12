// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

interface IDisclosureProofVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[6] calldata input
    ) external view returns (bool);
}

interface IPoolRoots {
    function isKnownRoot(bytes32 root) external view returns (bool);
}

/// @title OpaqueDisclosureRegistry
/// @notice Conditional disclosure (spec/conditional-disclosure.md): a privacy-pool
///         note's `(value, label)` may be put on the record for a requester iff
///         (a) an M-of-N custodian quorum FROST-signs the request (verified here as
///         a standard BIP-340 Schnorr signature over the request `context`), and
///         (b) a Groth16 proof shows the note is in the pool's state tree and its
///         value exceeds the policy threshold. The circuit enforces qualification,
///         so custodians can authorize blind. Disclosure nullifiers are consumed
///         once per (note, context) in this contract's own registry — disclosing
///         never spends the note, and spending never blocks disclosure.
///
///         Testnet only; same audit gates as the pool (see DISCLAIMER.md).
contract OpaqueDisclosureRegistry {
    IDisclosureProofVerifier public immutable verifier;

    /// @dev BN254 scalar field (public-signal / context reduction modulus).
    uint256 internal constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    /// @dev secp256k1 group order and base-field prime (BIP-340 verification).
    uint256 internal constant SECP_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 internal constant SECP_P =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;
    /// @dev sha256("BIP0340/challenge"), the BIP-340 tagged-hash prefix.
    bytes32 internal constant CHALLENGE_TAG =
        0x7bb52d7a9fef58323eb1bf7a407db382d2f3f2d81bb1224f49fe518f6d48d37c;

    struct Policy {
        address pool; // the privacy pool this policy can disclose from
        uint256 groupKeyX; // x-only BIP-340 FROST group public key (even Y)
        uint128 threshold; // minimum qualifying amount (wei)
        uint8 m; // quorum descriptor (informational; M is enforced by FROST)
        uint8 n;
    }

    struct SchnorrSig {
        uint256 rx; // signature R point (even Y required)
        uint256 ry;
        uint256 s;
    }

    Policy[] public policies;

    /// @notice Consumed disclosure nullifiers (consume-once per note+context).
    mapping(bytes32 => bool) public nullifierConsumed;

    event PolicyRegistered(
        uint256 indexed policyId,
        address pool,
        uint256 groupKeyX,
        uint128 threshold,
        uint8 m,
        uint8 n
    );
    event Disclosure(
        uint256 indexed policyId,
        bytes32 indexed caseId,
        address indexed requester,
        uint256 label,
        uint256 value,
        bytes32 disclosureNullifier
    );

    error PolicyDoesNotExist();
    error ZeroAddress();
    error InvalidGroupKey();
    error ThresholdMismatch();
    error ContextMismatch();
    error InvalidQuorumSignature();
    error UnknownStateRoot();
    error NullifierAlreadyConsumed();
    error InvalidProof();

    constructor(IDisclosureProofVerifier _verifier) {
        verifier = _verifier;
    }

    // ----------------------------------------------------------------- policies

    /// @notice Register an immutable disclosure policy. Rotation = a new policy.
    function registerPolicy(
        address pool,
        uint256 groupKeyX,
        uint128 threshold,
        uint8 m,
        uint8 n
    ) external returns (uint256 policyId) {
        if (pool == address(0)) revert ZeroAddress();
        if (groupKeyX == 0 || groupKeyX >= SECP_P) revert InvalidGroupKey();
        if (m == 0 || n < m) revert InvalidGroupKey();
        policyId = policies.length;
        policies.push(Policy(pool, groupKeyX, threshold, m, n));
        emit PolicyRegistered(policyId, pool, groupKeyX, threshold, m, n);
    }

    function policyCount() external view returns (uint256) {
        return policies.length;
    }

    // ---------------------------------------------------------------- disclose

    /// @notice Submit a quorum-authorized disclosure. `signals` is the circuit's
    ///         public order: [value, label, threshold, stateRoot,
    ///         disclosureNullifier, context]. The requester is `msg.sender`.
    function disclose(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[6] calldata signals,
        uint256 policyId,
        bytes32 caseId,
        SchnorrSig calldata sig
    ) external {
        if (policyId >= policies.length) revert PolicyDoesNotExist();
        Policy storage policy = policies[policyId];

        // 1. The proof's threshold is the policy's (else a prover picks its own).
        if (signals[2] != policy.threshold) revert ThresholdMismatch();

        // 2. The proof's context is this exact request, bound to the sender.
        uint256 ctx = _context(policyId, caseId, msg.sender);
        if (signals[5] != ctx) revert ContextMismatch();

        // 3. The custodian quorum authorized this context.
        if (!verifySchnorr(policy.groupKeyX, bytes32(ctx), sig)) {
            revert InvalidQuorumSignature();
        }

        // 4. The state root is a real root of the policy's pool.
        if (!IPoolRoots(policy.pool).isKnownRoot(bytes32(signals[3]))) {
            revert UnknownStateRoot();
        }

        // 5. The disclosure proof itself.
        if (!verifier.verifyProof(a, b, c, signals)) revert InvalidProof();

        // 6. Consume the nullifier (one disclosure per note+context).
        bytes32 nullifier = bytes32(signals[4]);
        if (nullifierConsumed[nullifier]) revert NullifierAlreadyConsumed();
        nullifierConsumed[nullifier] = true;

        emit Disclosure(policyId, caseId, msg.sender, signals[1], signals[0], nullifier);
    }

    /// @notice The `context` public input for a disclosure request
    ///         (spec/conditional-disclosure.md §5).
    function context(
        uint256 policyId,
        bytes32 caseId,
        address requester
    ) external pure returns (uint256) {
        return _context(policyId, caseId, requester);
    }

    function _context(
        uint256 policyId,
        bytes32 caseId,
        address requester
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(policyId, caseId, requester))) % FIELD_SIZE;
    }

    // ----------------------------------------------------------------- BIP-340

    /// @notice Verify a BIP-340 Schnorr signature `(rx, ry, s)` over 32-byte
    ///         message `m` against the x-only public key `px` (even Y), via the
    ///         ecrecover trick: ecrecover(-s·px, 27, px, -e·px) recovers the
    ///         point s·G − e·P, which must equal R (spec §5).
    function verifySchnorr(
        uint256 px,
        bytes32 m,
        SchnorrSig calldata sig
    ) public view returns (bool) {
        if (px == 0 || px >= SECP_P) return false;
        if (sig.s >= SECP_N) return false;
        if (sig.rx >= SECP_P || sig.ry >= SECP_P) return false;
        // R must have even Y (BIP-340) and lie on the curve: y² = x³ + 7.
        if (sig.ry & 1 != 0) return false;
        if (
            mulmod(sig.ry, sig.ry, SECP_P) !=
            addmod(mulmod(mulmod(sig.rx, sig.rx, SECP_P), sig.rx, SECP_P), 7, SECP_P)
        ) return false;

        // e = int(sha256(tag ‖ tag ‖ Rx ‖ Px ‖ m)) mod n
        uint256 e = uint256(
            sha256(abi.encodePacked(CHALLENGE_TAG, CHALLENGE_TAG, sig.rx, px, m))
        ) % SECP_N;

        uint256 z = SECP_N - mulmod(sig.s, px, SECP_N); // -s·px
        uint256 ep = SECP_N - mulmod(e, px, SECP_N); // -e·px
        if (z == SECP_N || ep == SECP_N) return false; // degenerate (s·px or e·px ≡ 0)

        address recovered = ecrecover(bytes32(z), 27, bytes32(px), bytes32(ep));
        if (recovered == address(0)) return false;
        return recovered ==
            address(uint160(uint256(keccak256(abi.encodePacked(sig.rx, sig.ry)))));
    }
}
