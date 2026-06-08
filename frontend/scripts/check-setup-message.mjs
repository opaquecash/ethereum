#!/usr/bin/env node
/**
 * Regression guard: the stealth-key derivation message must be defined ONCE and
 * never drift. A wallet that signs a different string derives a different key set
 * (and meta-address) — a fund-loss footgun. This check fails if:
 *   - lib/stealth.ts no longer exports the canonical SETUP_MESSAGE, or
 *   - any other source file redeclares `const SETUP_MESSAGE`, or
 *   - any other source file inlines the canonical/legacy message literal instead
 *     of importing SETUP_MESSAGE.
 *
 * Must match spec/CSAP.md §2.2. Dependency-free; run with `node scripts/check-setup-message.mjs`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "src");
const LIB = join(SRC, "lib", "stealth.ts");

const CANONICAL =
  "Sign this message to derive your Opaque Cash stealth keys. This does not approve any transaction.";
const LEGACY_LITERALS = [
  "Sign this message to derive your Opaque Cash stealth keys on Solana. This is not a transaction and does not move funds.",
];

const errors = [];

// 1. lib/stealth.ts exports the canonical message, byte-for-byte.
const lib = readFileSync(LIB, "utf8");
const m = lib.match(/export const SETUP_MESSAGE\s*=\s*"([^"]*)"/);
if (!m) errors.push(`${relative(SRC, LIB)}: no 'export const SETUP_MESSAGE = "..."' found`);
else if (m[1] !== CANONICAL)
  errors.push(`${relative(SRC, LIB)}: SETUP_MESSAGE does not match the canonical CSAP §2.2 string`);

// 2. No other source file may redeclare or inline the message.
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(name) || p === LIB) continue;
    const src = readFileSync(p, "utf8");
    const rel = relative(SRC, p);
    if (/const\s+SETUP_MESSAGE\s*=/.test(src))
      errors.push(`${rel}: redeclares a local SETUP_MESSAGE — import it from lib/stealth instead`);
    if (src.includes(CANONICAL))
      errors.push(`${rel}: inlines the canonical message literal — import SETUP_MESSAGE instead`);
    for (const lit of LEGACY_LITERALS)
      if (src.includes(lit))
        errors.push(`${rel}: inlines a legacy message literal`);
  }
};
walk(SRC);

if (errors.length) {
  console.error("✗ setup-message check failed:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ setup-message check passed: one canonical SETUP_MESSAGE, no drift");
