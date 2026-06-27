// harness/lib/locks.mjs
// Integrity verification for the frozen contract + guardrails.
// Trust model (skeleton, documented honestly):
//   1. contract.lock.json / guardrails.lock.json are written ONCE by
//      freeze_locks.mjs, then chmod 0444 (read-only).
//   2. Their sha256 hashes are recorded in locks.manifest.json AND printed to
//      the freeze run record + git history (an immutable second witness).
//   3. The agent's write scope EXCLUDES these paths and harness/lib (guardrails),
//      so the agent cannot rewrite the lock, the manifest, or this verifier.
//   4. Every run, the loop re-hashes the locks and compares to the manifest;
//      ANY mismatch (content or mode) HALTS the run before doing anything else.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

export const CONTRACT_LOCK = join(HARNESS_DIR, 'contract.lock.json');
export const GUARDRAILS_LOCK = join(HARNESS_DIR, 'guardrails.lock.json');
export const MANIFEST = join(HARNESS_DIR, 'locks.manifest.json');

/** sha256 hex of a file's bytes. */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** sha256 hex of a string. */
export function sha256(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Verify both locks against the manifest. Returns a structured result; never
 * throws on mismatch (the caller decides how to halt) but does surface read
 * errors as failures rather than swallowing them.
 * @returns {{ ok: boolean, failures: string[], hashes: Record<string,string> }}
 */
export function verifyLocks() {
  const failures = [];
  const hashes = {};

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      failures: [`Cannot read locks.manifest.json: ${err.message}. Run freeze_locks.mjs first.`],
      hashes,
    };
  }

  for (const [label, path] of [
    ['contract.lock.json', CONTRACT_LOCK],
    ['guardrails.lock.json', GUARDRAILS_LOCK],
  ]) {
    let actual;
    try {
      actual = sha256File(path);
    } catch (err) {
      failures.push(`Cannot read ${label}: ${err.message}`);
      continue;
    }
    hashes[label] = actual;

    const expected = manifest?.hashes?.[label];
    if (!expected) {
      failures.push(`Manifest has no expected hash for ${label}.`);
    } else if (expected !== actual) {
      failures.push(
        `${label} sha256 MISMATCH — expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…. ` +
          `The frozen file was modified. Halting.`,
      );
    }

    // Mode check: warn (not hard-fail) if not read-only, since some filesystems
    // (e.g. checked-out CI runners) reset modes. Content hash is the real gate.
    try {
      const mode = statSync(path).mode & 0o777;
      if (mode & 0o222) {
        failures.push(
          `${label} is writable (mode ${mode.toString(8)}); expected read-only (0444). ` +
            `chmod 0444 it. Hash still authoritative.`,
        );
      }
    } catch {
      /* stat failure already covered by read attempt above */
    }
  }

  return { ok: failures.length === 0, failures, hashes };
}
