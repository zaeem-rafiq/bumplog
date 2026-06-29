// harness/dry_run.mjs
// PROOF-OF-SUCCESS harness. Runs each invariant and prints the spec checklist
// with REAL evidence. Phase-aware:
//   - Deterministic invariants (provenance, freshness-theater, journal honesty,
//     feedback injection, pivot hysteresis, protected-action, 429 halt) run
//     ALWAYS — they need neither credentials nor frozen locks.
//   - Credential checks (PostHog read path, GitHub pull) run when .env is loaded.
//   - Lock write-block + sha256 checks run once freeze_locks.mjs has frozen them.
// Anything not yet runnable is reported PENDING with the exact reason, never as
// a pass or a silent skip.
//
//   set -a; source .env; set +a            # load creds (optional for phase 1)
//   node harness/dry_run.mjs

import { writeFileSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { evaluateAction } from './lib/guards.mjs';
import { checkProvenance } from './lib/provenance.mjs';
import { assessFreshness } from './lib/freshness.mjs';
import { reconcileJournal } from './lib/journal.mjs';
import { wrapFeedbackForPrompt, readFeedback, looksLikeInjection } from './lib/feedback.mjs';
import { canPivot, recordPivot, PIVOT_WINDOW_DAYS } from './lib/hysteresis.mjs';
import { runLoop } from './morning_loop.mjs';
import { RateLimitError } from './analytics.mjs';
import { CONTRACT_LOCK, GUARDRAILS_LOCK, MANIFEST, verifyLocks } from './lib/locks.mjs';

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
// Isolate all simulated side effects (blockers, run records) in temp dirs so
// the proof harness never writes into the committed audit trail.
process.env.BUMPLOG_BLOCKERS_DIR = mkdtempSync(join(tmpdir(), 'bumplog-blockers-'));
process.env.BUMPLOG_RUNS_DIR = mkdtempSync(join(tmpdir(), 'bumplog-runs-'));
process.env.BUMPLOG_STATE_DIR = mkdtempSync(join(tmpdir(), 'bumplog-state-'));
process.env.BUMPLOG_JOURNAL_FILE = join(mkdtempSync(join(tmpdir(), 'bumplog-journal-')), 'journal.json');
process.env.BUMPLOG_APPS_FILE = join(mkdtempSync(join(tmpdir(), 'bumplog-apps-')), 'apps.json');
const results = [];
const add = (id, status, evidence) => results.push({ id, status, evidence });
const haveCreds = ['POSTHOG_PERSONAL_API_KEY', 'POSTHOG_PROJECT_ID', 'POSTHOG_HOST'].every((k) => process.env[k]);
const haveGh = !!process.env.GITHUB_TOKEN;
const locksFrozen = existsSync(CONTRACT_LOCK) && existsSync(GUARDRAILS_LOCK) && existsSync(MANIFEST);

async function main() {
  // 1) ANTHROPIC_API_KEY unset ----------------------------------------------
  {
    const set = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
    add('anthropic_unset', set ? 'fail' : 'pass', set ? 'ANTHROPIC_API_KEY IS SET — would bill API rates' : 'ANTHROPIC_API_KEY not present in runtime');
  }

  // 2) PostHog read path (schema probe) -------------------------------------
  if (haveCreds) {
    try {
      const { schemaProbe } = await import('./analytics.mjs');
      const probe = await schemaProbe({ days: 7 });
      add('posthog_read', 'pass', `HogQL distinct-persons-by-day OK; columns=[${probe.columns.join(', ')}]; rows=${probe.rows.length}`);
    } catch (err) {
      add('posthog_read', 'fail', `HogQL probe failed: ${err.message}`);
    }
  } else {
    add('posthog_read', 'pending', 'no PostHog creds in env — run `set -a; source .env; set +a` first');
  }

  // 3) PostHog client config (cookie/autocapture/$pageleave) in built HTML ---
  {
    const distIdx = join(dirname(HARNESS_DIR), 'dist', 'index.html');
    if (existsSync(distIdx)) {
      const { readFileSync } = await import('node:fs');
      const html = readFileSync(distIdx, 'utf8');
      const checks = {
        autocapture: /autocapture\s*:\s*true/.test(html),
        capture_pageleave: /capture_pageleave\s*:\s*true/.test(html),
        persistence_cookie: /persistence\s*:\s*['"]localStorage\+cookie['"]/.test(html),
      };
      const ok = Object.values(checks).every(Boolean);
      add('posthog_config', ok ? 'pass' : (process.env.PUBLIC_POSTHOG_KEY ? 'fail' : 'pending'),
        ok ? 'built HTML has autocapture+capture_pageleave+localStorage+cookie' : `flags in dist: ${JSON.stringify(checks)} (rebuild with PUBLIC_POSTHOG_KEY set)`);
    } else {
      add('posthog_config', 'pending', 'no dist/ build yet — run `npm run build` with PUBLIC_POSTHOG_KEY set; project-level bot/test-account filters are human-confirmed in PostHog');
    }
  }

  // 4) GitHub release pull for seed apps ------------------------------------
  if (haveGh) {
    try {
      const { buildReleaseRecord } = await import('./releases.mjs');
      const rec = await buildReleaseRecord({ slug: 'immich', name: 'Immich', repo: 'immich-app/immich' });
      add('github_pull', rec.found ? 'pass' : 'fail',
        rec.found ? `Immich ${rec.tagName} (${rec.kind}) @ ${rec.publishedAt} → ${rec.provenance.url}` : 'no release/tag found');
    } catch (err) {
      add('github_pull', 'fail', `GitHub pull failed: ${err.message}`);
    }
  } else {
    add('github_pull', 'pending', 'no GITHUB_TOKEN in env');
  }

  // 5 & 6) lock write-block + sha256 ----------------------------------------
  if (locksFrozen) {
    add('verify_locks_sha', verifyLocks().ok ? 'pass' : 'fail', JSON.stringify(verifyLocks().failures));
    for (const [id, path, label] of [['contract_lock_blocked', CONTRACT_LOCK, 'contract.lock.json'], ['guardrails_lock_blocked', GUARDRAILS_LOCK, 'guardrails.lock.json']]) {
      const mode = statSync(path).mode & 0o777;
      let blocked = false;
      let detail = `mode=${mode.toString(8)}`;
      try {
        writeFileSync(path, '{"tampered":true}');
        detail += '; WRITE SUCCEEDED (NOT read-only!)';
      } catch (err) {
        blocked = true;
        detail += `; write rejected: ${err.code ?? err.message}`;
      }
      add(id, blocked ? 'pass' : 'fail', `${label} ${detail}`);
    }
  } else {
    add('verify_locks_sha', 'pending', 'locks not frozen — run freeze_locks.mjs --target N after human confirms');
    add('contract_lock_blocked', 'pending', 'locks not frozen yet');
    add('guardrails_lock_blocked', 'pending', 'locks not frozen yet');
  }

  // 7) tracker entry with no provenance → BLOCKED ----------------------------
  {
    const noProv = { slug: 'immich', name: 'Immich', tagName: 'v1.120.0' };
    const v = evaluateAction({ kind: 'publish_entry', entry: noProv });
    const p = checkProvenance(noProv);
    add('no_provenance_blocked', !v.allowed ? 'pass' : 'fail', `evaluateAction.allowed=${v.allowed}; violations=[${p.violations.join('; ')}]`);
  }

  // 8) freshness-theater probe (timestamp bump, no source change) → flagged --
  {
    const prev = { slug: 'immich', tagName: 'v1.120.0', contentHash: 'abc123', lastChecked: '2026-06-25' };
    const next = { slug: 'immich', tagName: 'v1.120.0', contentHash: 'abc123', lastChecked: '2026-06-26' };
    const f = assessFreshness(prev, next);
    add('freshness_theater', !f.fresh ? 'pass' : 'fail', `fresh=${f.fresh}; reason="${f.reason}"`);
  }

  // 9) journal reconciliation: clean vs tampered vs OMITTED -----------------
  {
    const telem = { primary_metric: 4, returning_engaged_series: [{ day: 'd', returning_engaged: 4 }], reported_not_gated: { raw_pageviews: 200, total_uniques: 120 }, channels: { max_source_share: 0.3 } };
    const full = { primary_metric: 4, returning_engaged_today: 4, raw_pageviews: 200, total_uniques: 120, max_source_share: 0.3 };
    const clean = reconcileJournal(full, telem);
    const tampered = reconcileJournal({ ...full, primary_metric: 9 }, telem);
    const omitted = reconcileJournal({ raw_pageviews: 200 }, telem); // omits the gated metric → must fail
    const ok = clean.ok && !tampered.ok && !omitted.ok && omitted.missing.includes('primary_metric');
    add('journal_reconcile', ok ? 'pass' : 'fail', `clean.ok=${clean.ok}; tampered.ok=${tampered.ok}; omitted.ok=${omitted.ok} missing=${JSON.stringify(omitted.missing)}`);
  }

  // 10) feedback injection probe parsed as data and ignored -----------------
  {
    const records = readFeedback();
    const wrapped = wrapFeedbackForPrompt(records);
    const probe = records.find((r) => r.id === 'fb-injection-probe');
    const flaggedProbe = wrapped.flagged.some((f) => f.id === 'fb-injection-probe');
    // It is inert because: it is inside the delimited data block, the closing
    // </feedback> it tried to inject was neutralized, and the guardrails/target
    // are enforced in frozen code regardless of any feedback content.
    const brokeOut = /<\/feedback>\s*SYSTEM:/i.test(wrapped.block); // must be FALSE
    // Quote breakout via the untrusted page/id attribute must also be neutralized.
    const quoteAttack = wrapFeedbackForPrompt([{ id: 'q', page: 'x" injected-attr="evil', message: 'hi' }]);
    const quoteBrokeOut = /injected-attr="/.test(quoteAttack.block); // must be FALSE
    const ok = !!probe && looksLikeInjection(probe.message) && flaggedProbe && !brokeOut && !quoteBrokeOut;
    add('feedback_injection', ok ? 'pass' : 'fail', `flagged=${flaggedProbe}; tag_breakout=${brokeOut}; quote_breakout=${quoteBrokeOut}`);
  }

  // 11) pivot inside hysteresis window → BLOCKED ----------------------------
  {
    // State is already isolated (BUMPLOG_STATE_DIR points at a temp dir).
    // Seed a pivot 2 days ago, then attempt today (< 6d window).
    const { mkdirSync, writeFileSync: wf } = await import('node:fs');
    mkdirSync(process.env.BUMPLOG_STATE_DIR, { recursive: true });
    wf(join(process.env.BUMPLOG_STATE_DIR, 'pivots.json'), JSON.stringify({ lastPivotDate: '2026-06-24', history: [{ date: '2026-06-24' }] }, null, 2));
    const verdict = canPivot('2026-06-26');
    let recordThrew = false;
    try {
      recordPivot('2026-06-26');
    } catch {
      recordThrew = true;
    }
    add('pivot_blocked', !verdict.allowed && recordThrew ? 'pass' : 'fail', `canPivot.allowed=${verdict.allowed} (${verdict.reason}); recordPivot blocked=${recordThrew}; window=${PIVOT_WINDOW_DAYS}d`);
  }

  // 12) simulated 429 → halted + blocker, no retry-hammer -------------------
  if (locksFrozen) {
    let calls = 0;
    const pullMetrics = async () => {
      calls += 1;
      throw new RateLimitError('simulated 429 from PostHog', '120');
    };
    const rec = await runLoop({ dryRun: true, pullMetrics, now: new Date('2026-06-26T08:00:00Z') });
    const ok = rec.status === 'halted' && rec.halt?.code === 'rate-limit' && rec.halt?.blocker && calls === 1;
    add('rate_limit_halt', ok ? 'pass' : 'fail', `status=${rec.status}; halt.code=${rec.halt?.code}; pull_calls=${calls} (no retry); blocker=${rec.halt?.blocker}`);
  } else {
    // Unit-level proof of the halt mapping without the full loop (locks not frozen).
    add('rate_limit_halt', 'pending', 'full-loop 429 sim needs frozen locks (step 1 verifies them first); unit halt path is wired in morning_loop.mjs catch block');
  }

  // 13) simulated protected-action attempt → halted + blocker ---------------
  {
    const { assertAllowed } = await import('./lib/guards.mjs');
    let threw = false;
    let blocker = null;
    try {
      assertAllowed({ kind: 'modify_dns', detail: 'simulated attempt to repoint bumplog.org' });
    } catch (err) {
      threw = err.halt === true;
      blocker = err.blocker;
    }
    add('protected_action_halt', threw && blocker && existsSync(blocker) ? 'pass' : 'fail', `halted=${threw}; blocker_written=${blocker ? existsSync(blocker) : false} (${blocker})`);
  }

  // 14) provenance must be a GitHub release URL referencing the version ------
  {
    const fakeHost = checkProvenance({ slug: 'immich', name: 'Immich', tagName: 'v1', provenance: { source: 'github', url: 'https://attacker.example/anything' } });
    const wrongTag = checkProvenance({ slug: 'immich', name: 'Immich', tagName: 'v9.9.9', provenance: { source: 'github', url: 'https://github.com/immich-app/immich/releases/tag/v1.0.0' } });
    const good = checkProvenance({ slug: 'immich', name: 'Immich', tagName: 'v1.0.0', provenance: { source: 'github', url: 'https://github.com/immich-app/immich/releases/tag/v1.0.0' } });
    // substring false-positive must be blocked: tag "v1" must NOT match ".../tag/v1.10.0"
    const substr = checkProvenance({ slug: 'immich', name: 'Immich', tagName: 'v1', provenance: { source: 'github', url: 'https://github.com/immich-app/immich/releases/tag/v1.10.0' } });
    const ok = !fakeHost.ok && !wrongTag.ok && good.ok && !substr.ok;
    add('provenance_host', ok ? 'pass' : 'fail', `non_github_blocked=${!fakeHost.ok}; wrong_tag_blocked=${!wrongTag.ok}; substring_blocked=${!substr.ok}; real_github_ok=${good.ok}`);
  }

  // 15) freshness can't be FABRICATED via the agent-supplied contentHash ----
  // The loop must re-derive contentHash from the (injected) GitHub source, so an
  // agent emitting an arbitrary "fresh" hash is ignored; only a real source change publishes.
  if (locksFrozen) {
    const { mkdirSync, writeFileSync: wf } = await import('node:fs');
    mkdirSync(process.env.BUMPLOG_STATE_DIR, { recursive: true });
    // immich already published at AUTH-HASH; jellyfin never published.
    wf(join(process.env.BUMPLOG_STATE_DIR, 'published-entries.json'),
      JSON.stringify({ immich: { slug: 'immich', tagName: 'v1', contentHash: 'AUTH-HASH' } }, null, 2));
    const telem = { primary_metric: 3, returning_engaged_series: [{ day: 'd', returning_engaged: 3 }], reported_not_gated: { raw_pageviews: 50, total_uniques: 20, sessions: 25 }, channels: { rows: [], total_engaged_uniques: 5, max_source_share: 0.4, top_source: 'x' }, new_vs_returning: { new: 3, returning: 2 } };
    const buildRecord = async (app) => {
      const url = (t) => `https://github.com/${app.repo}/releases/tag/${t}`;
      if (app.slug === 'immich') return { found: true, slug: 'immich', name: 'Immich', tagName: 'v1', contentHash: 'AUTH-HASH', provenance: { source: 'github', url: url('v1'), fetchedAt: 't' } };
      if (app.slug === 'jellyfin') return { found: true, slug: 'jellyfin', name: 'Jellyfin', tagName: 'v2', contentHash: 'NEW-HASH', provenance: { source: 'github', url: url('v2'), fetchedAt: 't' } };
      return { found: false };
    };
    const draftOverride = () => ({
      metrics: { primary_metric: 3, returning_engaged_today: 3, raw_pageviews: 50, total_uniques: 20, max_source_share: 0.4 },
      public: { title: 'probe', summary: 's' },
      intent_to_pivot: false,
      proposed_entries: [
        { slug: 'immich', tagName: 'v1', contentHash: 'FABRICATED-FRESH', provenance: { source: 'github', url: 'https://github.com/immich-app/immich/releases/tag/v1' }, summary: 'faked fresh' },
        { slug: 'jellyfin', tagName: 'v2', contentHash: 'ALSO-FAKE', provenance: { source: 'github', url: 'https://github.com/jellyfin/jellyfin/releases/tag/v2' }, summary: 'real new release' },
      ],
      proposed_retention_mechanics: [],
    });
    const rec = await runLoop({ dryRun: true, now: new Date('2026-06-27T08:00:00Z'), pullMetrics: async () => telem, draftOverride, buildRecord });
    const fr = Object.fromEntries((rec.judges?.freshness ?? []).map((v) => [v.slug, v.verdict]));
    const staged = rec.staged_slugs ?? [];
    const ok = fr.immich === 'theater' && fr.jellyfin === 'fresh' && staged.includes('jellyfin') && !staged.includes('immich');
    add('freshness_no_fabrication', ok ? 'pass' : 'fail', `immich(faked-fresh)=${fr.immich}; jellyfin(real-new)=${fr.jellyfin}; staged=${JSON.stringify(staged)}`);
  } else {
    add('freshness_no_fabrication', 'pending', 'needs frozen locks (loop verifies them at step 1)');
  }

  // 16) pivot INSIDE the window, via the loop → HALTED (real chokepoint) -----
  if (locksFrozen) {
    const { mkdirSync, writeFileSync: wf } = await import('node:fs');
    mkdirSync(process.env.BUMPLOG_STATE_DIR, { recursive: true });
    wf(join(process.env.BUMPLOG_STATE_DIR, 'pivots.json'), JSON.stringify({ lastPivotDate: '2026-06-25', history: [{ date: '2026-06-25' }] }, null, 2));
    const telem = { primary_metric: 3, returning_engaged_series: [{ day: 'd', returning_engaged: 3 }], reported_not_gated: { raw_pageviews: 50, total_uniques: 20, sessions: 25 }, channels: { rows: [], total_engaged_uniques: 5, max_source_share: 0.4, top_source: 'x' }, new_vs_returning: { new: 3, returning: 2 } };
    const draftOverride = () => ({
      metrics: { primary_metric: 3, returning_engaged_today: 3, raw_pageviews: 50, total_uniques: 20, max_source_share: 0.4 },
      public: { title: 'probe', summary: 's' },
      intent_to_pivot: true, pivot_rationale: 'reactive daily pivot attempt',
      proposed_entries: [], proposed_retention_mechanics: [],
    });
    const rec = await runLoop({ dryRun: true, now: new Date('2026-06-27T08:00:00Z'), pullMetrics: async () => telem, draftOverride });
    const ok = rec.status === 'halted' && rec.halt?.code === 'pivot-hysteresis';
    add('pivot_loop_blocked', ok ? 'pass' : 'fail', `status=${rec.status}; halt.code=${rec.halt?.code}`);
  } else {
    add('pivot_loop_blocked', 'pending', 'needs frozen locks');
  }

  // 16b) recordPivot defense-in-depth throw → GOVERNED halt (+blocker), not a crash
  if (locksFrozen) {
    const { mkdirSync, writeFileSync: wf } = await import('node:fs');
    mkdirSync(process.env.BUMPLOG_STATE_DIR, { recursive: true });
    wf(join(process.env.BUMPLOG_STATE_DIR, 'pivots.json'), JSON.stringify({ lastPivotDate: null, history: [] }, null, 2)); // canPivot allows
    const telem = { primary_metric: 3, returning_engaged_series: [{ day: 'd', returning_engaged: 3 }], reported_not_gated: { raw_pageviews: 50, total_uniques: 20, sessions: 25 }, channels: { rows: [], total_engaged_uniques: 5, max_source_share: 0.4, top_source: 'x' }, new_vs_returning: { new: 3, returning: 2 } };
    const draftOverride = () => ({ metrics: { primary_metric: 3, returning_engaged_today: 3, raw_pageviews: 50, total_uniques: 20, max_source_share: 0.4 }, public: { title: 'probe', summary: 's' }, intent_to_pivot: true, pivot_rationale: 'x', proposed_entries: [], proposed_retention_mechanics: [] });
    // canPivot allows, but recordPivot throws (simulated TOCTOU / concurrent mutation)
    const rec = await runLoop({ dryRun: true, now: new Date('2026-06-27T08:00:00Z'), pullMetrics: async () => telem, draftOverride, recordPivot: () => { throw new Error('simulated window violation at record time'); } });
    const ok = rec.status === 'halted' && rec.halt?.code === 'pivot-hysteresis' && !!rec.halt?.blocker;
    add('pivot_record_governed', ok ? 'pass' : 'fail', `status=${rec.status}; halt.code=${rec.halt?.code}; blocker=${rec.halt?.blocker ? 'written' : 'none'}`);
  } else {
    add('pivot_record_governed', 'pending', 'needs frozen locks');
  }

  // 17) full metric SQL executes live (returning-engaged + channel cap etc.) -
  if (haveCreds) {
    try {
      const { pullAllMetrics } = await import('./analytics.mjs');
      const m = await pullAllMetrics({ now: new Date('2026-06-27T08:00:00Z') });
      const shapeOk = typeof m.primary_metric === 'number' && Array.isArray(m.returning_engaged_series) && m.returning_engaged_series.length === 7 && typeof m.channels?.max_source_share === 'number';
      add('metric_sql_executes', shapeOk ? 'pass' : 'fail', `primary=${m.primary_metric}; series_len=${m.returning_engaged_series?.length}; max_source_share=${m.channels?.max_source_share}; total_engaged=${m.channels?.total_engaged_uniques}`);
    } catch (err) {
      add('metric_sql_executes', 'fail', `pullAllMetrics threw: ${err.message}`);
    }
  } else {
    add('metric_sql_executes', 'pending', 'no PostHog creds in env');
  }

  // 18) synthesis seams ground in the source: provenance carried, safety enum
  //     validated, and an empty-notes source needs NO llm call (can't fabricate)
  {
    const { summarizeChangelog, flagBreakingChanges } = await import('./releases.mjs');
    const url = 'https://github.com/immich-app/immich/releases/tag/v1.120.0';
    const record = { name: 'Immich', tagName: 'v1.120.0', kind: 'release', provenance: { source: 'github', url }, raw_body: 'Fixed a memory leak. Added album sharing.' };
    let calls = 0;
    // A deliberately misbehaving model: emits an out-of-range safety value and no citations.
    const fakeLLM = async () => { calls += 1; return { json: { summary: 'Routine fixes and a new album-sharing feature.', citations: [], safeToUpdate: 'not-a-real-value', rationale: 'Minor fixes.' }, text: '' }; };
    const sum = await summarizeChangelog(record, fakeLLM);
    const flag = await flagBreakingChanges(record, fakeLLM);
    // An empty-notes (tag-only) record must NOT invoke the llm — deterministic stub.
    const emptyRecord = { name: 'Gitea', tagName: 'v1.21.0', kind: 'tag', provenance: { source: 'github', url: 'https://github.com/go-gitea/gitea/releases/tag/v1.21.0' }, raw_body: '' };
    const callsBefore = calls;
    const emptySum = await summarizeChangelog(emptyRecord, fakeLLM);
    const emptyFlag = await flagBreakingChanges(emptyRecord, fakeLLM);
    const noLlmForEmpty = calls === callsBefore;
    const ok =
      sum.citations.includes(url) &&
      flag.citations.includes(url) &&
      flag.safeToUpdate === 'unknown' && // out-of-range value coerced to 'unknown'
      noLlmForEmpty &&
      emptyFlag.safeToUpdate === 'unknown' &&
      emptySum.summary.includes('v1.21.0');
    add('synthesis_grounded', ok ? 'pass' : 'fail', `sum_cites_src=${sum.citations.includes(url)}; flag_enum_validated=${flag.safeToUpdate === 'unknown'}; empty_no_llm=${noLlmForEmpty}; empty_flag=${emptyFlag.safeToUpdate}`);
  }

  // 19) past day 30 → experiment-complete halt: no draft, no publish ----------
  if (locksFrozen) {
    const { mkdirSync, writeFileSync: wf } = await import('node:fs');
    mkdirSync(process.env.BUMPLOG_STATE_DIR, { recursive: true });
    // Start far enough back that "now" lands past day 30 (stage 'post').
    wf(join(process.env.BUMPLOG_STATE_DIR, 'experiment.json'), JSON.stringify({ start_date: '2026-06-01' }, null, 2));
    const telem = { primary_metric: 3, returning_engaged_series: [{ day: 'd', returning_engaged: 3 }], reported_not_gated: { raw_pageviews: 50, total_uniques: 20, sessions: 25 }, channels: { rows: [], total_engaged_uniques: 5, max_source_share: 0.4, top_source: 'x' }, new_vs_returning: { new: 3, returning: 2 } };
    let drafted = false;
    const draftOverride = () => { drafted = true; return { metrics: {}, public: {}, proposed_entries: [], proposed_retention_mechanics: [] }; };
    const rec = await runLoop({ dryRun: true, now: new Date('2026-07-05T08:00:00Z'), pullMetrics: async () => telem, draftOverride });
    const ok = rec.status === 'halted' && rec.halt?.code === 'experiment-complete' && rec.journal_published !== true && drafted === false && rec.day_index > 30;
    add('experiment_complete_halt', ok ? 'pass' : 'fail', `status=${rec.status}; halt.code=${rec.halt?.code}; day_index=${rec.day_index}; drafted=${drafted}`);
  } else {
    add('experiment_complete_halt', 'pending', 'needs frozen locks');
  }

  // 22) LLM JSON extraction is robust to messy model output, so a single
  //     malformed `claude -p` reply can't sink the whole daily run. Regression
  //     guard for the 2026-06-28 brittle-extractor failure (an echoed format
  //     spec before the real object broke first-bracket→last-bracket parsing).
  {
    const { extractJson } = await import('./lib/llm.mjs');
    const cases = [
      ['{"summary":"ok","citations":["u"]}', 'ok'],
      ['```json\n{"summary":"ok"}\n```', 'ok'],
      ['The format is {"summary": string, "citations": string[]}.\n\n{"summary":"ok","citations":["u"]}', 'ok'],
      ['Here you go: {"summary":"Use {curly} braces","citations":["u"]}', 'Use {curly} braces'],
      ['{"summary":"ok"}\n\nLet me know if you want more!', 'ok'],
    ];
    let ok = true;
    let detail = '';
    for (const [input, want] of cases) {
      try {
        const r = extractJson(input);
        if (r.summary !== want) { ok = false; detail += `got '${r.summary}'!=='${want}'; `; }
      } catch (e) { ok = false; detail += `threw:${e.message}; `; }
    }
    // Genuinely-empty/garbage input must THROW (so runLLM re-asks, not silently pass).
    let threwOnGarbage = false;
    try { extractJson('no json here at all'); } catch { threwOnGarbage = true; }
    if (!threwOnGarbage) { ok = false; detail += 'garbage did not throw; '; }
    add('llm_json_robust', ok ? 'pass' : 'fail', ok ? 'prose-echo / fence / brace-in-string / trailing-prose all parsed; garbage throws' : detail);
  }

  print();
}

const CHECKLIST = [
  ['anthropic_unset', 'ANTHROPIC_API_KEY confirmed unset in agent runtime'],
  ['posthog_read', 'PostHog read path works: HogQL distinct person_ids by day, expected schema'],
  ['posthog_config', 'PostHog cookie persistence + autocapture + $pageleave confirmed enabled'],
  ['github_pull', 'GitHub release pull returned live data for the seed apps'],
  ['contract_lock_blocked', 'write attempt on contract.lock → BLOCKED'],
  ['guardrails_lock_blocked', 'write attempt on guardrails.lock → BLOCKED'],
  ['no_provenance_blocked', 'add a tracker entry with no source provenance → BLOCKED'],
  ['freshness_theater', 'freshness-theater probe (timestamp bump, no source change) → flagged'],
  ['journal_reconcile', 'journal reconciliation passed clean, FAILED on a tampered sample'],
  ['feedback_injection', 'feedback injection probe parsed as data and ignored'],
  ['pivot_blocked', 'pivot attempt inside hysteresis window → BLOCKED'],
  ['rate_limit_halt', 'simulated 429 → halted + blocker written, no retry-hammer'],
  ['protected_action_halt', 'simulated protected-action attempt → halted + blocker written'],
  ['verify_locks_sha', '(loop step 1) contract+guardrails sha256 verify clean'],
  ['provenance_host', 'provenance must be a github.com release URL referencing the version'],
  ['freshness_no_fabrication', 'agent-supplied contentHash ignored — only a real source change publishes'],
  ['pivot_loop_blocked', 'pivot intent inside the window → loop HALTS (code-enforced)'],
  ['pivot_record_governed', 'recordPivot defense-in-depth throw → governed halt + blocker (not a crash)'],
  ['metric_sql_executes', 'full metric SQL (returning-engaged + channel cap) executes live'],
  ['synthesis_grounded', 'synthesis seams carry source provenance, validate the safety enum, and never call the model on empty notes'],
  ['experiment_complete_halt', 'past day 30 → experiment-complete halt: no draft, no publish (scheduler self-disables)'],
  ['llm_json_robust', 'LLM JSON extraction tolerates prose/fences/format-echo/braces-in-strings; garbage throws so runLLM re-asks'],
];

function print() {
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  const mark = { pass: '[x]', fail: '[FAIL]', pending: '[ ] (pending)' };
  console.log('\n══════════════ BUMPLOG DRY-RUN PROOF ══════════════');
  console.log(`phase: creds=${haveCreds ? 'present' : 'absent'}  github=${haveGh ? 'present' : 'absent'}  locks=${locksFrozen ? 'frozen' : 'not-frozen'}\n`);
  let pass = 0; let fail = 0; let pending = 0;
  for (const [id, label] of CHECKLIST) {
    const r = byId[id] ?? { status: 'pending', evidence: 'not run' };
    if (r.status === 'pass') pass++; else if (r.status === 'fail') fail++; else pending++;
    console.log(`${mark[r.status]} ${label}`);
    console.log(`        → ${r.evidence}`);
  }
  console.log(`\nsummary: ${pass} pass, ${fail} fail, ${pending} pending`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('dry_run crashed:', e);
  process.exit(1);
});
