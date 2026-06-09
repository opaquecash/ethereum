/**
 * Schema + V2 Attestation Store (Ethereum)
 *
 * Zustand store caching discovered schemas and V2 attestations locally. Schemas and
 * attestations are read from the OpaqueSchemaRegistry / OpaqueAttestationRegistry
 * contracts via lib/psr.ts; V2 discovered traits come from the WASM scanner.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SchemaV2 } from "../lib/schema";
import type { AttestationV2 } from "../lib/attestationV2";

export interface V2DiscoveredTrait {
  stealthAddress: string;
  schemaId: string;
  schemaName: string;
  issuer: string;
  attestationUid: string;
  dataHex: string;
  nonce: string;
  merkleLeafPreimage: {
    stealthPkField: string;
    schemaIdField: string;
    issuerPkX: string;
    traitDataHash: string;
    nonceField: string;
  };
  txHash: string;
  slot: number;
  isValid: boolean;
  issuerAuthorized: boolean;
  isV2: boolean;
  chainDiscoveryOnly?: boolean;
}

interface SchemaStoreState {
  schemas: Record<string, SchemaV2>;
  discoveredTraits: Record<string, V2DiscoveredTrait>;
  attestations: Record<string, AttestationV2>;
  isFetchingSchemas: boolean;
  isScanning: boolean;
  lastScannedSlot: number;

  setSchemas: (schemas: SchemaV2[]) => void;
  addSchema: (schema: SchemaV2) => void;
  setDiscoveredTraits: (traits: V2DiscoveredTrait[]) => void;
  addDiscoveredTrait: (trait: V2DiscoveredTrait) => void;
  markTraitInvalid: (attestationUid: string) => void;
  setAttestations: (attestations: AttestationV2[]) => void;
  setIsFetchingSchemas: (v: boolean) => void;
  setIsScanning: (v: boolean) => void;
  setLastScannedSlot: (slot: number) => void;
  clearTraits: () => void;
}

export const useSchemaStore = create<SchemaStoreState>()(
  persist(
    (set) => ({
      schemas: {},
      discoveredTraits: {},
      attestations: {},
      isFetchingSchemas: false,
      isScanning: false,
      lastScannedSlot: 0,

      setSchemas: (schemas) =>
        set({ schemas: Object.fromEntries(schemas.map((s) => [s.schemaId, s])) }),
      addSchema: (schema) =>
        set((state) => ({ schemas: { ...state.schemas, [schema.schemaId]: schema } })),
      setDiscoveredTraits: (traits) =>
        set({ discoveredTraits: Object.fromEntries(traits.map((t) => [t.attestationUid, t])) }),
      addDiscoveredTrait: (trait) =>
        set((state) => ({
          discoveredTraits: { ...state.discoveredTraits, [trait.attestationUid]: trait },
        })),
      markTraitInvalid: (attestationUid) =>
        set((state) => {
          const trait = state.discoveredTraits[attestationUid];
          if (!trait) return state;
          return {
            discoveredTraits: {
              ...state.discoveredTraits,
              [attestationUid]: { ...trait, isValid: false },
            },
          };
        }),
      setAttestations: (attestations) =>
        set({ attestations: Object.fromEntries(attestations.map((a) => [a.uid, a])) }),
      setIsFetchingSchemas: (v) => set({ isFetchingSchemas: v }),
      setIsScanning: (v) => set({ isScanning: v }),
      setLastScannedSlot: (slot) => set({ lastScannedSlot: slot }),
      clearTraits: () => set({ discoveredTraits: {} }),
    }),
    {
      name: "opaque-schema-store-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        schemas: state.schemas,
        discoveredTraits: state.discoveredTraits,
        lastScannedSlot: state.lastScannedSlot,
      }),
    }
  )
);

/** All schemas, most recent first. */
export function selectSchemasArray(state: SchemaStoreState): SchemaV2[] {
  return Object.values(state.schemas).sort((a, b) => b.createdAt - a.createdAt);
}

/** Valid (non-revoked, non-expired, issuer-authorized) discovered traits. */
export function selectValidTraits(state: SchemaStoreState): V2DiscoveredTrait[] {
  return Object.values(state.discoveredTraits).filter((t) => t.isValid && t.issuerAuthorized);
}

/** Schemas where the connected wallet is the authority or a delegate. */
export function selectMySchemas(state: SchemaStoreState, walletAddress: string): SchemaV2[] {
  const lower = walletAddress.toLowerCase();
  return Object.values(state.schemas).filter(
    (s) =>
      s.authority.toLowerCase() === lower ||
      s.delegates.some((d) => d.toLowerCase() === lower)
  );
}
