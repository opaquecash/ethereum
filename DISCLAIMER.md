# Disclaimer

**Opaque Cash** is experimental software. Use at your own risk.

## Stealth Address Cryptography

- The **stealth address math** (DKSAP / EIP-5564) implemented in this project is intended to follow the public specification. It has **not** been formally audited. Bugs in key derivation, shared-secret hashing, or point arithmetic could lead to loss of funds or reduced privacy.
- Implementations exist in both **TypeScript** (frontend) and **Rust** (WASM scanner). Consistency between these and with EIP-5564 is maintained by the maintainers but is not guaranteed.
- **Do not rely on this software for high-value or production use** without independent review and testing.

## Local Storage and Data

- **Manual Ghost Addresses** (one-time stealth addresses generated without an on-chain announcement) store ephemeral keys and metadata in **local storage** (e.g. browser `localStorage` via Zustand persist). This data is **device-specific** and is **not** recoverable from the protocol or from another device.
- Clearing browser data, losing the device, or switching browsers will prevent the app from associating those addresses with your keys. **Back up any critical receive addresses or keys** if you rely on Manual Ghost Addresses.
- Stealth keys derived from your wallet signature are kept **in memory** by default; they are not stored on-chain. Refreshing the page or closing the tab may require re-initializing the protocol (sign again). Any optional persistence of keys is at the implementer’s risk.

## Privacy Pool (amount privacy) — NOT a mixer

The **Privacy Pool** (`OpaquePrivacyPool`, `spec/privacy-pool.md`) is a **testnet-only,
unaudited** implementation of the Privacy Pools construction (Buterin, Illum, Nadler,
Schär, Soleimani, 2023). It is deliberately designed to be the **opposite of an
anonymity mixer**:

- **Association-set compliance is mandatory.** A withdrawal is only possible with a
  zero-knowledge proof that the deposit's `label` belongs to an **Association Set
  Provider (ASP)**-curated set of approved ("clean") deposits. A deposit that an ASP
  declines to include **cannot withdraw** through that ASP's root. The protocol lets
  honest users cryptographically **dissociate** from illicit funds — the design goal is
  regulatory compatibility, not evasion.
- **No indiscriminate anonymity.** Unlike a mixer, the pool does not offer anonymity to
  arbitrary funds; membership in the clean set is a precondition for withdrawal.
- **It hides amounts and the deposit↔withdrawal link, not the existence of activity.**
  Deposits, withdrawals, roots, and the ASP root are all public on-chain.

**Do not deposit real value.** The circuits and contracts are **unaudited**, the trusted
setup is a single-contributor testnet ceremony (not a real MPC), and the ASP root is set
by a single testnet authority. Mainnet is gated on the audit & legal prerequisites in
`ethereum/security/privacy-pool-audit-plan.md`. Nothing here is legal advice; operating
or integrating a privacy protocol may carry regulatory obligations in your jurisdiction.

## No hosted mixer frontend

Per protocol policy, there is **no hosted one-click pool UI**. Pool access is via the SDK
and self-hosted integrators only (`spec/privacy-pool.md` §7 policy / plan §6.7).

## No Warranty

This software is provided **as is**, without warranty of any kind. See the [LICENSE](LICENSE) file for the full disclaimer under the MIT License.
