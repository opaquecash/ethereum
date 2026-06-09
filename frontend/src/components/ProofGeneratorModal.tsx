/**
 * ProofGeneratorModal — generate + submit a V2 reputation proof (Ethereum)
 *
 * Builds the V2 stealth_reputation circuit witness from a discovered trait's
 * leaf preimage, generates a Groth16 proof with snarkjs (shared circuit wasm +
 * zkey), formats it for the Solidity verifier, and submits it to
 * OpaqueReputationVerifierV2. Ported from the Solana ProofGeneratorModal.
 *
 * Note: submission only succeeds once a matching Merkle root has been published
 * on-chain (OpaqueReputationVerifierV2.updateMerkleRoot by the admin/relayer);
 * otherwise the contract reverts with InvalidMerkleRoot, which is surfaced here.
 */

import { useState } from "react";
import { toHex, type EIP1193Provider } from "viem";
import { useWallet } from "../hooks/useWallet";
import { useToast } from "../context/ToastContext";
import { submitReputationProofV2, type Groth16ProofCalldata } from "../lib/psr";
import type { V2DiscoveredTrait } from "../store/schemaStore";
// @ts-expect-error snarkjs has no bundled types
import * as snarkjs from "snarkjs";

const CIRCUIT_WASM_PATH = "/circuits/v2/stealth_reputation.wasm";
const ZKEY_PATH = "/circuits/v2/stealth_reputation_final.zkey";
const TREE_DEPTH = 20;

export type ProofGeneratorModalProps = {
  trait: V2DiscoveredTrait;
  onClose: () => void;
};

type Stage = "idle" | "generating" | "submitting" | "done" | "error";

function toBig(s: string): bigint {
  return BigInt(s.startsWith("0x") ? s : s.match(/^\d+$/) ? s : "0x" + s);
}

export function ProofGeneratorModal({ trait, onClose }: ProofGeneratorModalProps) {
  const { address: walletAddress, chainId } = useWallet();
  const { showToast } = useToast();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [externalNullifier, setExternalNullifier] = useState("1");

  const preimage = trait.merkleLeafPreimage;
  const hasPreimage =
    preimage &&
    preimage.stealthPkField &&
    preimage.schemaIdField &&
    !trait.chainDiscoveryOnly;

  const run = async () => {
    const provider = (window as { ethereum?: EIP1193Provider }).ethereum;
    if (!walletAddress || chainId == null || !provider) {
      setError("Connect a wallet first.");
      return;
    }
    if (!hasPreimage) {
      setError("Merkle leaf preimage unavailable for this trait — cannot build a proof yet.");
      return;
    }
    setError(null);
    setStage("generating");
    try {
      // Poseidon for leaf, nullifier, and the single-leaf Merkle path.
      if (typeof globalThis !== "undefined" && !("Buffer" in globalThis)) {
        const bufferPkg = await import("buffer/index.js");
        (globalThis as { Buffer?: typeof bufferPkg.Buffer }).Buffer = bufferPkg.Buffer;
      }
      const circomlib = await import("circomlibjs");
      const poseidon = await circomlib.buildPoseidon();
      const F = poseidon.F;
      const ph = (xs: bigint[]): bigint => F.toObject(poseidon(xs));

      const stealthPk = toBig(preimage.stealthPkField);
      const schemaId = toBig(preimage.schemaIdField);
      const issuerPkX = toBig(preimage.issuerPkX || "0");
      const traitDataHash = toBig(preimage.traitDataHash || "0");
      const nonce = toBig(preimage.nonceField || "0");
      const extNull = BigInt(externalNullifier.trim() || "1");

      const leaf = ph([stealthPk, schemaId, issuerPkX, traitDataHash, nonce]);

      // Single-leaf tree: zero-hash siblings up the tree, all index 0.
      const zero: bigint[] = [ph([0n, 0n])];
      for (let i = 1; i < TREE_DEPTH; i++) zero.push(ph([zero[i - 1], zero[i - 1]]));
      const merklePath: bigint[] = [];
      const merklePathIndices: number[] = [];
      let current = leaf;
      for (let i = 0; i < TREE_DEPTH; i++) {
        merklePath.push(zero[i]);
        merklePathIndices.push(0);
        current = ph([current, zero[i]]);
      }
      const merkleRoot = current;
      const nullifierHash = ph([stealthPk, extNull]);

      const input = {
        stealth_pk: stealthPk.toString(),
        schema_id: schemaId.toString(),
        issuer_pk_x: issuerPkX.toString(),
        trait_data_hash: traitDataHash.toString(),
        nonce: nonce.toString(),
        merkle_path: merklePath.map((h) => h.toString()),
        merkle_path_indices: merklePathIndices,
        merkle_root: merkleRoot.toString(),
        attestation_id: schemaId.toString(),
        external_nullifier: extNull.toString(),
        nullifier_hash: nullifierHash.toString(),
      };

      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        CIRCUIT_WASM_PATH,
        ZKEY_PATH
      );

      // snarkjs -> Solidity calldata (pi_b pairs are swapped).
      const calldata: Groth16ProofCalldata = {
        a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
        b: [
          [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
          [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
        ],
        c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
      };

      setStage("submitting");
      const txHash = await submitReputationProofV2(
        { chainId, provider, account: walletAddress },
        {
          proof: calldata,
          root: toHex(BigInt(publicSignals[0]), { size: 32 }),
          attestationId: BigInt(publicSignals[1]),
          externalNullifier: BigInt(publicSignals[2]),
          nullifierHash: BigInt(publicSignals[3]),
        }
      );
      showToast("Reputation proof verified on-chain", { explorerTx: { chainId, txHash } });
      setStage("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Proof failed.";
      setError(
        /InvalidMerkleRoot/i.test(msg)
          ? "Proof generated, but no matching Merkle root is published on-chain yet (the V2 root must be submitted by the admin/relayer)."
          : msg
      );
      setStage("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Prove trait</h2>
          <button onClick={onClose} className="text-mist/60 hover:text-white">×</button>
        </div>

        <p className="mb-3 text-sm text-mist">
          Generate a zero-knowledge proof that you hold the{" "}
          <span className="text-white">{trait.schemaName || "schema"}</span> attestation, without
          revealing your stealth address.
        </p>

        <label className="mb-1 block text-xs text-mist/80">Action scope (external nullifier)</label>
        <input
          value={externalNullifier}
          onChange={(e) => setExternalNullifier(e.target.value)}
          disabled={stage === "generating" || stage === "submitting"}
          className="mb-4 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white"
        />

        {stage === "generating" && <p className="mb-3 text-sm text-glow">Generating proof…</p>}
        {stage === "submitting" && <p className="mb-3 text-sm text-glow">Submitting on-chain…</p>}
        {stage === "done" && <p className="mb-3 text-sm text-emerald-300">Proof verified on-chain.</p>}
        {error && <p className="mb-3 break-words text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-ink-700 px-4 py-2 text-sm text-mist hover:text-white"
          >
            {stage === "done" ? "Close" : "Cancel"}
          </button>
          {stage !== "done" && (
            <button
              onClick={run}
              disabled={stage === "generating" || stage === "submitting" || !hasPreimage}
              className="flex-1 rounded-xl bg-glow px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-40"
            >
              {stage === "generating" || stage === "submitting" ? "Working…" : "Generate & submit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
