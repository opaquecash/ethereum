/**
 * V2 Programmable Stealth Reputation — Ethereum client (viem).
 *
 * Reads schemas/attestations from the deployed OpaqueSchemaRegistry /
 * OpaqueAttestationRegistry by enumerating their events (chunked getLogs) and
 * reading per-id state; writes register/attest/revoke/delegate/deprecate and
 * submits V2 reputation proofs to OpaqueReputationVerifierV2.
 *
 * Mirrors the role of the Solana lib/programs.ts, on Ethereum contracts.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbiItem,
  concatHex,
  numberToHex,
  pad,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
} from "viem";
import { getChain, getRpcUrl } from "./chain";
import { getConfigForChain } from "../contracts/contract-config";
import { computeSchemaId, type SchemaV2 } from "./schema";
import { computeUid, type AttestationV2 } from "./attestationV2";

/** The V2 PSR stack was deployed at this Sepolia block; never scan before it. */
export const V2_FROM_BLOCK = 11_019_444n;
/** Initial getLogs window; shrinks automatically when an RPC rejects the range. */
const LOG_CHUNK = 45_000n;

export type V2Config = {
  schemaRegistry: Address;
  attestationRegistry: Address;
  groth16VerifierV2: Address;
  reputationVerifierV2: Address;
};

export function getV2Config(chainId: number | null | undefined): V2Config | null {
  const cfg = getConfigForChain(chainId);
  if (
    !cfg?.schemaRegistry ||
    !cfg.attestationRegistry ||
    !cfg.groth16VerifierV2 ||
    !cfg.reputationVerifierV2
  ) {
    return null;
  }
  return {
    schemaRegistry: cfg.schemaRegistry,
    attestationRegistry: cfg.attestationRegistry,
    groth16VerifierV2: cfg.groth16VerifierV2,
    reputationVerifierV2: cfg.reputationVerifierV2,
  };
}

function publicClientFor(chainId: number): PublicClient {
  const chain = getChain(chainId);
  return createPublicClient({ chain, transport: http(getRpcUrl(chain)) });
}

function walletClientFor(chainId: number, provider: EIP1193Provider) {
  return createWalletClient({ chain: getChain(chainId), transport: custom(provider) });
}

// ---------------------------------------------------------------------------
// ABIs (only the fragments used here)
// ---------------------------------------------------------------------------

const SCHEMA_REGISTRY_ABI = [
  { type: "function", name: "computeSchemaId", stateMutability: "pure", inputs: [{ name: "authority", type: "address" }, { name: "name", type: "string" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "registerSchema", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "fieldDefinitions", type: "string" }, { name: "revocable", type: "bool" }, { name: "resolver", type: "address" }, { name: "schemaExpiryBlock", type: "uint256" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "addDelegate", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "delegate", type: "address" }], outputs: [] },
  { type: "function", name: "removeDelegate", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "delegate", type: "address" }], outputs: [] },
  { type: "function", name: "updateResolver", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "newResolver", type: "address" }], outputs: [] },
  { type: "function", name: "deprecateSchema", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "getSchema", stateMutability: "view", inputs: [{ name: "schemaId", type: "bytes32" }], outputs: [{ name: "authority", type: "address" }, { name: "resolver", type: "address" }, { name: "revocable", type: "bool" }, { name: "deprecated", type: "bool" }, { name: "version", type: "uint8" }, { name: "name", type: "string" }, { name: "fieldDefinitions", type: "string" }, { name: "createdAt", type: "uint256" }, { name: "schemaExpiryBlock", type: "uint256" }] },
  { type: "function", name: "getDelegates", stateMutability: "view", inputs: [{ name: "schemaId", type: "bytes32" }], outputs: [{ type: "address[]" }] },
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ name: "schemaId", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isAuthorizedIssuer", stateMutability: "view", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "candidate", type: "address" }], outputs: [{ type: "bool" }] },
] as const satisfies Abi;

const ATTESTATION_ABI = [
  { type: "function", name: "attest", stateMutability: "nonpayable", inputs: [{ name: "schemaId", type: "bytes32" }, { name: "stealthAddressHash", type: "bytes32" }, { name: "data", type: "bytes" }, { name: "expirationBlock", type: "uint256" }, { name: "refUid", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "revoke", stateMutability: "nonpayable", inputs: [{ name: "uid", type: "bytes32" }], outputs: [] },
  { type: "function", name: "getAttestation", stateMutability: "view", inputs: [{ name: "uid", type: "bytes32" }], outputs: [{ name: "schemaId", type: "bytes32" }, { name: "issuer", type: "address" }, { name: "stealthAddressHash", type: "bytes32" }, { name: "createdAt", type: "uint256" }, { name: "expirationBlock", type: "uint256" }, { name: "revocationBlock", type: "uint256" }, { name: "refUid", type: "bytes32" }, { name: "data", type: "bytes" }] },
  { type: "function", name: "isValid", stateMutability: "view", inputs: [{ name: "uid", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const satisfies Abi;

const REPUTATION_V2_ABI = [
  { type: "function", name: "verifyReputation", stateMutability: "nonpayable", inputs: [{ name: "proof", type: "tuple", components: [{ name: "a", type: "uint256[2]" }, { name: "b", type: "uint256[2][2]" }, { name: "c", type: "uint256[2]" }] }, { name: "root", type: "bytes32" }, { name: "attestationId", type: "uint256" }, { name: "externalNullifier", type: "uint256" }, { name: "nullifierHash", type: "uint256" }], outputs: [{ name: "valid", type: "bool" }] },
  { type: "function", name: "updateMerkleRoot", stateMutability: "nonpayable", inputs: [{ name: "root", type: "bytes32" }], outputs: [] },
  { type: "function", name: "isRootValid", stateMutability: "view", inputs: [{ name: "root", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "usedNullifiers", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
] as const satisfies Abi;

const SCHEMA_REGISTERED_EVENT = parseAbiItem(
  "event SchemaRegistered(bytes32 indexed schemaId, address indexed authority, string name, bool revocable, address resolver)"
);
const ATTESTED_EVENT = parseAbiItem(
  "event Attested(bytes32 indexed uid, bytes32 indexed schemaId, address indexed issuer, bytes32 stealthAddressHash, uint256 expirationBlock, bytes32 refUid)"
);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Detects an RPC "block range too large" error and any suggested toBlock. */
function rangeError(e: unknown): { suggestTo: bigint | null } | null {
  const parts: string[] = [];
  if (e && typeof e === "object") {
    for (const k of ["message", "details", "shortMessage"] as const) {
      const v = (e as Record<string, unknown>)[k];
      if (typeof v === "string") parts.push(v);
    }
    const cause = (e as { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
      const cm = (cause as Record<string, unknown>).message;
      if (typeof cm === "string") parts.push(cm);
    }
  }
  const msg = parts.join(" ") || String(e);
  if (/block range|10 block|range is too large|too large|too many results|limited|-32600|-32005/i.test(msg)) {
    const m = /\[\s*(0x[0-9a-fA-F]+)\s*,\s*(0x[0-9a-fA-F]+)\s*\]/.exec(msg);
    return { suggestTo: m ? BigInt(m[2]) : null };
  }
  return null;
}

/**
 * Collect logs over [from, to], adapting the window to whatever the RPC allows:
 * one call on permissive RPCs; on tiers that cap eth_getLogs it shrinks the
 * window to the provider's suggested range (parsed from the error) or halves it,
 * so the scan still completes instead of failing with a 400.
 */
async function adaptiveCollect<T>(
  from: bigint,
  to: bigint,
  fetch: (f: bigint, t: bigint) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  if (to < from) return out;
  let cursor = from;
  let step = to - from + 1n < LOG_CHUNK ? to - from + 1n : LOG_CHUNK;
  if (step < 1n) step = 1n;
  while (cursor <= to) {
    const end = cursor + step - 1n > to ? to : cursor + step - 1n;
    try {
      out.push(...(await fetch(cursor, end)));
      cursor = end + 1n;
    } catch (e) {
      const r = rangeError(e);
      if (!r) throw e;
      if (r.suggestTo !== null && r.suggestTo >= cursor && r.suggestTo < end) {
        step = r.suggestTo - cursor + 1n;
      } else if (end > cursor) {
        step = (end - cursor + 1n) / 2n;
        if (step < 1n) step = 1n;
      } else {
        throw e;
      }
    }
  }
  return out;
}

export async function fetchAllSchemas(chainId: number): Promise<SchemaV2[]> {
  const cfg = getV2Config(chainId);
  if (!cfg) return [];
  const client = publicClientFor(chainId);
  const latest = await client.getBlockNumber();
  const logs = await adaptiveCollect(V2_FROM_BLOCK, latest, (f, t) =>
    client.getLogs({ address: cfg.schemaRegistry, event: SCHEMA_REGISTERED_EVENT, fromBlock: f, toBlock: t })
  );
  const ids = new Set<Hex>();
  for (const l of logs) if (l.args.schemaId) ids.add(l.args.schemaId);
  const schemas = await Promise.all([...ids].map((id) => fetchSchema(chainId, id, client)));
  return schemas.filter((s): s is SchemaV2 => s != null);
}

export async function fetchSchema(
  chainId: number,
  schemaId: Hex,
  client?: PublicClient
): Promise<SchemaV2 | null> {
  const cfg = getV2Config(chainId);
  if (!cfg) return null;
  const c = client ?? publicClientFor(chainId);
  try {
    const [authority, resolver, revocable, deprecated, version, name, fieldDefinitions, createdAt, expiry] =
      (await c.readContract({ address: cfg.schemaRegistry, abi: SCHEMA_REGISTRY_ABI, functionName: "getSchema", args: [schemaId] })) as readonly [Address, Address, boolean, boolean, number, string, string, bigint, bigint];
    const delegates = (await c.readContract({ address: cfg.schemaRegistry, abi: SCHEMA_REGISTRY_ABI, functionName: "getDelegates", args: [schemaId] })) as readonly Address[];
    return {
      address: schemaId,
      schemaId,
      authority,
      resolver,
      revocable,
      name,
      fieldDefinitions,
      version: Number(version),
      delegates: [...delegates],
      createdAt: Number(createdAt),
      schemaExpirySlot: Number(expiry),
      deprecated,
    };
  } catch {
    return null;
  }
}

export async function fetchAllAttestations(chainId: number): Promise<AttestationV2[]> {
  const cfg = getV2Config(chainId);
  if (!cfg) return [];
  const client = publicClientFor(chainId);
  const latest = await client.getBlockNumber();
  const logs = await adaptiveCollect(V2_FROM_BLOCK, latest, (f, t) =>
    client.getLogs({ address: cfg.attestationRegistry, event: ATTESTED_EVENT, fromBlock: f, toBlock: t })
  );
  const uids = new Set<Hex>();
  for (const l of logs) if (l.args.uid) uids.add(l.args.uid);
  const records = await Promise.all([...uids].map((uid) => fetchAttestation(chainId, uid, client)));
  return records.filter((a): a is AttestationV2 => a != null);
}

export async function fetchAttestation(
  chainId: number,
  uid: Hex,
  client?: PublicClient
): Promise<AttestationV2 | null> {
  const cfg = getV2Config(chainId);
  if (!cfg) return null;
  const c = client ?? publicClientFor(chainId);
  try {
    const [schemaId, issuer, stealthAddressHash, createdAt, expiration, revocation, refUid, data] =
      (await c.readContract({ address: cfg.attestationRegistry, abi: ATTESTATION_ABI, functionName: "getAttestation", args: [uid] })) as readonly [Hex, Address, Hex, bigint, bigint, bigint, Hex, Hex];
    const isValid = (await c.readContract({ address: cfg.attestationRegistry, abi: ATTESTATION_ABI, functionName: "isValid", args: [uid] })) as boolean;
    return {
      address: uid,
      uid,
      schemaPda: schemaId,
      schemaId,
      issuer,
      stealthAddressHash,
      dataHex: data,
      createdAt: Number(createdAt),
      expirationSlot: Number(expiration),
      revocationSlot: Number(revocation),
      refUid,
      isValid,
    };
  } catch {
    return null;
  }
}

export async function getCurrentBlock(chainId: number): Promise<number> {
  return Number(await publicClientFor(chainId).getBlockNumber());
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type WriteCtx = { chainId: number; provider: EIP1193Provider; account: Address };

export async function registerSchema(
  ctx: WriteCtx,
  args: { name: string; fieldDefinitions: string; revocable: boolean; resolver?: Address; expiryBlock?: bigint }
): Promise<{ txHash: Hex; schemaId: Hex }> {
  const cfg = requireCfg(ctx.chainId);
  const wallet = walletClientFor(ctx.chainId, ctx.provider);
  const txHash = await wallet.writeContract({
    address: cfg.schemaRegistry,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "registerSchema",
    args: [args.name, args.fieldDefinitions, args.revocable, args.resolver ?? ("0x0000000000000000000000000000000000000000" as Address), args.expiryBlock ?? 0n],
    account: ctx.account,
    chain: getChain(ctx.chainId),
  });
  return { txHash, schemaId: computeSchemaId(ctx.account, args.name) };
}

export async function addDelegate(ctx: WriteCtx, schemaId: Hex, delegate: Address): Promise<Hex> {
  return writeSchema(ctx, "addDelegate", [schemaId, delegate]);
}
export async function removeDelegate(ctx: WriteCtx, schemaId: Hex, delegate: Address): Promise<Hex> {
  return writeSchema(ctx, "removeDelegate", [schemaId, delegate]);
}
export async function updateResolver(ctx: WriteCtx, schemaId: Hex, resolver: Address): Promise<Hex> {
  return writeSchema(ctx, "updateResolver", [schemaId, resolver]);
}
export async function deprecateSchema(ctx: WriteCtx, schemaId: Hex): Promise<Hex> {
  return writeSchema(ctx, "deprecateSchema", [schemaId]);
}

async function writeSchema(ctx: WriteCtx, fn: "addDelegate" | "removeDelegate" | "updateResolver" | "deprecateSchema", args: readonly unknown[]): Promise<Hex> {
  const cfg = requireCfg(ctx.chainId);
  const wallet = walletClientFor(ctx.chainId, ctx.provider);
  return wallet.writeContract({ address: cfg.schemaRegistry, abi: SCHEMA_REGISTRY_ABI, functionName: fn, args: args as never, account: ctx.account, chain: getChain(ctx.chainId) });
}

export async function attest(
  ctx: WriteCtx,
  args: { schemaId: Hex; stealthAddressHash: Hex; dataHex: Hex; expirationBlock?: bigint; refUid?: Hex }
): Promise<{ txHash: Hex; uid: Hex }> {
  const cfg = requireCfg(ctx.chainId);
  const wallet = walletClientFor(ctx.chainId, ctx.provider);
  const refUid = args.refUid ?? (("0x" + "00".repeat(32)) as Hex);
  const txHash = await wallet.writeContract({
    address: cfg.attestationRegistry,
    abi: ATTESTATION_ABI,
    functionName: "attest",
    args: [args.schemaId, args.stealthAddressHash, args.dataHex, args.expirationBlock ?? 0n, refUid],
    account: ctx.account,
    chain: getChain(ctx.chainId),
  });
  const receipt = await publicClientFor(ctx.chainId).waitForTransactionReceipt({ hash: txHash });
  return { txHash, uid: computeUid(args.schemaId, ctx.account, args.stealthAddressHash, receipt.blockNumber) };
}

export async function revoke(ctx: WriteCtx, uid: Hex): Promise<Hex> {
  const cfg = requireCfg(ctx.chainId);
  const wallet = walletClientFor(ctx.chainId, ctx.provider);
  return wallet.writeContract({ address: cfg.attestationRegistry, abi: ATTESTATION_ABI, functionName: "revoke", args: [uid], account: ctx.account, chain: getChain(ctx.chainId) });
}

export type Groth16ProofCalldata = {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
};

export async function submitReputationProofV2(
  ctx: WriteCtx,
  args: { proof: Groth16ProofCalldata; root: Hex; attestationId: bigint; externalNullifier: bigint; nullifierHash: bigint }
): Promise<Hex> {
  const cfg = requireCfg(ctx.chainId);
  const wallet = walletClientFor(ctx.chainId, ctx.provider);
  return wallet.writeContract({
    address: cfg.reputationVerifierV2,
    abi: REPUTATION_V2_ABI,
    functionName: "verifyReputation",
    args: [args.proof, args.root, args.attestationId, args.externalNullifier, args.nullifierHash],
    account: ctx.account,
    chain: getChain(ctx.chainId),
  });
}

export async function isAuthorizedIssuer(chainId: number, schemaId: Hex, candidate: Address): Promise<boolean> {
  const cfg = getV2Config(chainId);
  if (!cfg) return false;
  return (await publicClientFor(chainId).readContract({ address: cfg.schemaRegistry, abi: SCHEMA_REGISTRY_ABI, functionName: "isAuthorizedIssuer", args: [schemaId, candidate] })) as boolean;
}

// ---------------------------------------------------------------------------
// V2 announcement (so a recipient's scanner can discover an attestation)
// ---------------------------------------------------------------------------

const ANNOUNCER_ABI = [
  {
    type: "function",
    name: "announce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

/**
 * Encode the V2 attestation announcement metadata that the scanner decodes:
 *   view_tag(1) || 0xB2 || schema_id(32) || issuer(32) || uid(32) || nonce(32)
 * The issuer (a 20-byte address) is left-padded to 32 bytes so it matches the
 * left-padded schema authority/delegate bytes the scanner compares against.
 */
export function encodeV2AttestationMetadata(args: {
  viewTag: number;
  schemaId: Hex;
  issuer: Address;
  uid: Hex;
  nonce: Hex;
}): Hex {
  return concatHex([
    numberToHex(args.viewTag & 0xff, { size: 1 }),
    "0xb2",
    args.schemaId,
    pad(args.issuer, { size: 32 }),
    args.uid,
    args.nonce,
  ]);
}

/** A fresh 32-byte nonce as 0x-hex. */
export function randomNonce(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return ("0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
}

/**
 * Publish a V2 attestation announcement via the StealthAddressAnnouncer so the
 * recipient's scanner (scan_attestations_v2_wasm) can match it with their viewing
 * key and surface it on the My Traits page.
 */
export async function announceV2Attestation(
  ctx: WriteCtx,
  args: { stealthAddress: Address; ephemeralPubKey: Hex; metadata: Hex }
): Promise<Hex> {
  const cfg = getConfigForChain(ctx.chainId);
  if (!cfg?.announcer) throw new Error("No announcer configured for this chain.");
  const wallet = walletClientFor(ctx.chainId, ctx.provider);
  return wallet.writeContract({
    address: cfg.announcer,
    abi: ANNOUNCER_ABI,
    functionName: "announce",
    args: [1n, args.stealthAddress, args.ephemeralPubKey, args.metadata],
    account: ctx.account,
    chain: getChain(ctx.chainId),
  });
}

function requireCfg(chainId: number): V2Config {
  const cfg = getV2Config(chainId);
  if (!cfg) throw new Error("V2 PSR contracts are not configured for this chain.");
  return cfg;
}
