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
// from this data file via src/pages/journal/[date].astro.
const JOURNAL = join(REPO_ROOT, 'src', 'data', 'journal.json');

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
  ensureDir(dirname(JOURNAL));
  const journal = readJson(JOURNAL, []);
  const without = journal.filter((e) => e.date !== entry.date);
  const next = [...without, entry].sort((a, b) => (a.date < b.date ? 1 : -1));
  writeFileSync(JOURNAL, JSON.stringify(next, null, 2));
  return next.length;
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
