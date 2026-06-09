/**
 * Attestation Manager — issue V2 attestations (Ethereum)
 *
 * Lets a schema authority or delegate issue a schema-bound attestation to a
 * recipient stealth address via the OpaqueAttestationRegistry contract.
 * Ported from the Solana AttestationManager, backed by the viem data layer.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type { EIP1193Provider, Hex, Address } from "viem";
import { useWallet } from "../hooks/useWallet";
import { useToast } from "../context/ToastContext";
import { parseFieldDefs, type SchemaV2 } from "../lib/schema";
import { encodeAttestationData, bytesToHex, hexToBytes } from "../lib/attestationV2";
import { computeStealthAddressAndViewTag } from "../lib/stealth";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  getV2Config,
  fetchAllSchemas,
  attest,
  getCurrentBlock,
  encodeV2AttestationMetadata,
  announceV2Attestation,
  randomNonce,
} from "../lib/psr";
import { useSchemaStore } from "../store/schemaStore";

export type AttestationManagerProps = {
  onNavigate?: (tab: string) => void;
};

function recipientHexLen(s: string): number {
  const v = s.trim();
  return v.startsWith("0x") ? v.length - 2 : v.length;
}

/** A recipient input is plausible if it is a 66-byte meta-address, a 20-byte
 *  stealth address, or an already-32-byte hash. */
function isRecipientPlausible(s: string): boolean {
  const v = s.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(v)) return false;
  const n = recipientHexLen(v);
  return n === 132 || n === 40 || n === 64;
}

/** Resolve the recipient input to the 32-byte stealth-address hash the
 *  attestation is bound to. A meta-address derives a one-time stealth address
 *  (DKSAP) which is then hashed; a stealth address is hashed directly; a
 *  32-byte value is used as-is. Mirrors the Solana AttestationManager. */
function resolveStealthAddressHash(input: string): {
  hash: Hex;
  stealthAddress?: Address;
  ephemeralPubKey?: Hex;
  viewTag?: number;
} {
  const v = input.trim() as Hex;
  const n = recipientHexLen(v);
  if (n === 132) {
    const { stealthAddress, ephemeralPubKey, viewTag } = computeStealthAddressAndViewTag(v);
    return {
      hash: bytesToHex(keccak_256(hexToBytes(stealthAddress))),
      stealthAddress,
      ephemeralPubKey: bytesToHex(ephemeralPubKey),
      viewTag,
    };
  }
  if (n === 40) {
    return { hash: bytesToHex(keccak_256(hexToBytes(v))), stealthAddress: v as Address };
  }
  if (n === 64) {
    return { hash: v };
  }
  throw new Error("Recipient must be a 66-byte meta-address, 20-byte stealth address, or 32-byte hash.");
}

export function AttestationManager({ onNavigate }: AttestationManagerProps = {}) {
  const { address: walletAddress, chainId, isConnected } = useWallet();
  const { showToast } = useToast();

  const setSchemas = useSchemaStore((s) => s.setSchemas);
  const setIsFetchingSchemas = useSchemaStore((s) => s.setIsFetchingSchemas);
  const isFetchingSchemas = useSchemaStore((s) => s.isFetchingSchemas);
  const schemasMap = useSchemaStore((s) => s.schemas);
  const mySchemas = useMemo(() => {
    if (!walletAddress) return [];
    const lower = walletAddress.toLowerCase();
    return Object.values(schemasMap).filter(
      (s) => s.authority.toLowerCase() === lower || s.delegates.some((d) => d.toLowerCase() === lower)
    );
  }, [schemasMap, walletAddress]);

  const [schemaId, setSchemaId] = useState<string>("");
  const [recipientInput, setRecipientInput] = useState<string>("");
  const [resolvedStealth, setResolvedStealth] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryBlock, setExpiryBlock] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUid, setLastUid] = useState<Hex | null>(null);

  const v2Configured = getV2Config(chainId) != null;

  const selectedSchema: SchemaV2 | undefined = useMemo(
    () => mySchemas.find((s) => s.schemaId === schemaId),
    [mySchemas, schemaId]
  );
  const fieldDefs = useMemo(
    () => (selectedSchema ? parseFieldDefs(selectedSchema.fieldDefinitions) : []),
    [selectedSchema]
  );

  useEffect(() => {
    if (chainId == null || !getV2Config(chainId)) return;
    let cancelled = false;
    setIsFetchingSchemas(true);
    fetchAllSchemas(chainId)
      .then((s) => !cancelled && setSchemas(s))
      .catch(() => {})
      .finally(() => !cancelled && setIsFetchingSchemas(false));
    return () => {
      cancelled = true;
    };
  }, [chainId, setSchemas, setIsFetchingSchemas]);

  const canSubmit =
    isConnected &&
    walletAddress != null &&
    chainId != null &&
    v2Configured &&
    selectedSchema != null &&
    !selectedSchema.deprecated &&
    isRecipientPlausible(recipientInput) &&
    !isSubmitting;

  const updateFieldValue = useCallback((name: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = async () => {
    const provider = (window as { ethereum?: EIP1193Provider }).ethereum;
    if (!walletAddress || chainId == null || !provider || !selectedSchema || !canSubmit) return;

    setIsSubmitting(true);
    setError(null);
    setLastUid(null);
    try {
      const resolved = resolveStealthAddressHash(recipientInput);
      const stealthAddressHash = resolved.hash;
      setResolvedStealth(resolved.stealthAddress ?? null);

      let expiration = 0n;
      if (hasExpiry) {
        if (!/^\d+$/.test(expiryBlock.trim())) throw new Error("Enter the expiry block number.");
        const target = BigInt(expiryBlock.trim());
        const current = await getCurrentBlock(chainId);
        if (target <= BigInt(current)) throw new Error("Expiry block must be in the future.");
        expiration = target;
      }

      const dataHex = encodeAttestationData(fieldValues, fieldDefs);
      const ctx = { chainId, provider, account: walletAddress };
      const { txHash, uid } = await attest(ctx, {
        schemaId: selectedSchema.schemaId as Hex,
        stealthAddressHash,
        dataHex,
        expirationBlock: expiration,
      });
      setLastUid(uid);

      // Announce so the recipient's scanner can discover this attestation. Only
      // possible when we derived the stealth address from a meta-address, since
      // that yields the ephemeral key the recipient needs to recompute it.
      if (resolved.ephemeralPubKey && resolved.stealthAddress && resolved.viewTag !== undefined) {
        try {
          const metadata = encodeV2AttestationMetadata({
            viewTag: resolved.viewTag,
            schemaId: selectedSchema.schemaId as Hex,
            issuer: walletAddress,
            uid,
            nonce: randomNonce(),
          });
          await announceV2Attestation(ctx, {
            stealthAddress: resolved.stealthAddress,
            ephemeralPubKey: resolved.ephemeralPubKey,
            metadata,
          });
        } catch (annErr) {
          console.warn("[AttestationManager] announcement failed (non-fatal):", annErr);
        }
      }

      showToast("Attestation issued", { explorerTx: { chainId, txHash } });
      setFieldValues({});
      setRecipientInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to issue attestation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-white">Issue Attestation</h1>
        <p className="mt-1 text-sm text-mist">
          Issue a schema-bound attestation to a recipient stealth address. Only a schema's
          authority or a registered delegate may attest.
        </p>
      </header>

      {!v2Configured && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          The V2 reputation contracts are not configured for this network.
        </div>
      )}

      <div className="space-y-5 rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-mist">Schema</label>
          <select
            value={schemaId}
            onChange={(e) => {
              setSchemaId(e.target.value);
              setFieldValues({});
            }}
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white"
          >
            <option value="">
              {isFetchingSchemas ? "Loading schemas…" : "Select a schema you can issue"}
            </option>
            {mySchemas.map((s) => (
              <option key={s.schemaId} value={s.schemaId} disabled={s.deprecated}>
                {s.name}
                {s.deprecated ? " (deprecated)" : ""}
              </option>
            ))}
          </select>
          {mySchemas.length === 0 && !isFetchingSchemas && (
            <p className="mt-1.5 text-xs text-mist/70">
              You are not the authority or a delegate of any schema yet.{" "}
              {onNavigate && (
                <button className="text-glow hover:underline" onClick={() => onNavigate("schemas")}>
                  Create one in Schema Studio.
                </button>
              )}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-mist">
            Recipient meta-address
          </label>
          <input
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value)}
            placeholder="0x… recipient meta-address (66 bytes), stealth address, or 32-byte hash"
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-xs text-white"
          />
          {resolvedStealth && (
            <p className="mt-1 break-all font-mono text-[11px] text-mist/60">
              Stealth address: {resolvedStealth}
            </p>
          )}
        </div>

        {selectedSchema && fieldDefs.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-mist">Attestation fields</p>
            {fieldDefs.map((f) => (
              <div key={f.id}>
                <label className="mb-1 block text-xs text-mist/80">
                  {f.name} <span className="text-mist/50">({f.type})</span>
                </label>
                {f.type === "bool" ? (
                  <select
                    value={fieldValues[f.name] ?? ""}
                    onChange={(e) => updateFieldValue(f.name, e.target.value)}
                    className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white"
                  >
                    <option value="">—</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    value={fieldValues[f.name] ?? ""}
                    onChange={(e) => updateFieldValue(f.name, e.target.value)}
                    className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="flex items-center gap-2 text-sm text-mist">
            <input type="checkbox" checked={hasExpiry} onChange={(e) => setHasExpiry(e.target.checked)} />
            Set an expiry block
          </label>
          {hasExpiry && (
            <input
              value={expiryBlock}
              onChange={(e) => setExpiryBlock(e.target.value)}
              placeholder="Block number after which the attestation expires"
              className="mt-2 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white"
            />
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {lastUid && (
          <p className="break-all text-xs text-emerald-300">Issued. UID: {lastUid}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full rounded-xl bg-glow px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-40"
        >
          {isSubmitting ? "Issuing…" : "Issue attestation"}
        </button>
      </div>
    </div>
  );
}
