// harness/freeze_locks.mjs
// Writes contract.lock.json + guardrails.lock.json ONCE, records their sha256 in
// locks.manifest.json, then chmod 0444 (read-only). Idempotent-by-refusal: if a
// lock already exists it REFUSES to overwrite (frozen means frozen).
//
//   node harness/freeze_locks.mjs --target 5     # target confirmed by the human
//
// The PostHog bot/self exclusion is configured IN PostHog and is referenced (not
// defined) here; it is frozen alongside this contract per the experiment rules.

import { writeFileSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sha256File } from './lib/locks.mjs';
import { PROTECTED_KINDS } from './lib/guards.mjs';

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(HARNESS_DIR, 'contract.lock.json');
const GUARDRAILS = join(HARNESS_DIR, 'guardrails.lock.json');
const MANIFEST = join(HARNESS_DIR, 'locks.manifest.json');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function buildContract(target) {
  return {
    version: 1,
    primary_metric: {
      name: 'returning_engaged_median_trailing_7',
      definition:
        'median daily count of returning + engaged + deduped humans over the trailing 7 days',
      computed_via:
        'HogQL in harness/analytics.mjs (getReturningEngaged); NOT a built-in "returning" tile',
    },
    definitions: {
      engaged_seconds: 45,
      engaged: 'a session with a $pageview and (duration > 45s OR a scroll/$autocapture event)',
      returning:
        'person_id seen (engaged) on a calendar day later than its first engaged day (≥2 distinct engaged days)',
      deduped: 'distinct person_id after PostHog bot/self exclusion (filterTestAccounts + ingestion bot-discard)',
    },
    channel_cap: 0.5,
    channel_cap_definition: 'no single referral source may exceed 50% of engaged uniques',
    staged_gate: {
      days_1_14: { role: 'leading', gate: 'engaged-uniques + source diversity' },
      days_15_19: { role: 'transition', gate: 'none (both reported, neither gated)' },
      days_20_30: { role: 'lagging', gate: 'returning-engaged median (hard-to-fake)' },
    },
    reported_not_gated: ['raw_visits', 'total_uniques', 'bounce'],
    target: { returning_engaged_median: target, by_day: 30 },
    bot_self_exclusion:
      'Configured in PostHog (test-account filters via filterTestAccounts + ingestion bot-discard). ' +
      'NOT defined in harness code. Frozen alongside this contract; the agent cannot change what counts as a real human.',
    persistence_note:
      'Cookie-based persistence is ON. Any undercount from the chosen consent config is acknowledged by the human at freeze time.',
  };
}

function buildGuardrails() {
  return {
    version: 1,
    protected_actions: [
      { kind: 'spend_money', rule: 'Never spend money or enter payment details.' },
      { kind: 'enter_payment', rule: 'Never enter payment details.' },
      { kind: 'modify_dns', rule: 'Never modify DNS.' },
      { kind: 'modify_auth', rule: 'Never modify auth.' },
      { kind: 'modify_access_control', rule: 'Never modify access-control / sharing permissions.' },
      { kind: 'publish_person_claim', rule: 'Never publish factual claims about real, named people.' },
      { kind: 'mass_post_external', rule: 'Never mass-post externally in any pattern risking the domain being blacklisted.' },
      { kind: 'irreversible_delete', rule: 'Never irreversibly delete data.' },
      { kind: 'fabricate_datum', rule: 'Never fabricate a tracker datum, or publish an entry without source provenance.' },
    ],
    enforcement:
      'Pre-action deny-list (harness/lib/guards.mjs) AND excluded from the agent write scope. ' +
      'On any attempt: HALT, write a dated blocker to harness/blockers/, do not proceed.',
    runtime_caps: {
      max_output_tokens: 8000,
      max_turns: 60,
      max_wall_clock_minutes: 30,
      note: 'Subscription path: the binding constraint is the rate-limit allowance, not dollars. These protect that allowance and kill runaway loops.',
    },
    rate_limit_policy:
      'On any 429 / quota-exhausted response: HALT gracefully, write a blocker, do NOT retry-hammer, resume next scheduled window.',
    reprice_tripwire:
      'If billing mode changes (requests rejected with a credit/billing message, or usage draws a separate metered credit): HALT and write a blocker. Never silently roll into pay-as-you-go.',
    auth: 'Subscription (Max 20x). ANTHROPIC_API_KEY must be unset; the loop halts if it is set.',
  };
}

function main() {
  if (existsSync(CONTRACT) || existsSync(GUARDRAILS) || existsSync(MANIFEST)) {
    console.error(
      'REFUSING: a lock or manifest already exists. Locks are frozen ONCE.\n' +
        'Delete them only with explicit human authorization to re-freeze.',
    );
    process.exit(2);
  }

  const targetRaw = arg('--target');
  const target = Number(targetRaw);
  if (!Number.isFinite(target) || target <= 0) {
    console.error('REFUSING: pass a human-confirmed positive --target N (returning-engaged median by Day 30).');
    process.exit(2);
  }

  // Consistency: the guardrail kinds must match the code's deny-list exactly.
  const guardrails = buildGuardrails();
  const declaredKinds = new Set(guardrails.protected_actions.map((a) => a.kind));
  const codeKinds = new Set(PROTECTED_KINDS);
  const missingInCode = [...declaredKinds].filter((k) => !codeKinds.has(k));
  const missingInLock = [...codeKinds].filter((k) => !declaredKinds.has(k));
  if (missingInCode.length || missingInLock.length) {
    console.error('REFUSING: guardrail kinds and code deny-list disagree.', { missingInCode, missingInLock });
    process.exit(2);
  }

  // Write canonical JSON (stable key order via the builders).
  writeFileSync(CONTRACT, JSON.stringify(buildContract(target), null, 2) + '\n');
  writeFileSync(GUARDRAILS, JSON.stringify(guardrails, null, 2) + '\n');

  const manifest = {
    frozen_at: new Date().toISOString(),
    target_returning_engaged_median: target,
    hashes: {
      'contract.lock.json': sha256File(CONTRACT),
      'guardrails.lock.json': sha256File(GUARDRAILS),
    },
    note: 'Hashes are the authoritative integrity witness; git history is a second witness. Files are chmod 0444.',
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  // Read-only on disk (local defense; git stores only the exec bit).
  chmodSync(CONTRACT, 0o444);
  chmodSync(GUARDRAILS, 0o444);
  chmodSync(MANIFEST, 0o444);

  console.log('FROZEN:');
  console.log(JSON.stringify(manifest, null, 2));
}

main();
