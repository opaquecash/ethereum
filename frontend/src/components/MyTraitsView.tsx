/**
 * My Traits — discovered V2 attestations + proof generation (Ethereum)
 *
 * Shows the V2 traits discovered for the connected wallet (populated by the V2
 * WASM scanner into the schema store) and lets the user prove one via
 * ProofGeneratorModal. Ported from the Solana MyTraitsView.
 */

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "../hooks/useWallet";
import { useSchemaStore, selectValidTraits, type V2DiscoveredTrait } from "../store/schemaStore";
import { getV2Config, fetchAllSchemas, fetchAllAttestations } from "../lib/psr";
import { ProofGeneratorModal } from "./ProofGeneratorModal";

export type MyTraitsViewProps = {
  onNavigate?: (tab: string) => void;
};

export function MyTraitsView({ onNavigate }: MyTraitsViewProps = {}) {
  const { chainId, isConnected } = useWallet();
  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const setAttestations = useSchemaStore((s) => s.setAttestations);
  const traits = useSchemaStore(selectValidTraits);
  const [refreshing, setRefreshing] = useState(false);
  const [proving, setProving] = useState<V2DiscoveredTrait | null>(null);

  const v2Configured = getV2Config(chainId) != null;

  const refresh = useCallback(async () => {
    if (chainId == null || !getV2Config(chainId)) return;
    setRefreshing(true);
    try {
      const [schemas, atts] = await Promise.all([
        fetchAllSchemas(chainId),
        fetchAllAttestations(chainId),
      ]);
      setSchemas(schemas);
      setAttestations(atts);
    } catch {
      /* best-effort */
    } finally {
      setRefreshing(false);
    }
  }, [chainId, setSchemas, setAttestations]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-mist hover:text-white disabled:opacity-40"
        >
          {refreshing ? "…" : "Refresh"}
        </button>
      </header>

      {!v2Configured && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          The V2 reputation contracts are not configured for this network.
        </div>
      )}

      {!isConnected ? (
        <p className="text-sm text-mist">Connect a wallet to see your traits.</p>
      ) : traits.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 p-8 text-center">
          <p className="text-sm text-mist">No traits discovered yet.</p>
          <p className="mt-1 text-xs text-mist/60">
            Traits appear here after the scanner detects a V2 attestation announcement addressed to
            one of your stealth addresses.
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
                disabled={t.chainDiscoveryOnly}
                className="mt-3 rounded-lg bg-glow px-3 py-1.5 text-xs font-semibold text-ink-950 disabled:opacity-40"
                title={t.chainDiscoveryOnly ? "Awaiting the V2 announcement to build a proof" : undefined}
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
