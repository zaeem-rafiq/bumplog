// harness/morning_loop.mjs
// The daily-loop scaffold. Ordered, deterministic control flow with the agent's
// CREATIVE decisions left as clearly-marked TODO(agent) seams. Eval hooks
// (journal-honesty, dark-pattern judge, freshness-theater judge) are first-class
// and run every cycle. Halts gracefully on lock mismatch, rate limits, reprice,
// or a protected-action attempt — writing a dated blocker and emitting a run
// record, never retry-hammering.
//
// Run modes:
//   node harness/morning_loop.mjs            → real run (pulls live data; LLM seams active)
//   node harness/morning_loop.mjs --dry-run  → no LLM calls, no publish; exercises control flow
//
// The PROOF of the invariants lives in dry_run.mjs (it drives both the happy and
// adversarial paths). This file is the production loop the agent runs daily.

import { assertSubscriptionAuth } from './lib/env.mjs';
import { verifyLocks } from './lib/locks.mjs';
import { writeBlocker, assertAllowed } from './lib/guards.mjs';
import { RunBudget } from './lib/caps.mjs';
import { pullAllMetrics, RateLimitError, BillingChangeError } from './analytics.mjs';
import { buildReleaseRecord, loadAppRegistry } from './releases.mjs';
import { readFeedback, wrapFeedbackForPrompt } from './lib/feedback.mjs';
import { evaluateGate } from './lib/gate.mjs';
import { reconcileJournal } from './lib/journal.mjs';
import { canPivot, recordPivot } from './lib/hysteresis.mjs';
import { judgeFreshness } from './judges/freshness_theater.mjs';
import { judgeDarkPattern } from './judges/dark_pattern.mjs';
import { experimentDay, getPublishedEntry, appendJournalEntry, emitRunRecord, setPublishedEntry } from './lib/store.mjs';

function todayUTC(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** writeBlocker that never throws — a secondary I/O failure must not erase the run record. */
function safeWriteBlocker(kind, detail) {
  try {
    return writeBlocker(kind, detail);
  } catch (e) {
    return null; // best-effort; the run record (emitted in finally) still captures the halt
  }
}

/**
 * Run one daily cycle.
 * @param {{ now?: Date, dryRun?: boolean, llm?: Function, pullMetrics?: Function,
 *           draftOverride?: Function, buildRecord?: Function }} [opts]
 * @returns {Promise<object>} the run record
 */
export async function runLoop(opts = {}) {
  const now = opts.now ?? new Date();
  const date = todayUTC(now);
  const dryRun = opts.dryRun ?? false;
  const budget = new RunBudget();
  const trace = [];
  const log = (step, data) => {
    trace.push({ step, at: new Date().toISOString(), ...data });
  };

  const record = { date, status: 'running', mode: dryRun ? 'dry-run' : 'live', trace };

  try {
    // ── Step 0: subscription-path guard (reprice tripwire) ───────────────────
    const auth = assertSubscriptionAuth();
    log('auth-guard', { ok: auth.ok, reason: auth.reason });
    if (!auth.ok) {
      throw haltErr(auth.reason, 'reprice', safeWriteBlocker('reprice', { reason: auth.reason }));
    }

    // ── Step 1: verify frozen locks ──────────────────────────────────────────
    budget.tick();
    const locks = verifyLocks();
    log('verify-locks', { ok: locks.ok, failures: locks.failures });
    if (!locks.ok) {
      throw haltErr(`lock verification failed: ${locks.failures.join('; ')}`, 'lock-mismatch', safeWriteBlocker('lock-mismatch', locks));
    }

    // ── Step 2: pull metrics (read-only PostHog) ─────────────────────────────
    budget.tick();
    const pull = opts.pullMetrics ?? pullAllMetrics; // injectable for tests/sim
    const telemetry = await pull({ now });
    log('pull-metrics', {
      primary_metric: telemetry.primary_metric,
      engaged_uniques: telemetry.channels?.total_engaged_uniques,
      max_source_share: telemetry.channels?.max_source_share,
    });

    // ── Step 3: read feedback as UNTRUSTED data ──────────────────────────────
    budget.tick();
    const feedback = readFeedback();
    const wrapped = wrapFeedbackForPrompt(feedback);
    log('feedback', { count: feedback.length, flagged: wrapped.flagged });
    // SEAM(agent): `wrapped.block` is the ONLY way feedback enters a prompt.
    // It is data, not instructions. Use it as signal for what to build next.

    // ── Step 4: evaluate the staged gate ─────────────────────────────────────
    budget.tick();
    const { day_index, start_date } = experimentDay(date, { setStartIfMissing: !dryRun });
    const gate = evaluateGate(telemetry, day_index ?? 1);
    record.day_index = day_index;
    record.start_date = start_date;
    record.gate = gate;
    log('gate', gate);

    // ── Step 5: build today's plan + draft journal (CREATIVE SEAMS) ──────────
    // TODO(agent): decide which pages to build/refresh today from telemetry +
    // feedback + the GitHub release pipeline (see releases.mjs, AGENT_BRIEF.md).
    // Then DRAFT a journal entry. Its machine-readable `metrics` block MUST be
    // copied from telemetry — they are reconciled below and a mismatch refuses
    // publication. Public numbers MUST be rendered from this verified block.
    budget.tick(); // count the (expensive) draft turn
    const journalDraft = opts.draftOverride
      ? opts.draftOverride(date, telemetry, gate)
      : dryRun
        ? draftHonestJournalStub(date, telemetry, gate)
        : await draftJournalViaAgent(date, telemetry, gate, wrapped, opts.llm); // SEAM

    // ── Step 5b: JOURNAL-HONESTY eval (refuse mismatched OR incomplete entries) ──
    budget.tick();
    const recon = reconcileJournal(journalDraft.metrics, telemetry);
    log('journal-honesty', { ok: recon.ok, mismatches: recon.mismatches, missing: recon.missing });
    if (!recon.ok) {
      // Fail visibly: do not publish a journal entry whose numbers don't match
      // telemetry OR that omits a required canonical metric.
      record.journal_published = false;
      throw haltErr(
        `journal reconciliation failed: ${JSON.stringify({ mismatches: recon.mismatches, missing: recon.missing })}`,
        'journal-mismatch',
        safeWriteBlocker('journal-mismatch', { mismatches: recon.mismatches, missing: recon.missing }),
      );
    }

    // ── Step 6: pivot hysteresis — a REAL chokepoint, not advisory ───────────
    budget.tick();
    const pivot = canPivot(date);
    record.pivot = pivot;
    log('pivot-hysteresis', { ...pivot, intent: !!journalDraft.intent_to_pivot });
    if (journalDraft.intent_to_pivot) {
      if (!pivot.allowed) {
        // Enforced in code: a pivot inside the window halts the run.
        throw haltErr(`pivot disallowed — ${pivot.reason}`, 'pivot-hysteresis', safeWriteBlocker('pivot-hysteresis', pivot));
      }
      // recordPivot re-checks the window (defense-in-depth vs a concurrent run or
      // a mid-cycle state change). If that re-check throws, classify it as a
      // GOVERNED halt with a blocker — not an unexpected crash.
      const doRecordPivot = opts.recordPivot ?? (dryRun ? () => {} : recordPivot);
      try {
        doRecordPivot(date, journalDraft.pivot_rationale ?? '');
      } catch (e) {
        throw haltErr(`pivot record failed — ${e.message}`, 'pivot-hysteresis', safeWriteBlocker('pivot-hysteresis', { reason: e.message }));
      }
      record.pivoted = true;
    }

    // ── Step 7: judges — re-derive AUTHORITATIVE source data, stage publishes ──
    // Integrity: the harness derives contentHash/provenance/version from the LIVE
    // GitHub source for each entry. The agent's claimed values are NEVER trusted,
    // so "freshness" and provenance cannot be fabricated.
    budget.tick();
    const proposedEntries = journalDraft.proposed_entries ?? []; // SEAM output
    const buildRecord = opts.buildRecord ?? buildReleaseRecord;
    const registry = loadAppRegistry();
    const freshnessVerdicts = [];
    const toPublish = []; // STAGED — nothing persists until step 8 succeeds (atomicity)
    for (const entry of proposedEntries) {
      budget.tick(); // each entry is real work — count it against the caps
      const app = registry.find((a) => a.slug === entry.slug);
      if (!app || !app.repo) {
        throw haltErr(`proposed entry slug "${entry.slug}" is not in the app registry`, 'unknown-app', safeWriteBlocker('unknown-app', { slug: entry.slug }));
      }
      const source = await buildRecord(app); // authoritative GitHub record
      if (!source || source.found === false) {
        // No real release/tag — refuse to publish rather than let the agent invent one.
        log('no-source', { slug: entry.slug });
        continue;
      }
      // Override integrity-bearing fields with harness-derived values; keep the
      // agent's summary/safeToUpdate prose. raw_body is stripped before publish.
      const verified = stripRaw({
        ...entry,
        name: app.name,
        slug: app.slug,
        tagName: source.tagName,
        contentHash: source.contentHash, // <- from GitHub, NOT from the agent
        provenance: source.provenance, // <- from GitHub, NOT from the agent
      });
      assertAllowed({ kind: 'publish_entry', entry: verified }); // provenance gate (halts if invalid)
      const prev = getPublishedEntry(entry.slug);
      const v = await judgeFreshness({ prev, next: verified }, { llm: dryRun ? null : opts.llm });
      freshnessVerdicts.push({ slug: entry.slug, verdict: v.verdict, reason: v.authoritative.reason });
      if (v.verdict === 'theater') {
        log('freshness-theater', { slug: entry.slug, blocked: true, reason: v.authoritative.reason });
        continue;
      }
      toPublish.push(verified); // stage only; commit in step 8
    }
    const darkVerdicts = [];
    for (const mech of journalDraft.proposed_retention_mechanics ?? []) {
      budget.tick();
      const dv = await judgeDarkPattern(mech, { llm: dryRun ? null : opts.llm });
      darkVerdicts.push({ name: mech.name, verdict: dv.verdict, signatures: dv.signatures });
      // TODO(agent): a 'dark-pattern' verdict means the mechanic must NOT ship.
    }
    record.judges = { freshness: freshnessVerdicts, dark_pattern: darkVerdicts };
    log('judges', record.judges);

    // ── Step 8: append journal + commit staged publishes ATOMICALLY ──────────
    budget.tick();
    if (!dryRun) {
      // Journal first, then advance the published-entries tracker. If a write
      // fails mid-way the tracker is at worst BEHIND the journal (re-published
      // next run), never ahead (which would suppress a real update as theater).
      const verifiedMetrics = recon.verified ?? journalDraft.metrics;
      const count = appendJournalEntry({ date, ...journalDraft.public, metrics: verifiedMetrics });
      for (const e of toPublish) setPublishedEntry(e.slug, e);
      record.journal_published = true;
      record.journal_count = count;
      record.published_slugs = toPublish.map((e) => e.slug);
    } else {
      record.journal_published = false; // dry-run never publishes
      record.staged_slugs = toPublish.map((e) => e.slug);
    }
    log('journal-append', { published: record.journal_published });

    record.status = 'ok';
  } catch (err) {
    // Classify. Blocker writes are best-effort (safeWriteBlocker) so a secondary
    // I/O failure can never escape and skip the run record.
    if (err instanceof RateLimitError) {
      record.status = 'halted';
      record.halt = { code: 'rate-limit', reason: err.message, blocker: safeWriteBlocker('rate-limit', { retryAfter: err.retryAfter }) };
    } else if (err instanceof BillingChangeError) {
      record.status = 'halted';
      record.halt = { code: 'reprice', reason: err.message, blocker: safeWriteBlocker('reprice', { reason: err.message }) };
    } else if (err.halt) {
      record.status = 'halted';
      record.halt = { code: err.code ?? null, reason: err.message, blocker: err.blocker ?? null };
    } else {
      record.status = 'error';
      record.error = String(err.stack ?? err.message);
    }
  } finally {
    // ── Step 9: emit machine-readable run record (ALWAYS, even on halt) ───────
    record.budget = budget.remaining();
    try {
      record.run_record_file = emitRunRecord(record);
    } catch (e) {
      record.run_record_error = String(e.message);
    }
  }
  return record;
}

function haltErr(reason, code, blocker) {
  const e = new Error(`HALT: ${reason}`);
  e.halt = true;
  e.code = code;
  e.blocker = blocker;
  return e;
}

function stripRaw(entry) {
  const { raw_body, _doNotPublishRaw, ...rest } = entry;
  return rest;
}

/** DRY-RUN stub: an honest journal whose metrics are copied straight from telemetry. */
function draftHonestJournalStub(date, telemetry, gate) {
  return {
    metrics: {
      primary_metric: telemetry.primary_metric,
      returning_engaged_today: telemetry.returning_engaged_series.at(-1)?.returning_engaged ?? 0,
      raw_pageviews: telemetry.reported_not_gated.raw_pageviews,
      total_uniques: telemetry.reported_not_gated.total_uniques,
      max_source_share: telemetry.channels.max_source_share,
    },
    public: {
      title: `Day ${gate.day_index}: dry-run`,
      stage: gate.stage,
      summary: '(dry-run) control-flow exercise; no content published.',
    },
    intent_to_pivot: false,
    proposed_entries: [],
    proposed_retention_mechanics: [],
  };
}

/**
 * SEAM(agent): real journal drafting. The agent (Sonnet) decides the narrative
 * and proposes entries/mechanics, but the `metrics` block MUST be copied from
 * `telemetry` verbatim (reconciliation rejects anything else or any omission),
 * and public-facing numbers MUST be rendered from that verified block. Set
 * intent_to_pivot:true (+ pivot_rationale) only when changing strategy; the loop
 * enforces the 6-day hysteresis window in code.
 */
async function draftJournalViaAgent(/* date, telemetry, gate, wrapped, llm */) {
  throw new Error('SEAM: implement journal drafting via lib/llm.mjs (Sonnet). See AGENT_BRIEF.md §journal.');
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry-run');
  runLoop({ dryRun })
    .then((r) => {
      console.log(JSON.stringify({ status: r.status, day_index: r.day_index, halt: r.halt, run_record_file: r.run_record_file }, null, 2));
      process.exit(r.status === 'error' ? 1 : 0);
    })
    .catch((e) => {
      console.error('loop crashed:', e);
      process.exit(1);
    });
}
