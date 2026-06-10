<p align="center">
<pre align="center">
 ╔═══════════════════════════════════════╗
 ║              O P A Q U E              ║
 ╚═══════════════════════════════════════╝
</pre>
  <br />
  <b>Private payments &amp; proof-backed reputation on Ethereum</b>
  <br /><br />
  <a href="https://opaque.cash">Website</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/opaquecash/opaque">GitHub</a>
  &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/@opaquecash/opaque">SDK</a>
  &nbsp;·&nbsp;
  <a href="https://docs.opaque.cash">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://docs.opaque.cash/playground">Playground</a>
  &nbsp;·&nbsp;
  <a href="https://demo.opaque.cash">PSR Verifier Demo</a>
  &nbsp;·&nbsp;
  <a href="https://youtu.be/NAo7j0-Yqa8">Demo</a>
  <br /><br />
  <a href="https://www.gnu.org/licenses/gpl-3.0"><img src="https://img.shields.io/badge/license-GPLv3-5c7cfa?style=flat-square" alt="GPLv3 License" /></a>
</p>

---

**Opaque** is an open protocol for **unlinkable receive addresses** and optional **reputation you can prove without doxxing your wallet**. Think of it as: every payment can land at a fresh address only you control, while still letting apps verify things like “this person passed KYC” or “this account is in good standing”—using zero-knowledge proofs when you opt into that layer.

No single product owns the stack: there is a **reference wallet** at [opaque.cash](https://opaque.cash), a [**TypeScript SDK**](https://www.npmjs.com/package/@opaquecash/opaque) for builders, [**developer docs**](https://docs.opaque.cash) (guides + API reference + playground), and **on-chain contracts** you can read and deploy yourself.

> **Heads-up:** This is experimental software. Stealth cryptography and local-only data paths have real trade-offs—read [DISCLAIMER.md](DISCLAIMER.md) before relying on it for anything serious.

---

## What the protocol does today

| | |
|:---|:---|
| **Stealth payments (EIP-5564)** | Recipients share a **meta-address** (not a single static deposit address). Senders derive a **one-time address** per transfer so observers cannot trivially link your incoming flow on-chain. |
| **Registry** | Optionally map your normal Ethereum address to your meta-address so people can pay you **by `0x…`** without pasting a long key—resolution is public; the unlinkability is in how funds are received. |
| **Announcer** | Senders emit a compact **announcement** on-chain so the right recipient can **discover** which stealth outputs are theirs (with **view tags** so scanning stays practical). |
| **Manual “ghost” receives** | The app can also generate one-time addresses **without** an on-chain announcement; those rely on **local storage** on the device—flexible, but not recoverable from chain state alone. |
| **PSR — private reputation** | When you need it, **attestation metadata** can ride alongside announcements. The recipient can **discover traits** from their announcements, then build **Groth16 proofs** scoped to an action and verify against **on-chain roots**—showing *that* you qualify without exposing *who* you are to everyone. |

Under the hood, heavy lifting uses **Rust → WebAssembly** for scanning and crypto, **viem**-friendly ABIs for contracts, and hosted circuit artifacts on [opaque.cash](https://opaque.cash) for proof generation when you don’t self-host.

---

## Build with the SDK

The **`@opaquecash/opaque`** package is the unified client: configure **chain + RPC + wallet signature + WASM**, pass **indexer-shaped announcements**, and get **calldata** for register/announce flows, **owned outputs**, **balances by token**, and **PSR traits**—without forcing a specific indexer or UI.

```bash
npm install @opaquecash/opaque
```

Point your app at the published WASM entry (or your own build):

`https://www.opaque.cash/pkg/cryptography.js`

Full API surface, types, and lower-level packages (`@opaquecash/stealth-*`, `@opaquecash/psr-*`) live in the canonical SDK repo: [opaquecash/sdk](https://github.com/opaquecash/sdk).

---

## Developer docs

The documentation site now lives in its own repository,
[opaquecash/docs](https://github.com/opaquecash/docs) (published at
[docs.opaque.cash](https://docs.opaque.cash)): quick start, configuration, indexer integration,
send/receive guides, PSR flows, cross-chain scan, API reference, and a **playground**.

```bash
git clone https://github.com/opaquecash/docs && cd docs && npm install && npm run dev
```

Use it alongside the SDK README when you’re wiring **Graph-style announcement rows**, **reputation proofs**, or custom deployments.

---

## Repository map

| Path | What you’ll find |
|------|------------------|
| Reference wallet UI | Cross-chain app [opaquecash/app](https://github.com/opaquecash/app) (was the in-repo `frontend/`) |
| TypeScript SDK | Canonical packages [`@opaquecash/opaque`](https://www.npmjs.com/package/@opaquecash/opaque) and modular `@opaquecash/{stealth,psr}-*` ([opaquecash/sdk](https://github.com/opaquecash/sdk)); was the in-repo `sdk/` |
| Developer docs | Standalone docs site [opaquecash/docs](https://github.com/opaquecash/docs) ([docs.opaque.cash](https://docs.opaque.cash)); was the in-repo `docs/` |
| [`infra/`](infra/) | Hardhat contracts, deploy scripts |
| Rust WASM scanner core | Canonical crate [`opaque-scanner`](https://crates.io/crates/opaque-scanner) ([opaquecash/scanner](https://github.com/opaquecash/scanner)); was the in-repo `scanner/` |

---

## Programmable Stealth Reputation (PSR)

PSR is Opaque's privacy-preserving reputation layer: a stealth identity can hold **schema-bound attestations** and later prove it holds one—to a contract or an app—without revealing the stealth address, the wallet behind it, or any unrelated attestation. Ethereum runs the canonical **V2** design; V1 is discontinued.

**Three on-chain pieces** (all on Sepolia, addresses below):

- **`OpaqueSchemaRegistry`** — an issuer registers a *schema*: a named attestation type with an ABI-style field layout (e.g. `bool passed, u64 score`), a revocability flag, an optional expiry block, an optional resolver hook, and up to 10 delegate issuers. The schema creator is its permanent **authority**; only the authority or a delegate may issue under it. `schema_id = sha256(authority ‖ name ‖ version)`.
- **`OpaqueAttestationRegistry`** — an authorized issuer `attest`s a schema-bound attestation to a recipient's **stealth-address hash** (never the address itself), with ABI-encoded data (≤ 512 bytes), an optional expiry, and an optional reference to a prior attestation. The authority can `revoke` when the schema is revocable; the data is preserved for audit. `uid = sha256(schema_id ‖ issuer ‖ stealthAddressHash ‖ blockNumber)`.
- **`OpaqueReputationVerifierV2`** + **`Groth16VerifierV2`** — verify a Groth16 proof from the V2 `stealth_reputation` circuit (BN254, Poseidon, depth-20 Merkle tree) through the `ecPairing` precompile. The verifier tracks valid Merkle roots (admin-submitted, 1-hour expiry) and spent nullifiers, so each proof is consumable once per action.

**End-to-end flow**

1. **Register** — an issuer creates a schema in `OpaqueSchemaRegistry` (Schema Studio in the dashboard).
2. **Issue** — the issuer attests to a recipient's stealth identity and emits an announcement carrying the V2 attestation metadata (Attestation Manager).
3. **Discover** — the recipient scans announcements with their viewing key (the Rust → WASM scanner) and sees matching traits on the **My Traits** tab, entirely client-side.
4. **Prove** — for a chosen action (`external_nullifier`), the recipient builds a Groth16 proof that they own a stealth address carrying a valid attestation under schema X, revealing only the schema, the action scope, and a one-time `nullifier_hash`. Public signals: `[merkle_root, attestation_id, external_nullifier, nullifier_hash]`.
5. **Verify** — a contract or service calls `verifyReputation(...)`; the proof is checked against a known Merkle root and the nullifier is consumed, so replaying the same action fails.

**Public vs private.** Public: the schema being proven, the action scope, the nullifier hash, and—by storage—a schema's name/field-definitions and each attestation's `data` and `issuer`. Private: the stealth private key, the stealth address, the wallet behind it, the transaction graph, and any unrelated attestation. Privacy comes from stealth-address unlinkability plus the ZK proof, **not** from hiding attestation contents—encrypt or hash sensitive `data`.

The full cross-chain specification is in [`spec/PSR.md`](https://github.com/opaquecash/spec/blob/main/PSR.md).

---

## Contracts (Sepolia)

**Stealth payments (DKSAP)**

| | |
|:---|:---|
| **StealthMetaAddressRegistry** | [0x77425e04163d608B876c7f50E34A378624A12067](https://sepolia.etherscan.io/address/0x77425e04163d608B876c7f50E34A378624A12067) |
| **StealthAddressAnnouncer** | [0x840f72249A8bF6F10b0eB64412E315efBD730865](https://sepolia.etherscan.io/address/0x840f72249A8bF6F10b0eB64412E315efBD730865) |

**Programmable Stealth Reputation (V2)**

| | |
|:---|:---|
| **OpaqueSchemaRegistry** | [0xAA5F3942117bD48E7Cd81A500A8b7Bbb122ae80f](https://sepolia.etherscan.io/address/0xAA5F3942117bD48E7Cd81A500A8b7Bbb122ae80f) |
| **OpaqueAttestationRegistry** | [0x049aF9CBB62387034CDd5403794a94E9c000ACCc](https://sepolia.etherscan.io/address/0x049aF9CBB62387034CDd5403794a94E9c000ACCc) |
| **OpaqueReputationVerifierV2** | [0x18cEc2812953c2E9bcADE20CbF6415BD36aEb44f](https://sepolia.etherscan.io/address/0x18cEc2812953c2E9bcADE20CbF6415BD36aEb44f) |
| **Groth16VerifierV2** | [0x49A212bdbc52F1cb6C93623FC7814a61Fc71ddB5](https://sepolia.etherscan.io/address/0x49A212bdbc52F1cb6C93623FC7814a61Fc71ddB5) |

> PSR V1 is discontinued. New systems use the V2 schema/attestation contracts above.

**Universal Announcement Bus (Wormhole)**

Cross-chain announcement relay between Sepolia and Solana devnet via the Wormhole Core Contract (`0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78`). See [`spec/UAB.md`](https://github.com/opaquecash/spec/blob/main/UAB.md).

| | |
|:---|:---|
| **UABSender** | [0x872787c0BD1A0C71e6D1be5a144EB044e0CB2069](https://sepolia.etherscan.io/address/0x872787c0BD1A0C71e6D1be5a144EB044e0CB2069) |
| **UABReceiver** | [0x9eF189f7a263F870Cf80f9A89d1349A6AF7b15cF](https://sepolia.etherscan.io/address/0x9eF189f7a263F870Cf80f9A89d1349A6AF7b15cF) |

---

## Community

Issues and PRs are welcome—whether you’re fixing a doc typo, improving the SDK ergonomics, or integrating Opaque into something new.

**Support:** [hello@collinsadi.xyz](mailto:hello@collinsadi.xyz)

---

<p align="center">
  <sub>GPLv3 License · Built in public · <a href="https://opaque.cash">opaque.cash</a></sub>
</p>