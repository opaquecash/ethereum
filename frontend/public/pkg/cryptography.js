/* @ts-self-types="./cryptography.d.ts" */

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
 * @param {number} view_tag
 * @param {Uint8Array} view_privkey_bytes
 * @param {Uint8Array} ephemeral_pubkey_bytes
 * @returns {string}
 */
export function check_announcement_view_tag_wasm(view_tag, view_privkey_bytes, ephemeral_pubkey_bytes) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArray8ToWasm0(view_privkey_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(ephemeral_pubkey_bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.check_announcement_view_tag_wasm(view_tag, ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

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
 * @param {string} announcement_stealth_address
 * @param {number} view_tag
 * @param {Uint8Array} view_privkey_bytes
 * @param {Uint8Array} spend_pubkey_bytes
 * @param {Uint8Array} ephemeral_pubkey_bytes
 * @returns {boolean}
 */
export function check_announcement_wasm(announcement_stealth_address, view_tag, view_privkey_bytes, spend_pubkey_bytes, ephemeral_pubkey_bytes) {
    const ptr0 = passStringToWasm0(announcement_stealth_address, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(view_privkey_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(spend_pubkey_bytes, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(ephemeral_pubkey_bytes, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.check_announcement_wasm(ptr0, len0, view_tag, ptr1, len1, ptr2, len2, ptr3, len3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

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
 * @param {Uint8Array} view_privkey_bytes
 * @param {Uint8Array} spend_pubkey_bytes
 * @param {Uint8Array} ephemeral_pubkey_bytes
 * @returns {any}
 */
export function derive_stealth_address_wasm(view_privkey_bytes, spend_pubkey_bytes, ephemeral_pubkey_bytes) {
    const ptr0 = passArray8ToWasm0(view_privkey_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(spend_pubkey_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(ephemeral_pubkey_bytes, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.derive_stealth_address_wasm(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Encodes attestation metadata for use in announcements.
 *
 * # Arguments
 * * `view_tag` - View tag byte (0-255)
 * * `attestation_id` - Attestation/badge ID
 *
 * # Returns
 * Hex-encoded metadata bytes.
 * @param {number} view_tag
 * @param {bigint} attestation_id
 * @returns {string}
 */
export function encode_attestation_metadata_wasm(view_tag, attestation_id) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.encode_attestation_metadata_wasm(view_tag, attestation_id);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

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
 * @param {number} view_tag
 * @param {string} schema_id_hex
 * @param {string} issuer_hex
 * @param {string} attestation_uid_hex
 * @param {string} nonce_hex
 * @returns {string}
 */
export function encode_v2_attestation_metadata_wasm(view_tag, schema_id_hex, issuer_hex, attestation_uid_hex, nonce_hex) {
    let deferred6_0;
    let deferred6_1;
    try {
        const ptr0 = passStringToWasm0(schema_id_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(issuer_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(attestation_uid_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(nonce_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.encode_v2_attestation_metadata_wasm(view_tag, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        var ptr5 = ret[0];
        var len5 = ret[1];
        if (ret[3]) {
            ptr5 = 0; len5 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred6_0 = ptr5;
        deferred6_1 = len5;
        return getStringFromWasm0(ptr5, len5);
    } finally {
        wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
    }
}

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
 * @param {string} attestations_json
 * @param {string} target_trait_id
 * @param {Uint8Array} stealth_privkey_bytes
 * @param {string} external_nullifier
 * @returns {string}
 */
export function generate_reputation_witness(attestations_json, target_trait_id, stealth_privkey_bytes, external_nullifier) {
    let deferred6_0;
    let deferred6_1;
    try {
        const ptr0 = passStringToWasm0(attestations_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(target_trait_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(stealth_privkey_bytes, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(external_nullifier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.generate_reputation_witness(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        var ptr5 = ret[0];
        var len5 = ret[1];
        if (ret[3]) {
            ptr5 = 0; len5 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred6_0 = ptr5;
        deferred6_1 = len5;
        return getStringFromWasm0(ptr5, len5);
    } finally {
        wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
    }
}

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
 * @param {string} attestations_v2_json
 * @param {string} target_schema_id_hex
 * @param {Uint8Array} stealth_privkey_bytes
 * @param {string} trait_data_hash_hex
 * @param {string} external_nullifier
 * @returns {string}
 */
export function generate_reputation_witness_v2(attestations_v2_json, target_schema_id_hex, stealth_privkey_bytes, trait_data_hash_hex, external_nullifier) {
    let deferred7_0;
    let deferred7_1;
    try {
        const ptr0 = passStringToWasm0(attestations_v2_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(target_schema_id_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(stealth_privkey_bytes, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(trait_data_hash_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(external_nullifier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.generate_reputation_witness_v2(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        var ptr6 = ret[0];
        var len6 = ret[1];
        if (ret[3]) {
            ptr6 = 0; len6 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred7_0 = ptr6;
        deferred7_1 = len6;
        return getStringFromWasm0(ptr6, len6);
    } finally {
        wasm.__wbindgen_free(deferred7_0, deferred7_1, 1);
    }
}

export function init() {
    wasm.init();
}

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
 * @param {Uint8Array} master_spend_priv_bytes
 * @param {Uint8Array} master_view_priv_bytes
 * @param {Uint8Array} ephemeral_pubkey_bytes
 * @returns {Uint8Array}
 */
export function reconstruct_signing_key_wasm(master_spend_priv_bytes, master_view_priv_bytes, ephemeral_pubkey_bytes) {
    const ptr0 = passArray8ToWasm0(master_spend_priv_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(master_view_priv_bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(ephemeral_pubkey_bytes, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.reconstruct_signing_key_wasm(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

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
 * @param {string} announcements_json
 * @param {string} schemas_json
 * @param {Uint8Array} view_privkey_bytes
 * @param {Uint8Array} spend_pubkey_bytes
 * @param {bigint} current_slot
 * @param {string} trusted_issuers_json
 * @returns {string}
 */
export function scan_attestations_v2_wasm(announcements_json, schemas_json, view_privkey_bytes, spend_pubkey_bytes, current_slot, trusted_issuers_json) {
    let deferred7_0;
    let deferred7_1;
    try {
        const ptr0 = passStringToWasm0(announcements_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(schemas_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(view_privkey_bytes, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(spend_pubkey_bytes, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(trusted_issuers_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.scan_attestations_v2_wasm(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, current_slot, ptr4, len4);
        var ptr6 = ret[0];
        var len6 = ret[1];
        if (ret[3]) {
            ptr6 = 0; len6 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred7_0 = ptr6;
        deferred7_1 = len6;
        return getStringFromWasm0(ptr6, len6);
    } finally {
        wasm.__wbindgen_free(deferred7_0, deferred7_1, 1);
    }
}

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
 * @param {string} announcements_json
 * @param {Uint8Array} view_privkey_bytes
 * @param {Uint8Array} spend_pubkey_bytes
 * @returns {string}
 */
export function scan_attestations_wasm(announcements_json, view_privkey_bytes, spend_pubkey_bytes) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(announcements_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(view_privkey_bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(spend_pubkey_bytes, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.scan_attestations_wasm(ptr0, len0, ptr1, len1, ptr2, len2);
        var ptr4 = ret[0];
        var len4 = ret[1];
        if (ret[3]) {
            ptr4 = 0; len4 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_7534b8e9a36f1ab4: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_361308b2356cecd0: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_8a6f238a6ece86ea: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_set_6cb8631f80447a67: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_stack_0ed75d68575b0f3c: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./cryptography_bg.js": import0,
    };
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('cryptography_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
