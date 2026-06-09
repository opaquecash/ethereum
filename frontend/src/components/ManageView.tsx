/**
 * Manage — schema + attestation administration (Ethereum)
 *
 * For schemas the connected wallet owns: deprecate, add/remove delegates, update
 * resolver. Lists attestations issued under those schemas with a revoke action.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type { EIP1193Provider, Address, Hex } from "viem";
import { useWallet } from "../hooks/useWallet";
import { useToast } from "../context/ToastContext";
import { ZERO_ADDRESS } from "../lib/schema";
import { formatSlotDistance, type AttestationV2 } from "../lib/attestationV2";
import {
  getV2Config,
  fetchAllSchemas,
  fetchAllAttestations,
  deprecateSchema,
  addDelegate,
  removeDelegate,
  updateResolver,
  revoke,
  getCurrentBlock,
} from "../lib/psr";
import { useSchemaStore } from "../store/schemaStore";

export type ManageViewProps = {
  onNavigate?: (tab: string) => void;
};

function isEthAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

export function ManageView({ onNavigate }: ManageViewProps = {}) {
  const { address: walletAddress, chainId, isConnected } = useWallet();
  const { showToast } = useToast();

  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const setAttestations = useSchemaStore((s) => s.setAttestations);
  const attestations = useSchemaStore((s) => s.attestations);
  const schemasMap = useSchemaStore((s) => s.schemas);
  const mySchemas = useMemo(() => {
    if (!walletAddress) return [];
    const lower = walletAddress.toLowerCase();
    return Object.values(schemasMap).filter(
      (s) => s.authority.toLowerCase() === lower || s.delegates.some((d) => d.toLowerCase() === lower)
    );
  }, [schemasMap, walletAddress]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delegateInputs, setDelegateInputs] = useState<Record<string, string>>({});
  const [currentBlock, setCurrentBlock] = useState(0);

  const v2Configured = getV2Config(chainId) != null;

  const refresh = useCallback(async () => {
    if (chainId == null || !getV2Config(chainId)) return;
    try {
      const [schemas, atts, block] = await Promise.all([
        fetchAllSchemas(chainId),
        fetchAllAttestations(chainId),
        getCurrentBlock(chainId),
      ]);
      setSchemas(schemas);
      setAttestations(atts);
      setCurrentBlock(block);
    } catch {
      /* best-effort */
    }
  }, [chainId, setSchemas, setAttestations]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ownedSchemaIds = new Set(mySchemas.map((s) => s.schemaId));
  const myAttestations: AttestationV2[] = Object.values(attestations).filter((a) =>
    ownedSchemaIds.has(a.schemaId)
  );

  const run = async (key: string, fn: (ctx: { chainId: number; provider: EIP1193Provider; account: Address }) => Promise<Hex>, label: string) => {
    const provider = (window as { ethereum?: EIP1193Provider }).ethereum;
    if (!walletAddress || chainId == null || !provider) return;
    setBusy(key);
    setError(null);
    try {
      const txHash = await fn({ chainId, provider, account: walletAddress });
      showToast(label, { explorerTx: { chainId, txHash } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : label + " failed.");
    } finally {
      setBusy(null);
    }
  };

  if (!isConnected) {
    return <p className="px-4 py-6 text-sm text-mist">Connect a wallet to manage schemas.</p>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Manage</h1>
          <p className="mt-1 text-sm text-mist">Administer your schemas and issued attestations.</p>
        </div>
        <div className="flex items-center gap-2">
          {onNavigate && (
            <>
              <button onClick={() => onNavigate("schemas")} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-mist hover:text-white">
                New schema
              </button>
              <button onClick={() => onNavigate("attest")} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-mist hover:text-white">
                Issue attestation
              </button>
            </>
          )}
          <button onClick={() => void refresh()} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-mist hover:text-white">
            Refresh
          </button>
        </div>
      </header>

      {!v2Configured && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          The V2 reputation contracts are not configured for this network.
        </div>
      )}
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-mist/70">My schemas</h2>
        {mySchemas.length === 0 ? (
          <p className="text-sm text-mist/70">
            No schemas yet.{" "}
            {onNavigate && (
              <button className="text-glow hover:underline" onClick={() => onNavigate("schemas")}>
                Create one.
              </button>
            )}
          </p>
        ) : (
          <div className="space-y-4">
            {mySchemas.map((s) => (
              <div key={s.schemaId} className="rounded-2xl border border-ink-700 bg-ink-900/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-white">{s.name}</p>
                    <p className="font-mono text-[11px] text-mist/60">{s.schemaId.slice(0, 18)}…</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${s.deprecated ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                    {s.deprecated ? "deprecated" : "active"}
                  </span>
                </div>

                <div className="mt-3 text-xs text-mist/70">Field defs: <span className="text-mist">{s.fieldDefinitions || "—"}</span></div>

                <div className="mt-3">
                  <p className="mb-1 text-xs text-mist/70">Delegates</p>
                  {s.delegates.length === 0 ? (
                    <p className="text-xs text-mist/50">none</p>
                  ) : (
                    <ul className="space-y-1">
                      {s.delegates.map((d) => (
                        <li key={d} className="flex items-center justify-between gap-2 font-mono text-[11px] text-mist">
                          <span>{d}</span>
                          <button
                            disabled={busy != null}
                            onClick={() => run(`rmdel-${s.schemaId}-${d}`, (ctx) => removeDelegate(ctx, s.schemaId as Hex, d as Address), "Delegate removed")}
                            className="rounded border border-ink-700 px-2 py-0.5 text-[10px] text-mist hover:text-white disabled:opacity-40"
                          >
                            remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      value={delegateInputs[s.schemaId] ?? ""}
                      onChange={(e) => setDelegateInputs((p) => ({ ...p, [s.schemaId]: e.target.value }))}
                      placeholder="0x delegate address"
                      className="flex-1 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 font-mono text-[11px] text-white"
                    />
                    <button
                      disabled={busy != null || !isEthAddress(delegateInputs[s.schemaId] ?? "")}
                      onClick={() => run(`adddel-${s.schemaId}`, (ctx) => addDelegate(ctx, s.schemaId as Hex, (delegateInputs[s.schemaId] || "").trim() as Address), "Delegate added")}
                      className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-mist hover:text-white disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!s.deprecated && (
                    <button
                      disabled={busy != null}
                      onClick={() => run(`dep-${s.schemaId}`, (ctx) => deprecateSchema(ctx, s.schemaId as Hex), "Schema deprecated")}
                      className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      Deprecate
                    </button>
                  )}
                  <button
                    disabled={busy != null}
                    onClick={() => run(`res-${s.schemaId}`, (ctx) => updateResolver(ctx, s.schemaId as Hex, ZERO_ADDRESS), "Resolver cleared")}
                    className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-mist hover:text-white disabled:opacity-40"
                  >
                    Clear resolver
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-mist/70">
          Issued attestations
        </h2>
        {myAttestations.length === 0 ? (
          <p className="text-sm text-mist/70">No attestations issued under your schemas yet.</p>
        ) : (
          <div className="space-y-2">
            {myAttestations.map((a) => {
              const schema = mySchemas.find((s) => s.schemaId === a.schemaId);
              const status =
                a.revocationSlot !== 0
                  ? "revoked"
                  : a.expirationSlot !== 0 && currentBlock >= a.expirationSlot
                    ? "expired"
                    : "valid";
              return (
                <div key={a.uid} className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[11px] text-mist">{a.uid.slice(0, 22)}…</p>
                    <span className="text-xs text-mist/60">
                      {status}
                      {status === "valid" && a.expirationSlot !== 0 && (
                        <> · expires {formatSlotDistance(a.expirationSlot, currentBlock)}</>
                      )}
                    </span>
                  </div>
                  {schema?.revocable && a.revocationSlot === 0 && (
                    <button
                      disabled={busy != null}
                      onClick={() => run(`rev-${a.uid}`, (ctx) => revoke(ctx, a.uid as Hex), "Attestation revoked")}
                      className="mt-2 rounded-lg border border-red-500/30 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
