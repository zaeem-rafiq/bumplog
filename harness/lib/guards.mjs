// harness/lib/guards.mjs
// CONSTITUTION enforcement: a pre-action deny-list for protected actions that
// are NEVER autonomous. Every action the agent attempts routes through
// assertAllowed(); a protected match HALTS the run and writes a dated blocker.
//
// Defense-in-depth: this deny-list is the runtime check; the agent's tool/write
// scope ALSO excludes these capabilities (see AGENT_BRIEF.md + the loop's
// allowed-tools). Belt and suspenders.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkProvenance } from './provenance.mjs';

const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
// Test isolation: dry_run.mjs points this at a temp dir so simulated blockers
// never pollute the committed audit trail. Production leaves it unset.
function blockersDir() {
  return process.env.BUMPLOG_BLOCKERS_DIR || join(HARNESS_DIR, 'blockers');
}

/** Canonical protected action kinds (mirrors guardrails.lock.json protected_actions). */
export const PROTECTED_KINDS = new Set([
  'spend_money',
  'enter_payment',
  'modify_dns',
  'modify_auth',
  'modify_access_control',
  'publish_person_claim',
  'mass_post_external',
  'irreversible_delete',
  'fabricate_datum',
]);

/**
 * Evaluate a proposed action against the constitution.
 * @param {{ kind: string, detail?: string, entry?: object }} action
 * @returns {{ allowed: boolean, reason: string, halt: boolean }}
 */
export function evaluateAction(action) {
  if (!action || typeof action.kind !== 'string') {
    return { allowed: false, halt: true, reason: 'malformed action (no kind)' };
  }

  if (PROTECTED_KINDS.has(action.kind)) {
    return {
      allowed: false,
      halt: true,
      reason: `protected action "${action.kind}" is never autonomous — ${action.detail ?? ''}`.trim(),
    };
  }

  // Publishing a tracker entry is allowed only WITH provenance + no raw body.
  if (action.kind === 'publish_entry') {
    const prov = checkProvenance(action.entry);
    if (!prov.ok) {
      return {
        allowed: false,
        halt: true,
        reason: `publish_entry blocked — provenance/integrity failure: ${prov.violations.join('; ')}`,
      };
    }
    return { allowed: true, halt: false, reason: 'entry has valid provenance' };
  }

  return { allowed: true, halt: false, reason: 'not a protected action' };
}

/**
 * Assert an action is allowed; on violation, write a dated blocker and throw a
 * HALT error (fail visibly). The loop catches this, stops, and resumes next run.
 */
export function assertAllowed(action) {
  const verdict = evaluateAction(action);
  if (!verdict.allowed) {
    const file = writeBlocker('protected-action', {
      action: { kind: action.kind, detail: action.detail ?? null },
      reason: verdict.reason,
    });
    const err = new Error(`HALT: ${verdict.reason} (blocker: ${file})`);
    err.halt = true;
    err.blocker = file;
    throw err;
  }
  return verdict;
}

/**
 * Write a dated blocker to harness/blockers/. Returns the path. Used for
 * protected-action attempts, rate-limit halts, reprice tripwire, lock mismatch.
 * @param {string} kind   e.g. 'protected-action' | 'rate-limit' | 'reprice' | 'lock-mismatch'
 * @param {object} detail JSON-serializable context (NO secrets)
 */
export function writeBlocker(kind, detail) {
  const dir = blockersDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString();
  const safeStamp = stamp.replace(/[:.]/g, '-');
  const file = join(dir, `${safeStamp}_${kind}.json`);
  writeFileSync(file, JSON.stringify({ kind, at: stamp, detail }, null, 2));
  return file;
}
