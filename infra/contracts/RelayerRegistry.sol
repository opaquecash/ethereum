// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/// @title RelayerRegistry
/// @notice Combined relayer stake registry and gas-private job escrow
///         (spec/relayer-market.md). Relayers stake the native asset to bid on jobs;
///         a job escrows its fee against a payload commitment; the accepting relayer
///         bonds `fee` from free stake and must execute the committed payload before
///         the deadline or the creator claims the bond. Submit-or-slash is therefore
///         fully on-chain-verifiable: no out-of-band failure proof exists or is needed.
contract RelayerRegistry {
    // ---------------------------------------------------------------- types

    struct Relayer {
        /// Total staked (free + bonded), excluding any pending unstake.
        uint256 stake;
        /// Portion of `stake` bonded to accepted-but-unfinished jobs.
        uint256 bonded;
        /// Pending unstake amount (no longer free; withdrawable after the cooldown).
        uint256 unstaking;
        /// When the pending unstake becomes withdrawable.
        uint64 unstakeAvailableAt;
        /// x25519 public key bids advertise; payloads are encrypted to it.
        bytes32 x25519PubKey;
        /// Optional HTTP gateway URL (intake convenience; MAY be empty).
        string endpoint;
    }

    struct Job {
        address creator;
        address relayer; // zero until accepted
        uint96 fee;
        bytes32 payloadHash; // keccak256(abi.encode(target, calldata))
        uint64 deadline;
        bool submitted;
        bool closed; // slashed, cancelled, or submitted
    }

    // ------------------------------------------------------------- constants

    /// @notice Minimum stake to register (testnet parameter).
    uint256 public constant MINIMUM_STAKE = 0.01 ether;

    /// @notice Delay between requestUnstake and withdraw (prevents bid-then-unstake races).
    uint256 public constant UNSTAKE_COOLDOWN = 1 hours;

    // ----------------------------------------------------------------- state

    mapping(address => Relayer) public relayers;
    mapping(bytes32 => Job) public jobs;

    /// @dev Minimal reentrancy guard (the inner call in submitJob is arbitrary).
    uint256 private entered = 1;

    // ---------------------------------------------------------------- events

    event RelayerRegistered(address indexed relayer, uint256 stake, bytes32 x25519PubKey, string endpoint);
    event RelayerUpdated(address indexed relayer, bytes32 x25519PubKey, string endpoint);
    event StakeAdded(address indexed relayer, uint256 amount, uint256 totalStake);
    event UnstakeRequested(address indexed relayer, uint256 amount, uint64 availableAt);
    event Withdrawn(address indexed relayer, uint256 amount);
    event JobCreated(bytes32 indexed jobId, address indexed creator, uint96 fee, bytes32 payloadHash, uint64 deadline);
    event JobAccepted(bytes32 indexed jobId, address indexed relayer, uint256 bond);
    event JobSubmitted(bytes32 indexed jobId, address indexed relayer, address target);
    event JobSlashed(bytes32 indexed jobId, address indexed relayer, address indexed creator, uint256 amount);
    event JobCancelled(bytes32 indexed jobId);

    // ---------------------------------------------------------------- errors

    error InsufficientStake();
    error NotRegistered();
    error InsufficientFreeStake();
    error CooldownActive();
    error NothingToWithdraw();
    error TransferFailed();
    error ZeroFee();
    error JobExists();
    error UnknownJob();
    error JobClosed();
    error DeadlinePassed();
    error DeadlineInPast();
    error AlreadyAccepted();
    error NotAccepted();
    error NotJobRelayer();
    error NotJobCreator();
    error DeadlineNotReached();
    error PayloadMismatch();
    error InnerCallFailed();
    error SelfTarget();
    error Reentrancy();

    modifier nonReentrant() {
        if (entered != 1) revert Reentrancy();
        entered = 2;
        _;
        entered = 1;
    }

    // ------------------------------------------------------------ registration

    /// @notice Register as a relayer (or top up below-minimum stake) with the
    ///         encryption key bids advertise and an optional gateway endpoint.
    function register(bytes32 x25519PubKey, string calldata endpoint) external payable {
        Relayer storage r = relayers[msg.sender];
        r.stake += msg.value;
        if (r.stake < MINIMUM_STAKE) revert InsufficientStake();
        r.x25519PubKey = x25519PubKey;
        r.endpoint = endpoint;
        emit RelayerRegistered(msg.sender, r.stake, x25519PubKey, endpoint);
    }

    /// @notice Update the advertised key / endpoint without changing stake.
    function updateRelayer(bytes32 x25519PubKey, string calldata endpoint) external {
        Relayer storage r = relayers[msg.sender];
        if (r.stake < MINIMUM_STAKE) revert NotRegistered();
        r.x25519PubKey = x25519PubKey;
        r.endpoint = endpoint;
        emit RelayerUpdated(msg.sender, x25519PubKey, endpoint);
    }

    function addStake() external payable {
        Relayer storage r = relayers[msg.sender];
        if (r.stake < MINIMUM_STAKE) revert NotRegistered();
        r.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, r.stake);
    }

    /// @notice Move free stake into the unstake queue; withdrawable after the cooldown.
    function requestUnstake(uint256 amount) external {
        Relayer storage r = relayers[msg.sender];
        if (amount > r.stake - r.bonded) revert InsufficientFreeStake();
        r.stake -= amount;
        r.unstaking += amount;
        r.unstakeAvailableAt = uint64(block.timestamp + UNSTAKE_COOLDOWN);
        emit UnstakeRequested(msg.sender, amount, r.unstakeAvailableAt);
    }

    function withdraw() external nonReentrant {
        Relayer storage r = relayers[msg.sender];
        uint256 amount = r.unstaking;
        if (amount == 0) revert NothingToWithdraw();
        if (block.timestamp < r.unstakeAvailableAt) revert CooldownActive();
        r.unstaking = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Stake not bonded to a job and not queued for unstake.
    function freeStakeOf(address relayer) public view returns (uint256) {
        Relayer storage r = relayers[relayer];
        return r.stake - r.bonded;
    }

    // ---------------------------------------------------------------- escrow

    /// @notice Escrow a job: `msg.value` is the fee, `payloadHash` commits to the
    ///         hidden payload (`keccak256(abi.encode(target, calldata))`).
    function createJob(bytes32 jobId, bytes32 payloadHash, uint64 deadline) external payable {
        if (msg.value == 0 || msg.value > type(uint96).max) revert ZeroFee();
        if (jobs[jobId].creator != address(0)) revert JobExists();
        if (deadline <= block.timestamp) revert DeadlineInPast();
        jobs[jobId] = Job({
            creator: msg.sender,
            relayer: address(0),
            fee: uint96(msg.value),
            payloadHash: payloadHash,
            deadline: deadline,
            submitted: false,
            closed: false
        });
        emit JobCreated(jobId, msg.sender, uint96(msg.value), payloadHash, deadline);
    }

    /// @notice Accept a job, bonding `fee` from free stake. First valid accept wins.
    function acceptJob(bytes32 jobId) external {
        Job storage j = jobs[jobId];
        if (j.creator == address(0)) revert UnknownJob();
        if (j.closed) revert JobClosed();
        if (j.relayer != address(0)) revert AlreadyAccepted();
        if (block.timestamp >= j.deadline) revert DeadlinePassed();
        Relayer storage r = relayers[msg.sender];
        if (r.stake < MINIMUM_STAKE) revert NotRegistered();
        if (freeStakeOf(msg.sender) < j.fee) revert InsufficientFreeStake();
        r.bonded += j.fee;
        j.relayer = msg.sender;
        emit JobAccepted(jobId, msg.sender, j.fee);
    }

    /// @notice Reveal and execute the committed payload. The escrow is the caller of
    ///         the inner call, so targets must be permissionless w.r.t. msg.sender
    ///         (PSR verify, announcers, UAB receivers). Pays the fee and releases the
    ///         bond atomically with successful execution.
    function submitJob(bytes32 jobId, address target, bytes calldata data) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.creator == address(0)) revert UnknownJob();
        if (j.closed) revert JobClosed();
        if (msg.sender != j.relayer) revert NotJobRelayer();
        if (keccak256(abi.encode(target, data)) != j.payloadHash) revert PayloadMismatch();
        if (target == address(this)) revert SelfTarget();

        // Effects before the arbitrary inner call.
        j.submitted = true;
        j.closed = true;
        relayers[msg.sender].bonded -= j.fee;

        (bool ok, ) = target.call(data);
        if (!ok) revert InnerCallFailed();

        (bool paid, ) = payable(msg.sender).call{value: j.fee}("");
        if (!paid) revert TransferFailed();

        emit JobSubmitted(jobId, msg.sender, target);
    }

    /// @notice After the deadline, an accepted-but-unsubmitted job lets the creator
    ///         claim the relayer's bond plus the fee refund.
    function slashJob(bytes32 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.creator == address(0)) revert UnknownJob();
        if (msg.sender != j.creator) revert NotJobCreator();
        if (j.closed) revert JobClosed();
        if (j.relayer == address(0)) revert NotAccepted();
        if (block.timestamp < j.deadline) revert DeadlineNotReached();

        j.closed = true;
        Relayer storage r = relayers[j.relayer];
        r.bonded -= j.fee;
        r.stake -= j.fee; // the bond is forfeited

        (bool ok, ) = payable(j.creator).call{value: uint256(j.fee) * 2}("");
        if (!ok) revert TransferFailed();

        emit JobSlashed(jobId, j.relayer, j.creator, j.fee);
    }

    /// @notice After the deadline, an unaccepted job refunds its fee.
    function cancelJob(bytes32 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.creator == address(0)) revert UnknownJob();
        if (msg.sender != j.creator) revert NotJobCreator();
        if (j.closed) revert JobClosed();
        if (j.relayer != address(0)) revert AlreadyAccepted();
        if (block.timestamp < j.deadline) revert DeadlineNotReached();

        j.closed = true;
        (bool ok, ) = payable(j.creator).call{value: j.fee}("");
        if (!ok) revert TransferFailed();

        emit JobCancelled(jobId);
    }
}
