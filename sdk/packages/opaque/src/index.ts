/**
 * `@opaquecash/opaque` — unified Opaque SDK client.
 *
 * Initialize once with chain, RPC, wallet signature, and WASM URL; then prepare txs,
 * filter indexer announcements, aggregate balances, reconstruct one-time spend keys, and discover PSR traits.
 *
 * @packageDocumentation
 */

export {
  OpaqueClient,
  type OpaqueClientConfig,
  type PrepareStealthSendResult,
  type PrepareGhostReceiveResult,
  type AnnounceTransactionRequest,
  type RegisterMetaAddressTransactionRequest,
  type ResolveRecipientMetaResult,
} from "./client.js";

export type { VerifyReputationArgs } from "@opaquecash/psr-chain";
export type {
  ArtifactPaths,
  ProofProgressCallback,
} from "@opaquecash/psr-prover";
export {
  DEFAULT_REPUTATION_ARTIFACT_PATHS,
  DEFAULT_REPUTATION_ARTIFACTS_ORIGIN,
} from "@opaquecash/psr-prover";
export type { ProofData } from "@opaquecash/psr-core";
export { buildActionScope, externalNullifierFromScope } from "@opaquecash/psr-core";

export type {
  IndexerAnnouncement,
  OwnedStealthOutput,
  TokenBalanceSummary,
} from "./types/indexer.js";

export {
  getSupportedChainIds,
  getChainDeployment,
  requireChainDeployment,
  NATIVE_TOKEN_ADDRESS,
  type OpaqueChainDeployment,
} from "./chains.js";

export {
  indexerAnnouncementToScannerRecord,
  indexerAnnouncementsToScannerJson,
} from "./indexer/normalize.js";

export {
  SETUP_MESSAGE,
  deriveKeysFromSignature,
  computeStealthAddressAndViewTag,
  recomputeStealthSendFromEphemeralPrivateKey,
  ephemeralPrivateKeyToCompressedPublicKey,
  stealthMetaAddressToHex,
  keysToStealthMetaAddress,
  parseStealthMetaAddress,
} from "./crypto/dksap.js";

export { EIP5564_SCHEME_SECP256K1 } from "@opaquecash/stealth-core";
