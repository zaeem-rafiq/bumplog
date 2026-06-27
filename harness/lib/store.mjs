// harness/lib/store.mjs
// Persistent state for the loop: experiment start date, the last-published
// tracker entry per app (for freshness comparison), the public journal, and the
// machine-readable run records. All committed to the repo (audit trail) except
// cache. NO secrets ever written here.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(HARNESS_DIR);
// Test isolation: dry_run.mjs sets BUMPLOG_STATE_DIR / BUMPLOG_RUNS_DIR. Resolved
// lazily (at call time) because env may be set after this module is imported.
const stateDir = () => process.env.BUMPLOG_STATE_DIR || join(HARNESS_DIR, 'state');
const runsDirPath = () => process.env.BUMPLOG_RUNS_DIR || join(HARNESS_DIR, 'runs');
const PUBLISHED = () => join(stateDir(), 'published-entries.json'); // slug -> last entry
const EXPERIMENT = () => join(stateDir(), 'experiment.json');
// Public journal lives in the site so it's crawlable. The agent renders entries
// from this data file via src/pages/journal/[date].astro. Test isolation:
// dry_run.mjs sets BUMPLOG_JOURNAL_FILE (mirrors the state/runs/blockers overrides)
// so exercising the loop never mutates the committed journal.
const journalFile = () => process.env.BUMPLOG_JOURNAL_FILE || join(REPO_ROOT, 'src', 'data', 'journal.json');
// The site renders app pages from src/data/apps.json. The loop syncs published
// fields here so a publish actually surfaces on the site (not just in harness
// state). Test isolation: dry_run.mjs sets BUMPLOG_APPS_FILE.
const appsFile = () => process.env.BUMPLOG_APPS_FILE || join(REPO_ROOT, 'src', 'data', 'apps.json');

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}
function readJson(p, fallback) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Day index (1-indexed) of the experiment for a given date; sets start on first call. */
export function experimentDay(today, { setStartIfMissing = true } = {}) {
  ensureDir(stateDir());
  let exp = readJson(EXPERIMENT(), null);
  if (!exp) {
    if (!setStartIfMissing) return { day_index: null, start_date: null };
    exp = { start_date: today };
    writeFileSync(EXPERIMENT(), JSON.stringify(exp, null, 2));
  }
  const start = new Date(`${exp.start_date}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return { day_index: Math.floor((now - start) / 86400000) + 1, start_date: exp.start_date };
}

/** Last published entry for an app slug (or null). Used by the freshness check. */
export function getPublishedEntry(slug) {
  return readJson(PUBLISHED(), {})[slug] ?? null;
}

/** Record the entry now published for a slug (after all gates pass). */
export function setPublishedEntry(slug, entry) {
  ensureDir(stateDir());
  const all = readJson(PUBLISHED(), {});
  all[slug] = entry;
  writeFileSync(PUBLISHED(), JSON.stringify(all, null, 2));
}

/** Append a dated entry to the public journal (idempotent per date). */
export function appendJournalEntry(entry) {
  const jf = journalFile();
  ensureDir(dirname(jf));
  const journal = readJson(jf, []);
  const without = journal.filter((e) => e.date !== entry.date);
  const next = [...without, entry].sort((a, b) => (a.date < b.date ? 1 : -1));
  writeFileSync(jf, JSON.stringify(next, null, 2));
  return next.length;
}

/**
 * Sync a published entry's display fields into the site's app registry
 * (src/data/apps.json), so the per-app page renders the latest version,
 * changelog summary, safety badge, source link, and last-checked date.
 * Immutable update keyed by slug; a slug not in the registry is ignored (the
 * registry is the source of truth for which apps the site renders).
 * @param {string} slug
 * @param {{ latestVersion:string, changelogSummary:string, safeToUpdate:string, rationale:string, sourceUrl:string, lastChecked:string }} fields
 * @returns {boolean} whether a registry row was updated
 */
export function syncSiteApp(slug, fields) {
  const file = appsFile();
  const apps = readJson(file, null);
  if (!Array.isArray(apps)) return false;
  let updated = false;
  const next = apps.map((app) => {
    if (app.slug !== slug) return app;
    updated = true;
    return {
      ...app,
      latestVersion: fields.latestVersion ?? app.latestVersion,
      changelogSummary: fields.changelogSummary ?? app.changelogSummary,
      safeToUpdate: fields.safeToUpdate ?? app.safeToUpdate,
      rationale: fields.rationale ?? app.rationale ?? null,
      sourceUrl: fields.sourceUrl ?? app.sourceUrl,
      lastChecked: fields.lastChecked ?? app.lastChecked,
    };
  });
  if (updated) writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return updated;
}

/** Emit a machine-readable run record for error analysis. */
export function emitRunRecord(record) {
  // Test isolation: dry_run.mjs points this at a temp dir. Production leaves unset.
  const runsDir = runsDirPath();
  ensureDir(runsDir);
  const stamp = (record.date ?? 'undated').replace(/[:.]/g, '-');
  const file = join(runsDir, `run-${stamp}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));
  // Also append a one-line index for quick scanning.
  appendFileSync(
    join(runsDir, 'index.jsonl'),
    JSON.stringify({ date: record.date, status: record.status, halt: record.halt ?? null }) + '\n',
  );
  return file;
}
