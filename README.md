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
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-5c7cfa?style=flat-square" alt="MIT License" /></a>
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
cd sdk && npm install && npm run build
```

Point your app at the published WASM entry (or your own build):

`https://www.opaque.cash/pkg/cryptography.js`

Full API surface, types, and lower-level packages (`@opaquecash/stealth-*`, `@opaquecash/psr-*`) live in **[sdk/packages/opaque/README.md](sdk/packages/opaque/README.md)**.

---

## Developer docs

The **`docs/`** app is a Vite + React site: quick start, configuration, indexer integration, send/receive guides, PSR flows, API reference, and a **playground**.

```bash
cd docs && npm install && npm run dev
```

Use it alongside the SDK README when you’re wiring **Graph-style announcement rows**, **reputation proofs**, or custom deployments.

---

## Repository map

| Path | What you’ll find |
|------|------------------|
| [`frontend/`](frontend/) | Reference wallet UI (balances, send, receive, private balance) |
| [`sdk/`](sdk/) | **`@opaquecash/opaque`** and modular stealth + PSR packages |
| [`docs/`](docs/) | Developer documentation site |
| [`infra/`](infra/) | Hardhat contracts, deploy scripts |
| Rust WASM scanner core | Canonical crate [`opaque-scanner`](https://crates.io/crates/opaque-scanner) ([opaquecash/scanner](https://github.com/opaquecash/scanner)); was the in-repo `scanner/` |

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

---

## Community

Issues and PRs are welcome—whether you’re fixing a doc typo, improving the SDK ergonomics, or integrating Opaque into something new.

**Support:** [hello@collinsadi.xyz](mailto:hello@collinsadi.xyz)

---

<p align="center">
  <sub>MIT License · Built in public · <a href="https://opaque.cash">opaque.cash</a></sub>
</p>