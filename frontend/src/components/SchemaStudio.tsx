/**
 * Schema Studio — V2 Schema Registration UI (Ethereum)
 *
 * Allows issuers to define and register attestation schemas on-chain via the
 * OpaqueSchemaRegistry contract. A schema specifies the field layout,
 * revocability, optional expiry (as a block number), and an optional resolver
 * contract for custom attestation logic.
 *
 * Ported from the Solana SchemaStudio, preserving its layout, sections, and
 * flows, but backed by the viem-based data layer (lib/psr, lib/schema) instead
 * of @solana/web3.js.
 */

import { useState, useId, useEffect, useCallback } from "react";
import type { EIP1193Provider, Address, Hex } from "viem";
import { useWallet } from "../hooks/useWallet";
import { useToast } from "../context/ToastContext";
import {
  fieldDefsToString,
  ZERO_ADDRESS,
  type FieldDef,
  type FieldType,
} from "../lib/schema";
import {
  getV2Config,
  registerSchema,
  fetchAllSchemas,
  fetchSchema,
  getCurrentBlock,
} from "../lib/psr";
import {
  useSchemaStore,
  selectMySchemas,
} from "../store/schemaStore";

// =============================================================================
// Constants
// =============================================================================

const FIELD_TYPES: FieldType[] = ["bool", "u8", "u16", "u32", "u64", "string", "pubkey"];

type ResolverType = "none" | "custom";

const RESOLVER_OPTIONS: { value: ResolverType; label: string; description: string }[] = [
  { value: "none", label: "No resolver", description: "Anyone with authority can attest" },
  { value: "custom", label: "Custom resolver", description: "Provide your own resolver contract address" },
];

function isEthAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

// =============================================================================
// Component
// =============================================================================

export type SchemaStudioProps = {
  onNavigate?: (tab: string) => void;
};

export function SchemaStudio({ onNavigate }: SchemaStudioProps = {}) {
  const { address: walletAddress, chainId, isConnected } = useWallet();
  const { showToast } = useToast();

  const addSchema = useSchemaStore((s) => s.addSchema);
  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const setIsFetchingSchemas = useSchemaStore((s) => s.setIsFetchingSchemas);
  const isFetchingSchemas = useSchemaStore((s) => s.isFetchingSchemas);
  const mySchemas = useSchemaStore((s) =>
    walletAddress ? selectMySchemas(s, walletAddress) : []
  );

  const [name, setName] = useState("");
  const [fields, setFields] = useState<FieldDef[]>([
    { id: crypto.randomUUID(), name: "", type: "bool" },
  ]);
  const [revocable, setRevocable] = useState(true);
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryBlock, setExpiryBlock] = useState("");
  const [resolverType, setResolverType] = useState<ResolverType>("none");
  const [customResolver, setCustomResolver] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uid = useId();

  const fieldDefsString = fieldDefsToString(fields);
  const nameValid = name.trim().length > 0 && name.length <= 64;
  const fieldDefsValid = fieldDefsString.length <= 256;
  const v2Configured = getV2Config(chainId) != null;
  const canSubmit =
    isConnected &&
    walletAddress != null &&
    chainId != null &&
    v2Configured &&
    nameValid &&
    fieldDefsValid &&
    !isSubmitting;

  // Load all known schemas into the store on mount / chain change so the
  // "My Schemas" listing (selectMySchemas with the connected address) is populated.
  useEffect(() => {
    if (chainId == null || !getV2Config(chainId)) return;
    let cancelled = false;
    setIsFetchingSchemas(true);
    fetchAllSchemas(chainId)
      .then((schemas) => {
        if (!cancelled) setSchemas(schemas);
      })
      .catch(() => {
        /* listing is best-effort; ignore fetch failures */
      })
      .finally(() => {
        if (!cancelled) setIsFetchingSchemas(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, setSchemas, setIsFetchingSchemas]);

  const addField = useCallback(() => {
    setFields((prev) => [...prev, { id: crypto.randomUUID(), name: "", type: "bool" }]);
  }, []);

  const updateField = useCallback((id: string, update: Partial<FieldDef>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...update } : f)));
  }, []);

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const resetForm = useCallback(() => {
    setTxHash(null);
    setName("");
    setFields([{ id: crypto.randomUUID(), name: "", type: "bool" }]);
    setRevocable(true);
    setHasExpiry(false);
    setExpiryBlock("");
    setResolverType("none");
    setCustomResolver("");
  }, []);

  const handleSubmit = async () => {
    const provider = (window as { ethereum?: EIP1193Provider }).ethereum;
    if (!walletAddress || chainId == null || !provider || !canSubmit) return;

    setIsSubmitting(true);
    setError(null);
    setTxHash(null);

    try {
      const trimmedName = name.trim();

      // Optional resolver address (defaults to ZERO_ADDRESS).
      let resolver: Address = ZERO_ADDRESS;
      if (resolverType === "custom") {
        if (!isEthAddress(customResolver)) {
          throw new Error("Enter a valid resolver contract address (0x + 40 hex).");
        }
        resolver = customResolver.trim() as Address;
      }

      // Optional expiry expressed as an absolute block number.
      let expiry: bigint = 0n;
      if (hasExpiry) {
        const raw = expiryBlock.trim();
        if (!raw || !/^\d+$/.test(raw)) {
          throw new Error("Enter the block number after which the schema expires.");
        }
        const target = BigInt(raw);
        const current = await getCurrentBlock(chainId);
        if (target <= BigInt(current)) {
          throw new Error(
            `Expiry block must be in the future (current block is ${current}).`
          );
        }
        expiry = target;
      }

      const ctx = { chainId, provider, account: walletAddress };

      const { txHash: hash, schemaId } = await registerSchema(ctx, {
        name: trimmedName,
        fieldDefinitions: fieldDefsString,
        revocable,
        resolver,
        expiryBlock: expiry,
      });

      // Pull the freshly-registered schema and add it to the store.
      const registered = await fetchSchema(chainId, schemaId);
      if (registered) {
        addSchema(registered);
      } else {
        // Fallback to a locally-constructed record if the read lags the write.
        addSchema({
          address: schemaId,
          schemaId,
          authority: walletAddress,
          resolver,
          revocable,
          name: trimmedName,
          fieldDefinitions: fieldDefsString,
          version: 1,
          delegates: [],
          createdAt: Date.now(),
          schemaExpirySlot: Number(expiry),
          deprecated: false,
        });
      }

      setTxHash(hash);
      showToast(`Schema "${trimmedName}" registered.`, {
        explorerTx: { chainId, txHash: hash },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to register schema";
      setError(msg);
      showToast(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Success state ──
  if (txHash) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-glow-muted/30">
          <svg className="h-6 w-6 text-glow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="font-display text-lg font-bold text-white">Schema registered</p>
          <p className="mt-1 text-sm text-mist">
            <strong className="text-white">{name}</strong> is now live on-chain.
          </p>
          <p className="mt-2 inline-block font-mono text-xs text-glow">
            {txHash.slice(0, 20)}…
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={resetForm}
            className="rounded-xl bg-ink-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink-700"
          >
            Register another schema
          </button>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("dashboard")}
              className="rounded-xl border border-ink-600 px-6 py-2.5 text-sm font-medium text-mist transition-colors hover:border-glow/30 hover:text-white"
            >
              Back to dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Schema Studio</h1>
        <p className="mt-1 text-sm text-mist">
          Define the template for a class of attestations and control who can issue them.
        </p>
      </div>

      {/* Schema Name */}
      <section className="space-y-2">
        <label htmlFor={`${uid}-name`} className="block text-sm font-medium text-white">
          Schema Name <span className="text-flare">*</span>
        </label>
        <input
          id={`${uid}-name`}
          type="text"
          maxLength={64}
          placeholder='e.g. "KYC Verified", "High Volume Trader"'
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-sm text-white placeholder-ink-600 focus:border-glow focus:outline-none"
        />
        <p className="text-xs text-mist/60">{name.length}/64 characters</p>
      </section>

      {/* Field Definitions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-white">
            Field Definitions <span className="text-flare">*</span>
          </label>
          <button
            type="button"
            onClick={addField}
            className="text-xs font-medium text-glow transition-colors hover:text-glow/80"
          >
            + Add Field
          </button>
        </div>

        <div className="space-y-2">
          {fields.map((field) => (
            <div key={field.id} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="field name"
                value={field.name}
                onChange={(e) => updateField(field.id, { name: e.target.value })}
                className="flex-1 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm text-white placeholder-ink-600 focus:border-glow focus:outline-none"
              />
              <select
                value={field.type}
                onChange={(e) => updateField(field.id, { type: e.target.value as FieldType })}
                className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm text-white focus:border-glow focus:outline-none"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeField(field.id)}
                disabled={fields.length <= 1}
                className="rounded-lg p-2 text-mist transition-colors hover:text-flare disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Remove field"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {fieldDefsString && (
          <p className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 font-mono text-xs text-mist">
            Preview: <span className="text-glow">{fieldDefsString}</span>
          </p>
        )}
        {!fieldDefsValid && (
          <p className="text-xs text-flare">Field definitions exceed 256 characters.</p>
        )}
      </section>

      {/* Settings */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-white">Settings</h2>
        <div className="divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-900">
          <label className="flex cursor-pointer items-center justify-between px-4 py-3">
            <div>
              <span className="text-sm text-white">Revocable</span>
              <p className="mt-0.5 text-xs text-mist">
                Allow attestations to be revoked by the authority
              </p>
            </div>
            <input
              type="checkbox"
              checked={revocable}
              onChange={(e) => setRevocable(e.target.checked)}
              className="h-4 w-4 accent-glow"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between px-4 py-3">
            <div>
              <span className="text-sm text-white">Schema Expiry</span>
              <p className="mt-0.5 text-xs text-mist">
                Set a block number — no new attestations accepted after it
              </p>
            </div>
            <input
              type="checkbox"
              checked={hasExpiry}
              onChange={(e) => setHasExpiry(e.target.checked)}
              className="h-4 w-4 accent-glow"
            />
          </label>
        </div>
        {hasExpiry && (
          <div className="space-y-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Expiry block number, e.g. 12000000"
              value={expiryBlock}
              onChange={(e) => setExpiryBlock(e.target.value.replace(/[^0-9]/g, ""))}
              className="w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-sm text-white placeholder-ink-600 focus:border-glow focus:outline-none"
            />
            <p className="text-xs text-mist">
              Validated against the current chain block at submit time.
            </p>
          </div>
        )}
      </section>

      {/* Resolver */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-white">Resolver (optional)</h2>
        <div className="space-y-2">
          {RESOLVER_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
                resolverType === opt.value
                  ? "border-glow bg-glow-muted/20"
                  : "border-ink-700 bg-ink-900 hover:border-ink-600"
              }`}
            >
              <input
                type="radio"
                name={`${uid}-resolver`}
                value={opt.value}
                checked={resolverType === opt.value}
                onChange={() => setResolverType(opt.value)}
                className="mt-0.5 accent-glow"
              />
              <div>
                <span className="text-sm font-medium text-white">{opt.label}</span>
                <p className="mt-0.5 text-xs text-mist">{opt.description}</p>
              </div>
            </label>
          ))}
        </div>
        {resolverType === "custom" && (
          <input
            type="text"
            placeholder="Resolver contract address (0x…)"
            value={customResolver}
            onChange={(e) => setCustomResolver(e.target.value)}
            className="w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 font-mono text-sm text-white placeholder-ink-600 focus:border-glow focus:outline-none"
          />
        )}
      </section>

      {!v2Configured && (
        <p className="rounded-xl border border-ink-700 bg-ink-900/40 px-4 py-3 text-xs text-mist">
          The schema registry is not configured for this network. Switch to a supported chain.
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-flare/30 bg-flare/10 px-4 py-3 text-sm text-flare">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-xl bg-glow py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-glow-dim disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950" />
            Registering…
          </span>
        ) : (
          "Register Schema"
        )}
      </button>

      {!isConnected && (
        <p className="text-center text-xs text-mist">Connect your wallet to register a schema.</p>
      )}

      {/* My Schemas */}
      <section className="space-y-3 border-t border-ink-800 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-mist/70">
            My Schemas
          </h2>
          {isFetchingSchemas && <span className="text-xs text-mist/60">Loading…</span>}
        </div>
        {!walletAddress ? (
          <p className="text-xs text-mist">Connect your wallet to see schemas you can issue.</p>
        ) : mySchemas.length === 0 ? (
          <div className="rounded-xl border border-ink-700 bg-ink-900/20 p-6 text-center">
            <p className="font-display text-sm font-bold text-white">No schemas yet</p>
            <p className="mt-1 text-xs text-mist">
              Schemas you author or are delegated to will show up here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {mySchemas.map((s) => (
              <li
                key={s.schemaId}
                className="rounded-xl border border-ink-700 bg-ink-900/25 px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{s.name}</span>
                  {s.deprecated && (
                    <span className="rounded-md border border-ink-700 bg-ink-900/40 px-1.5 py-0.5 text-[10px] uppercase text-mist">
                      deprecated
                    </span>
                  )}
                  {s.revocable && (
                    <span className="rounded-md border border-ink-700 bg-ink-900/40 px-1.5 py-0.5 text-[10px] uppercase text-mist">
                      revocable
                    </span>
                  )}
                  <span className="ml-auto font-mono text-xs text-mist/70">
                    {s.schemaId.slice(0, 10)}…{s.schemaId.slice(-6)}
                  </span>
                </div>
                {s.fieldDefinitions && (
                  <p className="mt-1 font-mono text-xs text-mist">{s.fieldDefinitions}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
