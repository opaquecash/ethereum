/* tslint:disable */
/* eslint-disable */

/**
 * Quick view-tag check before expensive EC operations.
 *
 * # Arguments
 * * `view_tag` - View tag from announcement (number 0-255)
 * * `view_privkey_bytes` - 32-byte viewing private key (Uint8Array)
 * * `ephemeral_pubkey_bytes` - 33-byte ephemeral public key, compressed (Uint8Array)
 *
 * # Returns
 * `"NoMatch"` if view tag doesn't match (skip this announcement),
 * `"PossibleMatch"` if view tag matches (proceed with full check).
 */
export function check_announcement_view_tag_wasm(view_tag: number, view_privkey_bytes: Uint8Array, ephemeral_pubkey_bytes: Uint8Array): string;

/**
 * Checks if an announcement matches this recipient's keys.
 *
 * # Arguments
 * * `announcement_stealth_address` - Stealth address from announcement (hex string)
 * * `view_tag` - View tag from announcement (number 0-255)
 * * `view_privkey_bytes` - 32-byte viewing private key (Uint8Array)
 * * `spend_pubkey_bytes` - 33-byte spending public key, compressed (Uint8Array)
 * * `ephemeral_pubkey_bytes` - 33-byte ephemeral public key, compressed (Uint8Array)
 *
 * # Returns
 * `true` if the announcement is for this recipient, `false` otherwise.
 */
export function check_announcement_wasm(announcement_stealth_address: string, view_tag: number, view_privkey_bytes: Uint8Array, spend_pubkey_bytes: Uint8Array, ephemeral_pubkey_bytes: Uint8Array): boolean;

/**
 * Derives a stealth address and view tag from the given keys.
 *
 * # Arguments
 * * `view_privkey_bytes` - 32-byte viewing private key (Uint8Array)
 * * `spend_pubkey_bytes` - 33-byte spending public key, compressed (Uint8Array)
 * * `ephemeral_pubkey_bytes` - 33-byte ephemeral public key, compressed (Uint8Array)
 *
 * # Returns
 * A JavaScript object with:
 * * `stealthAddress` - Ethereum address as hex string (0x...)
 * * `viewTag` - View tag as number (0-255)
 */
export function derive_stealth_address_wasm(view_privkey_bytes: Uint8Array, spend_pubkey_bytes: Uint8Array, ephemeral_pubkey_bytes: Uint8Array): any;

/**
 * Encodes attestation metadata for use in announcements.
 *
 * # Arguments
 * * `view_tag` - View tag byte (0-255)
 * * `attestation_id` - Attestation/badge ID
 *
 * # Returns
 * Hex-encoded metadata bytes.
 */
export function encode_attestation_metadata_wasm(view_tag: number, attestation_id: bigint): string;

/**
 * Encodes V2 attestation metadata for use in stealth announcements.
 *
 * Layout: view_tag(1) || 0xB2(1) || schema_id(32) || issuer(32) || attestation_uid(32) || nonce(32)
 *
 * # Arguments
 * * `view_tag` - View tag byte (0-255)
 * * `schema_id_hex` - Schema identifier as 64-char hex string (32 bytes)
 * * `issuer_hex` - Issuer pubkey as 64-char hex string (32 bytes)
 * * `attestation_uid_hex` - Attestation UID as 64-char hex string (32 bytes)
 * * `nonce_hex` - Random nonce as 64-char hex string (32 bytes)
 *
 * # Returns
 * Hex-encoded metadata bytes (0x-prefixed).
 */
export function encode_v2_attestation_metadata_wasm(view_tag: number, schema_id_hex: string, issuer_hex: string, attestation_uid_hex: string, nonce_hex: string): string;

/**
 * Generates the full ZK-circuit witness for a specific trait.
 *
 * Builds a local Merkle tree from the given attestations, finds the first
 * attestation matching `target_trait_id`, generates an inclusion proof,
 * and returns a JSON witness compatible with the Circom circuit.
 *
 * # Arguments
 * * `attestations_json` - JSON array of `StealthAttestation` (from `scan_attestations_wasm`)
 * * `target_trait_id` - The attestation_id to prove (as string decimal)
 * * `stealth_privkey_bytes` - 32-byte stealth private key for the matching address
 * * `external_nullifier` - Action-scoped nonce (as string decimal)
 *
 * # Returns
 * JSON `CircuitWitness` for the Circom prover.
 */
export function generate_reputation_witness(attestations_json: string, target_trait_id: string, stealth_privkey_bytes: Uint8Array, external_nullifier: string): string;

/**
 * Generates a V2 ZK-circuit witness for a specific schema-bound trait.
 *
 * The V2 witness uses the new 5-input leaf:
 *   Poseidon(stealth_pk, schema_id, issuer_pk_x, trait_data_hash, nonce)
 *
 * # Arguments
 * * `attestations_v2_json` - JSON array of V2StealthAttestation (from scan_attestations_v2_wasm)
 * * `target_schema_id_hex` - The schema_id to prove (64-char hex)
 * * `stealth_privkey_bytes` - 32-byte stealth private key (Uint8Array)
 * * `trait_data_hash_hex` - Poseidon hash of the decoded data fields (64-char hex string)
 * * `external_nullifier` - Action-scoped nonce as decimal string
 *
 * # Returns
 * JSON object with all circuit inputs (private + public) for snarkjs.fullProve.
 */
export function generate_reputation_witness_v2(attestations_v2_json: string, target_schema_id_hex: string, stealth_privkey_bytes: Uint8Array, trait_data_hash_hex: string, external_nullifier: string): string;

export function init(): void;

/**
 * Reconstructs the one-time signing key (private key) for a stealth address.
 *
 * # Arguments
 * * `master_spend_priv_bytes` - 32-byte spending private key (Uint8Array)
 * * `master_view_priv_bytes` - 32-byte viewing private key (Uint8Array)
 * * `ephemeral_pubkey_bytes` - 33-byte ephemeral public key, compressed (Uint8Array)
 *
 * # Returns
 * 32-byte stealth private key as Uint8Array (for use with ethers.Wallet or viem privateKeyToAccount).
 */
export function reconstruct_signing_key_wasm(master_spend_priv_bytes: Uint8Array, master_view_priv_bytes: Uint8Array, ephemeral_pubkey_bytes: Uint8Array): Uint8Array;

/**
 * Scans V2 announcements for schema-bound attestations belonging to this recipient.
 *
 * Unlike V1, V2 requires a schema registry snapshot to validate issuer authorization.
 * Rogue traits (issued by non-delegates) are filtered out before results are returned.
 *
 * # Arguments
 * * `announcements_json` - JSON array of announcement objects (same format as V1)
 * * `schemas_json` - JSON array of SchemaInfo objects fetched from schema_registry program
 * * `view_privkey_bytes` - 32-byte viewing private key (Uint8Array)
 * * `spend_pubkey_bytes` - 33-byte spending public key (compressed, Uint8Array)
 * * `current_slot` - Current Solana slot for expiry checks
 * * `trusted_issuers_json` - Optional JSON array of trusted issuer hex strings; pass "" to skip
 *
 * # Returns
 * JSON array of V2StealthAttestation objects.
 */
export function scan_attestations_v2_wasm(announcements_json: string, schemas_json: string, view_privkey_bytes: Uint8Array, spend_pubkey_bytes: Uint8Array, current_slot: bigint, trusted_issuers_json: string): string;

/**
 * Scans announcement metadata for attestation markers.
 *
 * # Arguments
 * * `announcements_json` - JSON array of announcements, each with:
 *   `{ stealthAddress, viewTag, ephemeralPubKey, metadata, txHash, blockNumber }`
 * * `view_privkey_bytes` - 32-byte viewing private key
 * * `spend_pubkey_bytes` - 33-byte spending public key (compressed)
 *
 * # Returns
 * JSON array of `StealthAttestation` objects found for this recipient.
 */
export function scan_attestations_wasm(announcements_json: string, view_privkey_bytes: Uint8Array, spend_pubkey_bytes: Uint8Array): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly check_announcement_view_tag_wasm: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly check_announcement_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly derive_stealth_address_wasm: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly encode_attestation_metadata_wasm: (a: number, b: bigint) => [number, number];
    readonly encode_v2_attestation_metadata_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly generate_reputation_witness: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly generate_reputation_witness_v2: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly reconstruct_signing_key_wasm: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly scan_attestations_v2_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint, j: number, k: number) => [number, number, number, number];
    readonly scan_attestations_wasm: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly init: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
