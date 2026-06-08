/**
 * EIP-5564 sender/receiver key material — matches Opaque wallet derivation (`opaque-cash-v1` HKDF).
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
 * Canonical message a wallet must sign before {@link deriveKeysFromSignature}.
 * Chain-neutral by design — the same wallet derives the same keys everywhere.
 * MUST match `spec/CSAP.md` §2.2 and both frontends' `SETUP_MESSAGE` byte-for-byte.
 */
export const SETUP_MESSAGE =
  "Sign this message to derive your Opaque Cash stealth keys. This does not approve any transaction.";

export function deriveKeysFromSignature(signatureHex: Hex): {
  viewingKey: Uint8Array;
  spendingKey: Uint8Array;
} {
  const sigBytes =
    typeof signatureHex === "string"
      ? signatureHex.startsWith("0x")
        ? signatureHex.slice(2)
        : signatureHex
      : signatureHex;
  const sig =
    typeof sigBytes === "string" ? hexToBytes(sigBytes) : sigBytes;
  const okm = hkdf(sha256, sig, undefined, DOMAIN, 64);
  return { viewingKey: okm.slice(0, 32), spendingKey: okm.slice(32, 64) };
}

export function keysToStealthMetaAddress(
  viewingKey: Uint8Array,
  spendingKey: Uint8Array,
): { V: Uint8Array; S: Uint8Array; metaAddress: Uint8Array } {
  const V = CURVE.getPublicKey(viewingKey, true);
  const S = CURVE.getPublicKey(spendingKey, true);
  const metaAddress = new Uint8Array(V.length + S.length);
  metaAddress.set(V, 0);
  metaAddress.set(S, V.length);
  return { V, S, metaAddress };
}

export function stealthMetaAddressToHex(metaAddress: Uint8Array): Hex {
  return (`0x${bytesToHex(metaAddress)}`) as Hex;
}

export function parseStealthMetaAddress(metaHex: Hex): {
  viewPubKey: Uint8Array;
  spendPubKey: Uint8Array;
} {
  const raw =
    typeof metaHex === "string" && metaHex.startsWith("0x")
      ? metaHex.slice(2)
      : metaHex;
  const bytes = hexToBytes(raw);
  if (bytes.length < 66) {
    throw new Error("Invalid stealth meta-address: expected 66 bytes");
  }
  return {
    viewPubKey: bytes.slice(0, 33),
    spendPubKey: bytes.slice(33, 66),
  };
}

function assertCompressedPubkey33(name: string, key: Uint8Array): void {
  if (key.length !== 33) {
    throw new Error(`Opaque: ${name} must be 33 bytes (compressed), got ${key.length}`);
  }
  const prefix = key[0];
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new Error(
      `Opaque: ${name} must start with 0x02 or 0x03 (compressed), got 0x${prefix.toString(16)}`,
    );
  }
}

function sharedSecretSender(
  ephemeralPriv: Uint8Array,
  viewPubKey: Uint8Array,
): Uint8Array {
  assertCompressedPubkey33("viewPubKey", viewPubKey);
  const P = CURVE.ProjectivePoint.fromHex(viewPubKey);
  const scalar = bytesToBigInt(ephemeralPriv) % CURVE.CURVE.n;
  if (scalar === 0n) throw new Error("Invalid ephemeral key");
  return P.multiply(scalar).toRawBytes(true);
}

function hashSharedSecret(sharedSecret: Uint8Array): {
  sH: Uint8Array;
  viewTag: number;
} {
  const sH = keccak_256(sharedSecret);
  return { sH, viewTag: sH[0] };
}

function stealthPointAndAddress(
  spendPubKey: Uint8Array,
  sH: Uint8Array,
): { stealthAddress: Address } {
  const n = CURVE.CURVE.n;
  const sHBig = bytesToBigInt(sH);
  const sHMod = sHBig % n;
  if (sHMod === 0n) throw new Error("Invalid scalar from hash");
  const S_h = CURVE.ProjectivePoint.BASE.multiply(sHMod);
  assertCompressedPubkey33("spendPubKey", spendPubKey);
  const P_spend = CURVE.ProjectivePoint.fromHex(spendPubKey);
  const P_stealth = P_spend.add(S_h);
  const uncompressed = P_stealth.toRawBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  const addr = getAddress(
    (`0x${bytesToHex(hash.slice(12))}`) as Hex,
  );
  return { stealthAddress: addr };
}

export function computeStealthAddressAndViewTag(recipientMetaAddressHex: Hex): {
  ephemeralPriv: Uint8Array;
  ephemeralPubKey: Uint8Array;
  stealthAddress: Address;
  viewTag: number;
  metadata: Uint8Array;
} {
  const { viewPubKey, spendPubKey } =
    parseStealthMetaAddress(recipientMetaAddressHex);
  const ephemeralPriv = CURVE.utils.randomPrivateKey();
  const ephemeralPubKey = CURVE.getPublicKey(ephemeralPriv, true);
  const shared = sharedSecretSender(ephemeralPriv, viewPubKey);
  const { sH, viewTag } = hashSharedSecret(shared);
  const { stealthAddress } = stealthPointAndAddress(spendPubKey, sH);
  const metadata = new Uint8Array(1);
  metadata[0] = viewTag;
  return {
    ephemeralPriv,
    ephemeralPubKey,
    stealthAddress,
    viewTag,
    metadata,
  };
}

/**
 * Re-derive stealth material from a fixed 32-byte ephemeral secret (manual “ghost” receive).
 * Must match {@link computeStealthAddressAndViewTag} for the same meta-address and scalar.
 */
/** 33-byte compressed secp256k1 pubkey for a 32-byte ephemeral secret (sender ghost material). */
export function ephemeralPrivateKeyToCompressedPublicKey(
  ephemeralPrivateKey: Uint8Array,
): Uint8Array {
  if (ephemeralPrivateKey.length !== 32) {
    throw new Error("Ephemeral private key must be 32 bytes.");
  }
  return CURVE.getPublicKey(ephemeralPrivateKey, true);
}

export function recomputeStealthSendFromEphemeralPrivateKey(
  recipientMetaAddressHex: Hex,
  ephemeralPrivateKey: Uint8Array,
): {
  ephemeralPriv: Uint8Array;
  ephemeralPubKey: Uint8Array;
  stealthAddress: Address;
  viewTag: number;
  metadata: Uint8Array;
} {
  if (ephemeralPrivateKey.length !== 32) {
    throw new Error("Ephemeral private key must be 32 bytes.");
  }
  const { viewPubKey, spendPubKey } =
    parseStealthMetaAddress(recipientMetaAddressHex);
  const ephemeralPriv = ephemeralPrivateKey;
  const ephemeralPubKey = CURVE.getPublicKey(ephemeralPriv, true);
  const shared = sharedSecretSender(ephemeralPriv, viewPubKey);
  const { sH, viewTag } = hashSharedSecret(shared);
  const { stealthAddress } = stealthPointAndAddress(spendPubKey, sH);
  const metadata = new Uint8Array(1);
  metadata[0] = viewTag;
  return {
    ephemeralPriv,
    ephemeralPubKey,
    stealthAddress,
    viewTag,
    metadata,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2) throw new Error("Invalid hex length");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
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
