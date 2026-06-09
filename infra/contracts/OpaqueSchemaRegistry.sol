// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {IOpaqueSchemaRegistry} from "./interfaces/IOpaqueSchemaRegistry.sol";

/// @title OpaqueSchemaRegistry
/// @notice Registry of attestation schemas. A schema declares its authority, an
///         optional resolver hook, whether its attestations are revocable, an
///         ABI-style field layout, and a set of delegate issuers. Attestations bind
///         to a schema and may only be issued by the authority or a delegate.
///         Expiry is expressed as a block number.
contract OpaqueSchemaRegistry is IOpaqueSchemaRegistry {
    // =========================================================================
    // Limits
    // =========================================================================

    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_FIELD_DEF_BYTES = 256;
    uint256 public constant MAX_DELEGATES = 10;
    uint8 public constant SCHEMA_VERSION = 1;

    // =========================================================================
    // Types
    // =========================================================================

    struct Schema {
        bool exists;
        address authority; // immutable creator
        address resolver; // optional hook (address(0) = disabled)
        bool revocable;
        bool deprecated;
        uint8 version;
        string name; // <= MAX_NAME_BYTES
        string fieldDefinitions; // <= MAX_FIELD_DEF_BYTES
        address[] delegates; // <= MAX_DELEGATES
        uint256 createdAt; // block.number at registration
        uint256 schemaExpiryBlock; // 0 = never; else no new attestations at/after this block
    }

    /// @notice schemaId => Schema. schemaId = sha256(authority || name || version).
    mapping(bytes32 => Schema) private _schemas;

    // =========================================================================
    // Errors
    // =========================================================================

    error SchemaAlreadyExists();
    error SchemaNotFound();
    error NotAuthority();
    error NameTooLong();
    error FieldDefinitionsTooLong();
    error TooManyDelegates();
    error DelegateAlreadyExists();
    error DelegateNotFound();
    error AlreadyDeprecated();

    // =========================================================================
    // Events
    // =========================================================================

    event SchemaRegistered(
        bytes32 indexed schemaId,
        address indexed authority,
        string name,
        bool revocable,
        address resolver
    );
    event DelegateAdded(bytes32 indexed schemaId, address indexed delegate);
    event DelegateRemoved(bytes32 indexed schemaId, address indexed delegate);
    event ResolverUpdated(bytes32 indexed schemaId, address indexed resolver);
    event SchemaDeprecated(bytes32 indexed schemaId);

    // =========================================================================
    // Registration
    // =========================================================================

    /// @notice Computes the deterministic schema id for a given authority/name/version.
    /// @dev SHA256(authority || name || SCHEMA_VERSION).
    function computeSchemaId(address authority, string memory name) public pure returns (bytes32) {
        return sha256(abi.encodePacked(authority, bytes(name), SCHEMA_VERSION));
    }

    /// @notice Register a new schema. The caller becomes its immutable authority.
    /// @param name                Human-readable schema name (<= 64 bytes).
    /// @param fieldDefinitions    ABI-style field layout string (<= 256 bytes).
    /// @param revocable           Whether attestations under this schema can be revoked.
    /// @param resolver            Optional resolver hook (address(0) to disable).
    /// @param schemaExpiryBlock   Block after which no new attestations are accepted (0 = never).
    /// @return schemaId           The deterministic schema id.
    function registerSchema(
        string calldata name,
        string calldata fieldDefinitions,
        bool revocable,
        address resolver,
        uint256 schemaExpiryBlock
    ) external returns (bytes32 schemaId) {
        if (bytes(name).length > MAX_NAME_BYTES) revert NameTooLong();
        if (bytes(fieldDefinitions).length > MAX_FIELD_DEF_BYTES) revert FieldDefinitionsTooLong();

        schemaId = computeSchemaId(msg.sender, name);
        Schema storage s = _schemas[schemaId];
        if (s.exists) revert SchemaAlreadyExists();

        s.exists = true;
        s.authority = msg.sender;
        s.resolver = resolver;
        s.revocable = revocable;
        s.deprecated = false;
        s.version = SCHEMA_VERSION;
        s.name = name;
        s.fieldDefinitions = fieldDefinitions;
        s.createdAt = block.number;
        s.schemaExpiryBlock = schemaExpiryBlock;
        // delegates left empty

        emit SchemaRegistered(schemaId, msg.sender, name, revocable, resolver);
    }

    // =========================================================================
    // Authority-only management
    // =========================================================================

    modifier onlyAuthority(bytes32 schemaId) {
        Schema storage s = _schemas[schemaId];
        if (!s.exists) revert SchemaNotFound();
        if (msg.sender != s.authority) revert NotAuthority();
        _;
    }

    /// @notice Add a delegate issuer (max 10). Only the schema authority.
    function addDelegate(bytes32 schemaId, address delegate) external onlyAuthority(schemaId) {
        Schema storage s = _schemas[schemaId];
        if (s.delegates.length >= MAX_DELEGATES) revert TooManyDelegates();
        uint256 len = s.delegates.length;
        for (uint256 i = 0; i < len; i++) {
            if (s.delegates[i] == delegate) revert DelegateAlreadyExists();
        }
        s.delegates.push(delegate);
        emit DelegateAdded(schemaId, delegate);
    }

    /// @notice Remove a delegate issuer. Only the schema authority.
    function removeDelegate(bytes32 schemaId, address delegate) external onlyAuthority(schemaId) {
        Schema storage s = _schemas[schemaId];
        uint256 len = s.delegates.length;
        for (uint256 i = 0; i < len; i++) {
            if (s.delegates[i] == delegate) {
                s.delegates[i] = s.delegates[len - 1];
                s.delegates.pop();
                emit DelegateRemoved(schemaId, delegate);
                return;
            }
        }
        revert DelegateNotFound();
    }

    /// @notice Set or disable the resolver hook (address(0) disables). Only the authority.
    function updateResolver(bytes32 schemaId, address newResolver) external onlyAuthority(schemaId) {
        _schemas[schemaId].resolver = newResolver;
        emit ResolverUpdated(schemaId, newResolver);
    }

    /// @notice Irreversibly deprecate a schema (no new attestations). Only the authority.
    function deprecateSchema(bytes32 schemaId) external onlyAuthority(schemaId) {
        Schema storage s = _schemas[schemaId];
        if (s.deprecated) revert AlreadyDeprecated();
        s.deprecated = true;
        emit SchemaDeprecated(schemaId);
    }

    // =========================================================================
    // Views (IOpaqueSchemaRegistry)
    // =========================================================================

    function exists(bytes32 schemaId) external view returns (bool) {
        return _schemas[schemaId].exists;
    }

    function getAuthority(bytes32 schemaId) external view returns (address) {
        if (!_schemas[schemaId].exists) revert SchemaNotFound();
        return _schemas[schemaId].authority;
    }

    function getResolver(bytes32 schemaId) external view returns (address) {
        if (!_schemas[schemaId].exists) revert SchemaNotFound();
        return _schemas[schemaId].resolver;
    }

    function isRevocable(bytes32 schemaId) external view returns (bool) {
        if (!_schemas[schemaId].exists) revert SchemaNotFound();
        return _schemas[schemaId].revocable;
    }

    function isAuthorizedIssuer(bytes32 schemaId, address candidate) external view returns (bool) {
        Schema storage s = _schemas[schemaId];
        if (!s.exists) return false;
        if (candidate == s.authority) return true;
        uint256 len = s.delegates.length;
        for (uint256 i = 0; i < len; i++) {
            if (s.delegates[i] == candidate) return true;
        }
        return false;
    }

    function isActive(bytes32 schemaId) external view returns (bool) {
        Schema storage s = _schemas[schemaId];
        if (!s.exists) return false;
        if (s.deprecated) return false;
        return s.schemaExpiryBlock == 0 || block.number < s.schemaExpiryBlock;
    }

    // =========================================================================
    // Rich views
    // =========================================================================

    /// @notice Full schema record (value-typed fields).
    function getSchema(bytes32 schemaId)
        external
        view
        returns (
            address authority,
            address resolver,
            bool revocable,
            bool deprecated,
            uint8 version,
            string memory name,
            string memory fieldDefinitions,
            uint256 createdAt,
            uint256 schemaExpiryBlock
        )
    {
        Schema storage s = _schemas[schemaId];
        if (!s.exists) revert SchemaNotFound();
        return (
            s.authority,
            s.resolver,
            s.revocable,
            s.deprecated,
            s.version,
            s.name,
            s.fieldDefinitions,
            s.createdAt,
            s.schemaExpiryBlock
        );
    }

    function getDelegates(bytes32 schemaId) external view returns (address[] memory) {
        if (!_schemas[schemaId].exists) revert SchemaNotFound();
        return _schemas[schemaId].delegates;
    }
}
