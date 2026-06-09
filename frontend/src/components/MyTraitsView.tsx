/**
 * My Traits — discover V2 attestations + proof generation (Ethereum)
 *
 * Scans cached Announcement events with the connected wallet's viewing key via
 * the V2 WASM scanner (scan_attestations_v2_wasm), surfaces the matched traits,
 * and lets the user prove one via ProofGeneratorModal. Ported from the Solana
 * MyTraitsView.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { pad, type Address } from "viem";
import { useWallet } from "../hooks/useWallet";
import { useKeys } from "../context/KeysContext";
import { useOpaqueWasm } from "../hooks/useOpaqueWasm";
import { useSchemaStore, type V2DiscoveredTrait } from "../store/schemaStore";
import { getV2Config, fetchAllSchemas, getCurrentBlock, fetchV2Announcements } from "../lib/psr";
import { hexToBytes } from "../lib/attestationV2";
import { ProofGeneratorModal } from "./ProofGeneratorModal";

export type MyTraitsViewProps = {
  onNavigate?: (tab: string) => void;
};

type ScanResult = {
  stealth_address: string;
  schema_id: string;
  schema_name?: string | null;
  issuer: string;
  attestation_uid: string;
  data_hex: string;
  nonce: string;
  merkle_leaf_preimage: {
    stealth_pk_field: string;
    schema_id_field: string;
    issuer_pk_x: string;
    trait_data_hash: string;
    nonce_field: string;
  };
  tx_hash: string;
  slot: number;
  is_valid: boolean;
  issuer_authorized: boolean;
};

export function MyTraitsView({ onNavigate }: MyTraitsViewProps = {}) {
  const { chainId, isConnected } = useWallet();
  const { isSetup, getMasterKeys } = useKeys();
  const { wasm, isReady: wasmReady } = useOpaqueWasm();

  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const setDiscoveredTraits = useSchemaStore((s) => s.setDiscoveredTraits);
  const discoveredTraits = useSchemaStore((s) => s.discoveredTraits);
  const traits = useMemo(
    () => Object.values(discoveredTraits).filter((t) => t.isValid && t.issuerAuthorized),
    [discoveredTraits]
  );

  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proving, setProving] = useState<V2DiscoveredTrait | null>(null);

  const v2Configured = getV2Config(chainId) != null;

  const scan = useCallback(async () => {
    if (chainId == null || !getV2Config(chainId) || !isSetup || !wasmReady || !wasm) return;
    setScanning(true);
    setError(null);
    try {
      const master = getMasterKeys();
      const [schemas, announcements, currentBlock] = await Promise.all([
        fetchAllSchemas(chainId),
        fetchV2Announcements(chainId),
        getCurrentBlock(chainId),
      ]);
      setSchemas(schemas);

      const announcementsPayload = announcements.map((a) => ({
        stealthAddress: a.stealthAddress,
        viewTag: parseInt((a.metadata || "0x00").slice(2, 4) || "0", 16),
        ephemeralPubKey: a.ephemeralPubKey,
        metadata: a.metadata,
        txHash: a.txHash,
        blockNumber: a.blockNumber,
      }));

      // The scanner compares the announcement issuer (32 bytes) to the schema
      // authority/delegates; left-pad the 20-byte addresses to 32 bytes so they
      // match the issuer encoded into the announcement (see psr.encodeV2AttestationMetadata).
      const schemasPayload = schemas.map((s) => ({
        schema_id: Array.from(hexToBytes(s.schemaId)),
        authority: Array.from(hexToBytes(pad(s.authority as Address, { size: 32 }))),
        delegates: s.delegates.map((d) => Array.from(hexToBytes(pad(d as Address, { size: 32 })))),
        deprecated: s.deprecated,
        schema_expiry_slot: s.schemaExpirySlot,
        name: s.name,
      }));

      const resultJson = wasm.scan_attestations_v2_wasm(
        JSON.stringify(announcementsPayload),
        JSON.stringify(schemasPayload),
        master.viewPrivKey,
        master.spendPubKey,
        BigInt(currentBlock),
        "[]"
      );

      const parsed = JSON.parse(resultJson) as ScanResult[];
      const mapped: V2DiscoveredTrait[] = parsed.map((att) => ({
        stealthAddress: att.stealth_address,
        schemaId: att.schema_id.startsWith("0x") ? att.schema_id : `0x${att.schema_id}`,
        schemaName: att.schema_name ?? "Unknown Schema",
        issuer: att.issuer.startsWith("0x") ? att.issuer : `0x${att.issuer}`,
        attestationUid: att.attestation_uid.startsWith("0x")
          ? att.attestation_uid
          : `0x${att.attestation_uid}`,
        dataHex: att.data_hex,
        nonce: att.nonce.startsWith("0x") ? att.nonce : `0x${att.nonce}`,
        merkleLeafPreimage: {
          stealthPkField: att.merkle_leaf_preimage.stealth_pk_field,
          schemaIdField: att.merkle_leaf_preimage.schema_id_field,
          issuerPkX: att.merkle_leaf_preimage.issuer_pk_x,
          traitDataHash: att.merkle_leaf_preimage.trait_data_hash,
          nonceField: att.merkle_leaf_preimage.nonce_field,
        },
        txHash: att.tx_hash,
        slot: att.slot,
        isValid: att.is_valid,
        issuerAuthorized: att.issuer_authorized,
        isV2: true,
      }));
      setDiscoveredTraits(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }, [chainId, isSetup, wasmReady, wasm, getMasterKeys, setSchemas, setDiscoveredTraits]);

  useEffect(() => {
    void scan();
  }, [scan]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">My Traits</h1>
          <p className="mt-1 text-sm text-mist">
            Reputation attestations issued to your stealth addresses. Prove one without revealing
            which address holds it.
          </p>
        </div>
        <button
          onClick={() => void scan()}
          disabled={scanning || !wasmReady || !isSetup}
          className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-mist hover:text-white disabled:opacity-40"
        >
          {scanning ? "Scanning…" : "Scan"}
        </button>
      </header>

      {!v2Configured && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          The V2 reputation contracts are not configured for this network.
        </div>
      )}
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {!isConnected ? (
        <p className="text-sm text-mist">Connect a wallet to see your traits.</p>
      ) : traits.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 p-8 text-center">
          <p className="text-sm text-mist">
            {scanning ? "Scanning announcements…" : "No traits discovered yet."}
          </p>
          <p className="mt-1 text-xs text-mist/60">
            Traits appear here once the scanner detects a V2 attestation announcement addressed to
            one of your stealth addresses. Make sure your announcements have synced, then Scan.
          </p>
          {onNavigate && (
            <button
              onClick={() => onNavigate("schemas")}
              className="mt-4 text-xs text-glow hover:underline"
            >
              Explore schemas
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {traits.map((t) => (
            <div key={t.attestationUid} className="rounded-2xl border border-ink-700 bg-ink-900/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">{t.schemaName || "Attestation"}</p>
                  <p className="font-mono text-[11px] text-mist/60">
                    issuer {t.issuer.slice(0, 10)}… · uid {t.attestationUid.slice(0, 12)}…
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                  valid
                </span>
              </div>
              <button
                onClick={() => setProving(t)}
                className="mt-3 rounded-lg bg-glow px-3 py-1.5 text-xs font-semibold text-ink-950 disabled:opacity-40"
              >
                Prove
              </button>
            </div>
          ))}
        </div>
      )}

      {proving && <ProofGeneratorModal trait={proving} onClose={() => setProving(null)} />}
    </div>
  );
}
