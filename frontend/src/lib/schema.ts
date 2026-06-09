/**
 * Schema Registry — V2 Stealth Reputation Protocol (Ethereum)
 *
 * Types and client-side utilities for the OpaqueSchemaRegistry contract. A schema
 * defines an attestation class and controls who may issue it.
 */

import { encodePacked, sha256, type Address, type Hex } from "viem";
import { z } from "zod";

export type FieldType = "bool" | "u8" | "u16" | "u32" | "u64" | "string" | "pubkey";

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
}

export interface SchemaV2 {
  /** Stable id (== schemaId). */
  address: string;
  /** schemaId = sha256(authority || name || version) as 0x-hex (bytes32). */
  schemaId: string;
  /** Wallet that created the schema. */
  authority: string;
  /** Optional resolver contract (zero address = none). */
  resolver: string;
  /** Whether attestations can be revoked. */
  revocable: boolean;
  /** Display name. */
  name: string;
  /** ABI-style field definitions, e.g. "bool passed, u64 score". */
  fieldDefinitions: string;
  /** Always 1 currently. */
  version: number;
  /** Authorized delegate addresses. */
  delegates: string[];
  /** Block when the schema was registered. */
  createdAt: number;
  /** 0 = no expiry; else the block after which no new attestations are accepted. */
  schemaExpirySlot: number;
  /** Whether the schema has been deprecated. */
  deprecated: boolean;
}

export const SCHEMA_VERSION = 1;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** Parsed field definition list from a fieldDefinitions string. */
export function parseFieldDefs(fieldDefs: string): FieldDef[] {
  if (!fieldDefs.trim()) return [];
  return fieldDefs.split(",").map((part, i) => {
    const trimmed = part.trim();
    const spaceIdx = trimmed.indexOf(" ");
    const type = (spaceIdx === -1 ? "string" : trimmed.slice(0, spaceIdx)) as FieldType;
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(spaceIdx + 1);
    return { id: String(i), name: name.trim(), type: type.trim() as FieldType };
  });
}

/** Converts a FieldDef array to the canonical ABI string. */
export function fieldDefsToString(fields: FieldDef[]): string {
  return fields
    .filter((f) => f.name.trim())
    .map((f) => `${f.type} ${f.name.trim()}`)
    .join(", ");
}

/**
 * Computes schemaId = sha256(abi.encodePacked(authority, bytes(name), version)),
 * byte-for-byte matching OpaqueSchemaRegistry.computeSchemaId on-chain.
 */
export function computeSchemaId(authority: Address, name: string, version = SCHEMA_VERSION): Hex {
  return sha256(encodePacked(["address", "string", "uint8"], [authority, name, version]));
}

/** Returns the schemaId hex as the BN254 field input the V2 circuit expects. */
export function packSchemaIdToField(schemaId: string): string {
  return schemaId.startsWith("0x") ? schemaId : "0x" + schemaId;
}

export const SchemaV2Schema = z.object({
  address: z.string(),
  schemaId: z.string(),
  authority: z.string(),
  resolver: z.string(),
  revocable: z.boolean(),
  name: z.string().max(64),
  fieldDefinitions: z.string().max(256),
  version: z.number(),
  delegates: z.array(z.string()),
  createdAt: z.number(),
  schemaExpirySlot: z.number(),
  deprecated: z.boolean(),
});

export const SchemaV2ArraySchema = z.array(SchemaV2Schema);
