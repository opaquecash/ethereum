/**
 * Attestation Engine V2 — client-side interaction layer (Ethereum)
 *
 * Types and helpers for the OpaqueAttestationRegistry contract: uid computation,
 * attestation-data encode/decode, and display utilities.
 */

import { encodePacked, sha256, type Address, type Hex } from "viem";
import { z } from "zod";

export interface AttestationV2 {
  /** Stable id (== uid). */
  address: string;
  /** uid = sha256(schema_id || issuer || stealth_address_hash || block) as 0x-hex. */
  uid: string;
  /** schemaId (== schemaPda for parity). */
  schemaPda: string;
  /** schema_id as 0x-hex. */
  schemaId: string;
  /** Issuer wallet address. */
  issuer: string;
  /** Privacy-preserving stealth address hash as 0x-hex (bytes32). */
  stealthAddressHash: string;
  /** ABI-encoded attestation data as 0x-hex. */
  dataHex: string;
  /** Block when the attestation was created. */
  createdAt: number;
  /** 0 = no expiry; else expiry block. */
  expirationSlot: number;
  /** 0 = not revoked; non-zero = revocation block. */
  revocationSlot: number;
  /** Optional reference UID as 0x-hex (zeros = none). */
  refUid: string;
  /** Derived: is the attestation currently valid? */
  isValid: boolean;
}

export interface AttestationFormData {
  schemaId: string;
  schemaPda: string;
  stealthAddressHash: string;
  fieldValues: Record<string, string>;
  expirationSlot: number;
  refUid: string;
}

export const ZERO_BYTES32 = ("0x" + "00".repeat(32)) as Hex;

/**
 * uid = sha256(abi.encodePacked(schemaId, issuer, stealthAddressHash, blockNumber)),
 * matching OpaqueAttestationRegistry.computeUid on-chain.
 */
export function computeUid(
  schemaId: Hex,
  issuer: Address,
  stealthAddressHash: Hex,
  blockNumber: bigint
): Hex {
  return sha256(
    encodePacked(
      ["bytes32", "address", "bytes32", "uint256"],
      [schemaId, issuer, stealthAddressHash, blockNumber]
    )
  );
}

/** ABI-encodes field values: per field, a 4-byte LE length prefix + UTF-8 bytes. */
export function encodeAttestationData(
  fieldValues: Record<string, string>,
  fieldDefs: { name: string; type: string }[]
): Hex {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const field of fieldDefs) {
    const value = fieldValues[field.name] ?? "";
    const encoded = enc.encode(value);
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, encoded.length, true);
    parts.push(lenBuf, encoded);
  }
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return bytesToHex(out);
}

/** Decodes attestation data back to a field-value map. */
export function decodeAttestationData(
  dataHex: string,
  fieldDefs: { name: string; type: string }[]
): Record<string, string> {
  const bytes = hexToBytes(dataHex);
  const dec = new TextDecoder();
  const result: Record<string, string> = {};
  let offset = 0;
  for (const field of fieldDefs) {
    if (offset + 4 > bytes.length) break;
    const len = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
    offset += 4;
    if (offset + len > bytes.length) break;
    result[field.name] = dec.decode(bytes.slice(offset, offset + len));
    offset += len;
  }
  return result;
}

export const AttestationV2Schema = z.object({
  address: z.string(),
  uid: z.string(),
  schemaPda: z.string(),
  schemaId: z.string(),
  issuer: z.string(),
  stealthAddressHash: z.string(),
  dataHex: z.string(),
  createdAt: z.number(),
  expirationSlot: z.number(),
  revocationSlot: z.number(),
  refUid: z.string(),
  isValid: z.boolean(),
});

export const AttestationV2ArraySchema = z.array(AttestationV2Schema);

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): Hex {
  return ("0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/** True if a UID is all-zero (no reference). */
export function isZeroUid(uid: string): boolean {
  return uid.replace(/^0x/, "").replace(/0/g, "") === "";
}

/** Formats a block number as an approximate distance from the current block (~12s/block). */
export function formatSlotDistance(block: number, currentBlock: number): string {
  if (block === 0) return "Never";
  const diff = block - currentBlock;
  if (diff <= 0) return "Expired";
  const seconds = diff * 12;
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `~${Math.round(seconds / 3600)}h`;
  return `~${Math.round(seconds / 86400)}d`;
}
