/**
 * Opaque Cash — Client-side stealth address crypto (EIP-5564 / DKSAP)
 *
 * Implements the Dual-Key Stealth Address Protocol: senders derive a one-time
 * stealth address from the recipient's meta-address (viewing + spending public keys);
 * recipients use their viewing key to detect transfers and spending key to sweep.
 * Uses @noble/curves secp256k1; compatible with the Rust WASM scanner.
 *
 * @see https://eips.ethereum.org/EIPS/eip-5564
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import type { Hex } from "viem";
import { getAddress, type Address } from "viem";

const CURVE = secp256k1;
const DOMAIN = "opaque-cash-v1";

/**
 * The ONE canonical message every Opaque entry point must ask the wallet to sign
 * before deriving stealth keys. Chain-neutral on purpose: a given wallet derives the
 * same key set regardless of which view it onboards through.
 *
 * MUST match `spec/CSAP.md` §2.2 exactly (byte-for-byte) and the Solana frontend's
 * `SETUP_MESSAGE`. Do not redefine this string anywhere else — import it. A regression
 * test pins it to the spec value.
 */
export const SETUP_MESSAGE =
  "Sign this message to derive your Opaque Cash stealth keys. This does not approve any transaction.";

// -----------------------------------------------------------------------------
// Key derivation from wallet signature (entropy)
// -----------------------------------------------------------------------------

/**
 * Derive viewing key (v) and spending key (s) from a wallet signature used as entropy.
 *
 * Uses HKDF-SHA256 to expand the signature into 64 bytes, then splits into two
 * 32-byte private keys. Domain string is "opaque-cash-v1". The signature is never
 * sent to a server; derivation is done entirely in the browser.
 *
 * @param signatureHex - EIP-191 or similar signature from the user's wallet (hex).
 * @returns viewingKey and spendingKey as 32-byte Uint8Arrays for EIP-5564 DKSAP.
 */
export function deriveKeysFromSignature(signatureHex: Hex): {
  viewingKey: Uint8Array;
  spendingKey: Uint8Array;
} {
  console.log("🔐 [Opaque] deriveKeysFromSignature");
  const sigBytes =
    typeof signatureHex === "string"
      ? (signatureHex.startsWith("0x") ? signatureHex.slice(2) : signatureHex)
      : signatureHex;
  const sig = typeof sigBytes === "string" ? hexToBytes(sigBytes) : sigBytes;
  const okm = hkdf(sha256, sig, undefined, DOMAIN, 64);
  const viewingKey = okm.slice(0, 32);
  const spendingKey = okm.slice(32, 64);
  console.log("🔐 [Opaque] Keys derived from signature ✅");
  return { viewingKey, spendingKey };
}

/**
 * Build the stealth meta-address from viewing and spending private keys.
 *
 * Meta-address = compressed(V) || compressed(S) (66 bytes total), where V and S
 * are the public keys for the viewing and spending keys. This is what recipients
 * share so senders can derive one-time stealth addresses. Per EIP-5564 schemeId 1
 * (secp256k1).
 *
 * @param viewingKey - 32-byte viewing private key (used to compute shared secret with ephemeral key).
 * @param spendingKey - 32-byte spending private key (used to derive one-time signing key).
 * @returns V, S as compressed pubkeys and metaAddress as 66-byte concatenation.
 */
export function keysToStealthMetaAddress(
  viewingKey: Uint8Array,
  spendingKey: Uint8Array
): { V: Uint8Array; S: Uint8Array; metaAddress: Uint8Array } {
  const V = CURVE.getPublicKey(viewingKey, true);
  const S = CURVE.getPublicKey(spendingKey, true);
  const metaAddress = new Uint8Array(V.length + S.length);
  metaAddress.set(V, 0);
  metaAddress.set(S, V.length);
  return { V, S, metaAddress };
}

/**
 * Encode the 66-byte stealth meta-address as 0x-prefixed hex (132 hex chars).
 *
 * @param metaAddress - compressed(V) || compressed(S) per EIP-5564.
 * @returns Hex string suitable for storage or passing to parseStealthMetaAddress / computeStealthAddressAndViewTag.
 */
export function stealthMetaAddressToHex(metaAddress: Uint8Array): Hex {
  return ("0x" + bytesToHex(metaAddress)) as Hex;
}

/**
 * Parse a recipient stealth meta-address into viewing and spending public keys.
 *
 * Format per EIP-5564: first 33 bytes = compressed viewing public key V, next 33 = compressed
 * spending public key S. Senders use V for ECDH and S for the stealth point (P_stealth = S + S_h).
 *
 * @param metaHex - 0x-prefixed hex string (132 hex chars = 66 bytes).
 * @returns viewPubKey and spendPubKey as 33-byte compressed secp256k1 points.
 * @throws if length is less than 66 bytes.
 */
export function parseStealthMetaAddress(metaHex: Hex): {
  viewPubKey: Uint8Array;
  spendPubKey: Uint8Array;
} {
  const raw =
    typeof metaHex === "string" && metaHex.startsWith("0x")
      ? metaHex.slice(2)
      : metaHex;
  const bytes = hexToBytes(raw);
  if (bytes.length < 66)
    throw new Error("Invalid stealth meta-address: expected 66 bytes");
  return {
    viewPubKey: bytes.slice(0, 33),
    spendPubKey: bytes.slice(33, 66),
  };
}

// -----------------------------------------------------------------------------
// Sender: derive stealth address and view tag (DKSAP)
// -----------------------------------------------------------------------------

/**
 * ECDH shared secret on the sender side: s = r · V (ephemeral private key × recipient viewing public key).
 *
 * The result is the compressed encoding of the curve point (33 bytes). EIP-5564 then hashes
 * this with Keccak-256 to obtain s_h; the first byte of the hash is the view tag. Both sender
 * and recipient compute the same s when the recipient uses their viewing key with the
 * ephemeral public key R.
 *
 * @param ephemeralPriv - Sender's ephemeral private key r (32 bytes).
 * @param viewPubKey - Recipient's compressed viewing public key V (33 bytes).
 * @returns Compressed shared secret point (33 bytes), to be hashed with Keccak-256.
 */
function sharedSecretSender(
  ephemeralPriv: Uint8Array,
  viewPubKey: Uint8Array
): Uint8Array {
  const P = CURVE.ProjectivePoint.fromHex(viewPubKey);
  const scalar = bytesToBigInt(ephemeralPriv) % CURVE.CURVE.n;
  if (scalar === 0n) throw new Error("Invalid ephemeral key");
  const sharedPoint = P.multiply(scalar);
  return sharedPoint.toRawBytes(true);
}

/**
 * Hash the shared secret per EIP-5564: s_h = Keccak256(s), view tag = s_h[0].
 *
 * The view tag allows the recipient's scanner to filter announcements without performing
 * full EC math for ~255/256 of them. Only when the tag matches do we derive the stealth
 * address and compare.
 *
 * @param sharedSecret - Compressed ECDH shared secret (33 bytes).
 * @returns sH (32-byte hash) and viewTag (first byte of sH).
 */
function hashSharedSecret(sharedSecret: Uint8Array): {
  sH: Uint8Array;
  viewTag: number;
} {
  const sH = keccak_256(sharedSecret);
  const viewTag = sH[0];
  return { sH, viewTag };
}

/**
 * Derive the stealth public key and Ethereum address from spending public key and hashed secret.
 *
 * DKSAP steps (EIP-5564):
 * 1. Reduce s_h mod n (curve order) to get a scalar.
 * 2. S_h = s_h · G (scalar multiplication on the generator).
 * 3. P_stealth = P_spend + S_h (point addition on secp256k1).
 * 4. Address = last 20 bytes of Keccak256(uncompressed(P_stealth)), then EIP-55.
 *
 * @param spendPubKey - Recipient's compressed spending public key S (33 bytes).
 * @param sH - 32-byte Keccak256 hash of the shared secret.
 * @returns The one-time stealth address where the sender will send funds.
 */
function stealthPointAndAddress(
  spendPubKey: Uint8Array,
  sH: Uint8Array
): { stealthAddress: Address } {
  const n = CURVE.CURVE.n;
  const sHBig = bytesToBigInt(sH);
  const sHMod = sHBig % n;
  if (sHMod === 0n) throw new Error("Invalid scalar from hash");
  const S_h = CURVE.ProjectivePoint.BASE.multiply(sHMod);
  const P_spend = CURVE.ProjectivePoint.fromHex(spendPubKey);
  const P_stealth = P_spend.add(S_h);
  const uncompressed = P_stealth.toRawBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  const addr = getAddress(("0x" + bytesToHex(hash.slice(12))) as Hex);
  return { stealthAddress: addr };
}

/**
 * Sender-side: compute a one-time stealth address and view tag for a recipient.
 *
 * This is the main entry point for sending to a stealth meta-address. It:
 * 1. Parses the recipient meta-address (V, S).
 * 2. Generates an ephemeral key pair (r, R).
 * 3. Computes shared secret s = r · V, then s_h = Keccak256(s), viewTag = s_h[0].
 * 4. Derives P_stealth = S + (s_h mod n)·G and the Ethereum address.
 * 5. Returns ephemeral key, stealth address, view tag, and metadata (for the Announcer).
 *
 * The recipient can later derive the same address and the one-time private key using
 * their viewing and spending keys with R (reconstruct_signing_key_wasm in WASM).
 *
 * @param recipientMetaAddressHex - Recipient's 66-byte meta-address (compressed(V) || compressed(S)) as hex.
 * @returns ephemeralPriv, ephemeralPubKey, stealthAddress, viewTag, and metadata (1 byte = view tag).
 * @see https://eips.ethereum.org/EIPS/eip-5564
 */
export function computeStealthAddressAndViewTag(
  recipientMetaAddressHex: Hex
): {
  ephemeralPriv: Uint8Array;
  ephemeralPubKey: Uint8Array;
  stealthAddress: Address;
  viewTag: number;
  metadata: Uint8Array;
} {
  console.log("🔐 [Opaque] computeStealthAddressAndViewTag", { recipientMeta: recipientMetaAddressHex.slice(0, 20) + "…" });
  const { viewPubKey, spendPubKey } = parseStealthMetaAddress(
    recipientMetaAddressHex
  );
  const ephemeralPriv = CURVE.utils.randomPrivateKey();
  const ephemeralPubKey = CURVE.getPublicKey(ephemeralPriv, true);

  const shared = sharedSecretSender(ephemeralPriv, viewPubKey);
  const { sH, viewTag } = hashSharedSecret(shared);
  const { stealthAddress } = stealthPointAndAddress(spendPubKey, sH);

  const metadata = new Uint8Array(1);
  metadata[0] = viewTag;

  console.log("🔐 [Opaque] Stealth address computed ✅", { stealth: stealthAddress.slice(0, 14) + "…", viewTag });
  return {
    ephemeralPriv,
    ephemeralPubKey,
    stealthAddress,
    viewTag,
    metadata,
  };
}

/**
 * Rebuild ERC-5564 announce() parameters for a manual ghost receive using the stored ephemeral
 * private key (same derivation as {@link computeStealthAddressAndViewTag} with a fixed r).
 */
export function buildGhostAnnouncementPayload(
  recipientMetaAddressHex: Hex,
  ephemeralPrivKeyHex: Hex
): {
  stealthAddress: Address;
  ephemeralPubKey: Uint8Array;
  metadata: Uint8Array;
  viewTag: number;
} {
  const { viewPubKey, spendPubKey } = parseStealthMetaAddress(recipientMetaAddressHex);
  const h = ephemeralPrivKeyHex.startsWith("0x") ? ephemeralPrivKeyHex.slice(2) : ephemeralPrivKeyHex;
  const ephemeralPriv = hexToBytes(h);
  if (ephemeralPriv.length !== 32) {
    throw new Error("Ephemeral private key must be 32 bytes.");
  }
  const ephemeralPubKey = CURVE.getPublicKey(ephemeralPriv, true);
  const shared = sharedSecretSender(ephemeralPriv, viewPubKey);
  const { sH, viewTag } = hashSharedSecret(shared);
  const { stealthAddress } = stealthPointAndAddress(spendPubKey, sH);
  const metadata = new Uint8Array(1);
  metadata[0] = viewTag;
  return { stealthAddress, ephemeralPubKey, metadata, viewTag };
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2) throw new Error("Invalid hex length");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = 0; i < b.length; i++) x = (x << 8n) | BigInt(b[i]);
  return x;
}

export { getAddress };
export type { Address, Hex };

// -----------------------------------------------------------------------------
// Gas tank: deterministic stealth address for paying gas (EIP-2612 permit flow)
// -----------------------------------------------------------------------------

const GAS_TANK_SALT = "opaque-gas-tank-v1";
const ANNOUNCER_SALT = "opaque-announcer-v1";

/**
 * Derive a deterministic 32-byte ephemeral private key for the gas tank from the user's meta-address.
 * Same meta-address always yields the same gas tank (same address + key) on this device.
 * Used with WASM reconstruct_signing_key_wasm(spendPriv, viewPriv, getPublicKey(ephemeralPriv))
 * to get the tank signing key and thus the tank address.
 */
export function deriveGasTankEphemeralKey(metaAddressHex: Hex): Uint8Array {
  const raw = typeof metaAddressHex === "string" && metaAddressHex.startsWith("0x") ? metaAddressHex.slice(2) : metaAddressHex;
  const seed = new TextEncoder().encode(raw + GAS_TANK_SALT);
  const okm = hkdf(sha256, seed, undefined, "opaque-gas-tank-ephemeral", 32);
  const n = CURVE.CURVE.n;
  let scalar = bytesToBigInt(okm) % n;
  if (scalar === 0n) scalar = 1n;
  const out = new Uint8Array(32);
  let x = scalar;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/**
 * Deterministic ephemeral scalar for the "Announcer" stealth signer (pays gas for ghost on-chain
 * announcements without linking the user's main connected wallet).
 */
export function deriveAnnouncerEphemeralKey(metaAddressHex: Hex): Uint8Array {
  const raw =
    typeof metaAddressHex === "string" && metaAddressHex.startsWith("0x")
      ? metaAddressHex.slice(2)
      : metaAddressHex;
  const seed = new TextEncoder().encode(raw + ANNOUNCER_SALT);
  const okm = hkdf(sha256, seed, undefined, "opaque-announcer-ephemeral", 32);
  const n = CURVE.CURVE.n;
  let scalar = bytesToBigInt(okm) % n;
  if (scalar === 0n) scalar = 1n;
  const out = new Uint8Array(32);
  let x = scalar;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
