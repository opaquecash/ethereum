# Opaque — Ethereum contracts

[![CI](https://github.com/opaquecash/ethereum/actions/workflows/eth-contracts.yml/badge.svg)](https://github.com/opaquecash/ethereum/actions/workflows/eth-contracts.yml)

Solidity contracts for the [Opaque protocol](https://opaque.cash) on Ethereum: stealth
payments (EIP-5564/ERC-6538), ZK reputation (PSR V2), cross-chain announcements
(UAB/Wormhole), the relayer market, the privacy pool, and conditional disclosure.

Protocol design lives in [`opaquecash/spec`](https://github.com/opaquecash/spec);
integrate via the [`@opaquecash/*` SDK](https://github.com/opaquecash/sdk); developer
docs at [docs.opaque.cash](https://docs.opaque.cash). ONS naming contracts live in
[`opaquecash/ons`](https://github.com/opaquecash/ons).

> Experimental software, **Sepolia only**. The pool and disclosure layers are unaudited
> and gated on audits before anything beyond testnet — see [DISCLAIMER.md](DISCLAIMER.md)
> and `infra/security/`.

## Contracts (Sepolia)

| Contract | Address | Spec |
|---|---|---|
| `StealthMetaAddressRegistry` (ERC-6538) | `0x77425e04163d608B876c7f50E34A378624A12067` | [CSAP](https://github.com/opaquecash/spec/blob/main/CSAP.md) |
| `StealthAddressAnnouncer` (ERC-5564) | `0x840f72249A8bF6F10b0eB64412E315efBD730865` | [CSAP](https://github.com/opaquecash/spec/blob/main/CSAP.md) |
| `OpaqueSchemaRegistry` | `0xAA5F3942117bD48E7Cd81A500A8b7Bbb122ae80f` | [PSR](https://github.com/opaquecash/spec/blob/main/PSR.md) |
| `OpaqueAttestationRegistry` | `0x049aF9CBB62387034CDd5403794a94E9c000ACCc` | [PSR](https://github.com/opaquecash/spec/blob/main/PSR.md) |
| `OpaqueReputationVerifierV2` / `Groth16VerifierV2` | `0x18cEc2812953c2E9bcADE20CbF6415BD36aEb44f` / `0x49A212bdbc52F1cb6C93623FC7814a61Fc71ddB5` | [PSR](https://github.com/opaquecash/spec/blob/main/PSR.md) |
| `UABSender` / `UABReceiver` | `0x872787c0BD1A0C71e6D1be5a144EB044e0CB2069` / `0x9eF189f7a263F870Cf80f9A89d1349A6AF7b15cF` | [UAB](https://github.com/opaquecash/spec/blob/main/UAB.md) |
| `RelayerRegistry` | `0x5fA252e2D22058a4ec3420573a3B3A5dca025837` | [relayer-market](https://github.com/opaquecash/spec/blob/main/relayer-market.md) |
| `OpaquePrivacyPool` / `WithdrawalVerifier` | `0x49a5bB6d079a43d50596069b4F2632005CFe729E` / `0xa1add9daa1F4D0f9190c13fb9AD52e525f4726b5` | [privacy-pool](https://github.com/opaquecash/spec/blob/main/privacy-pool.md) |
| `OpaqueDisclosureRegistry` / `DisclosureVerifier` | `0x4449DD0A94Fa6cd9C0074F3ee17b8823d6ceDD21` / `0x50Dd94357D1450477e964922615F0d068B0d683E` | [conditional-disclosure](https://github.com/opaquecash/spec/blob/main/conditional-disclosure.md) |

`infra/deployments/sepolia.json` is the source of truth; `npm run generate` exports it
(plus ABIs) to the [`@opaquecash/deployments`](https://github.com/opaquecash/sdk)
package — consumers read addresses from there, never hardcode them.

## Layout

```
infra/contracts/      the contracts above + snarkjs-exported Groth16 verifiers + mocks
infra/test/           hardhat suites (node:test + viem), incl. cross-chain VAA E2E
infra/scripts/        deploy scripts, deployments export, live e2e acceptance scripts
infra/security/       Slither/Aderyn pre-audit triage + the pool/disclosure audit plan
circuits/             git submodule → opaquecash/circuits (proof fixtures used by tests)
```

## Develop

Prerequisites: Node 22+, the `circuits` submodule for ZK fixture tests.

```bash
git submodule update --init
cd infra
npm install
npx hardhat compile
npx hardhat test           # ZK suites skip unless circuits/v2/build exists
```

Deploy scripts (`scripts/deploy-*.ts`) read `SEPOLIA_RPC_URL` / `SEPOLIA_PRIVATE_KEY`
from `.env` and update `deployments/sepolia.json`. Live acceptance flows:
`scripts/e2e-privacy-pool.ts`, `scripts/e2e-disclosure.ts`.

## License

GPL-3.0.
