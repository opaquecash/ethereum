/**
 * My Traits — discover V2 attestations + proof generation (Ethereum)
 *
 * Scans cached Announcement events with the connected wallet's viewing key via
 * the V2 WASM scanner (scan_attestations_v2_wasm), surfaces the matched traits,
 * and lets the user prove one via ProofGeneratorModal.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { pad, getAddress, type Address } from "viem";
import { useWallet } from "../hooks/useWallet";
import { useKeys } from "../context/KeysContext";
import { useOpaqueWasm } from "../hooks/useOpaqueWasm";
import { useSchemaStore, type V2DiscoveredTrait } from "../store/schemaStore";
import { getV2Config, fetchAllSchemas, getCurrentBlock, fetchV2Announcements } from "../lib/psr";
import { hexToBytes } from "../lib/attestationV2";
import { getExplorerAddressUrl } from "../lib/explorer";
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

/** Mask a long hex value, showing only the start and end. */
function mask(s: string): string {
  if (!s) return "—";
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

/** The issuer rides in the announcement as a 32-byte left-padded value. Recover
 *  the 20-byte EVM address (last 20 bytes) and checksum it; null if not an address. */
function issuerAddress(issuer: string): Address | null {
  const hex = issuer.startsWith("0x") ? issuer.slice(2) : issuer;
  if (hex.length < 40 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  try {
    return getAddress(`0x${hex.slice(-40)}`);
  } catch {
    return null;
  }
}

/** Issuer address, linked to the block explorer when one is known. */
function IssuerLink({ chainId, issuer }: { chainId: number | null | undefined; issuer: string }) {
  const url = chainId != null ? getExplorerAddressUrl(chainId, issuer) : null;
  if (!url) return <span className="font-mono text-mist">{mask(issuer)}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-mist underline-offset-2 hover:text-glow hover:underline"
    >
      {mask(issuer)}
    </a>
  );
}

function TraitIcon() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ink-700 bg-ink-950 text-glow">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    </span>
  );
}

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
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return traits;
    return traits.filter(
      (t) =>
        (t.schemaName || "").toLowerCase().includes(q) ||
        t.issuer.toLowerCase().includes(q) ||
        t.attestationUid.toLowerCase().includes(q)
    );
  }, [traits, query]);

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
        issuer:
          issuerAddress(att.issuer) ??
          (att.issuer.startsWith("0x") ? att.issuer : `0x${att.issuer}`),
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
      ) : (
        <>
          {traits.length > 0 && (
            <div className="relative mb-4">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist/50">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by schema, issuer, or UID"
                className="w-full rounded-xl border border-ink-700 bg-ink-950 py-2 pl-9 pr-3 text-sm text-white placeholder:text-mist/40"
              />
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 p-8 text-center">
              <p className="text-sm text-mist">
                {traits.length === 0
                  ? scanning
                    ? "Scanning announcements…"
                    : "No traits discovered yet."
                  : "No traits match your search."}
              </p>
              {traits.length === 0 && (
                <p className="mt-1 text-xs text-mist/60">
                  Traits appear here once the scanner detects a V2 attestation announcement
                  addressed to one of your stealth addresses. Make sure your announcements have
                  synced, then Scan.
                </p>
              )}
              {traits.length === 0 && onNavigate && (
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
              {filtered.map((t) => (
                <div key={t.attestationUid} className="rounded-2xl border border-ink-700 bg-ink-900/60 p-4">
                  <div className="flex items-start gap-3">
                    <TraitIcon />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium text-white">
                          {t.schemaName || "Attestation"}
                        </p>
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                          valid
                        </span>
                      </div>
                      <dl className="mt-2 grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt className="text-mist/50">Issuer</dt>
                        <dd title={t.issuer}><IssuerLink chainId={chainId} issuer={t.issuer} /></dd>
                        <dt className="text-mist/50">UID</dt>
                        <dd className="font-mono text-mist" title={t.attestationUid}>{mask(t.attestationUid)}</dd>
                      </dl>
                      <button
                        onClick={() => setProving(t)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-glow px-3 py-1.5 text-xs font-semibold text-ink-950"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" />
                        </svg>
                        Prove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {proving && <ProofGeneratorModal trait={proving} onClose={() => setProving(null)} />}
    </div>
  );
}
