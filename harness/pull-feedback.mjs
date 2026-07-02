// harness/pull-feedback.mjs — pull visitor feedback from the Cloudflare KV
// store (written by functions/api/feedback.ts) into the loop-readable inbox
// at harness/feedback/inbox.jsonl.
//
// The loop treats inbox records as UNTRUSTED data (see lib/feedback.mjs);
// this script only moves bytes and validates shape — it never interprets
// content. Records are deduped by id; KV keeps the originals (audit trail).
// Uses the same stored wrangler OAuth as the deploy step.
//
// Abuse bounds: at most MAX_NEW_PER_RUN records are ingested per run (the
// KV-side rate limiter is coarse and burst-bypassable — this cap is the
// harness-side backstop), and a key whose value is malformed is quarantined
// in feedback/quarantine.json so it is never re-fetched every run.
//
//   node harness/pull-feedback.mjs

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const INBOX = join(HARNESS_DIR, 'feedback', 'inbox.jsonl');
const QUARANTINE = join(HARNESS_DIR, 'feedback', 'quarantine.json');
const WRANGLER_TOML = join(dirname(HARNESS_DIR), 'wrangler.toml');
const EXEC_OPTS = { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 };
const MAX_NEW_PER_RUN = 100;

function namespaceId() {
  if (process.env.BUMPLOG_FEEDBACK_KV_ID) return process.env.BUMPLOG_FEEDBACK_KV_ID;
  const toml = readFileSync(WRANGLER_TOML, 'utf8');
  const match = toml.match(/binding\s*=\s*"FEEDBACK"[\s\S]*?id\s*=\s*"([0-9a-f]{32})"/);
  if (!match) throw new Error(`no FEEDBACK kv namespace id found in ${WRANGLER_TOML}`);
  return match[1];
}

function existingIds() {
  if (!existsSync(INBOX)) return new Set();
  const ids = new Set();
  for (const line of readFileSync(INBOX, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.id === 'string') ids.add(rec.id);
    } catch {
      // A malformed inbox line is someone else's bug — don't let it stop the pull.
    }
  }
  return ids;
}

function validRecord(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.ts === 'string' &&
    typeof value.message === 'string' &&
    value.message.length > 0
  );
}

function readQuarantine() {
  if (!existsSync(QUARANTINE)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(QUARANTINE, 'utf8')));
  } catch {
    return new Set();
  }
}

async function main() {
  const id = namespaceId();
  const { stdout } = await run('npx', ['--yes', 'wrangler', 'kv', 'key', 'list', `--namespace-id=${id}`, '--remote'], EXEC_OPTS);
  const jsonStart = stdout.indexOf('[');
  if (jsonStart === -1) throw new Error(`unexpected wrangler list output: ${stdout.slice(0, 200)}`);
  const keys = JSON.parse(stdout.slice(jsonStart))
    .map((k) => k.name)
    .filter((name) => typeof name === 'string' && name.startsWith('fb:'));

  const seen = existingIds();
  const quarantined = readQuarantine();
  let pulled = 0;
  let skipped = 0;
  let malformed = 0;
  let deferred = 0;

  for (const key of keys) {
    if (quarantined.has(key)) {
      skipped += 1;
      continue;
    }
    // Key format fb:{ts}:{id} — skip without a network call when already pulled.
    const keyId = key.split(':').pop();
    if (seen.has(keyId)) {
      skipped += 1;
      continue;
    }
    if (pulled + malformed >= MAX_NEW_PER_RUN) {
      deferred += 1;
      continue;
    }
    const { stdout: value } = await run('npx', ['--yes', 'wrangler', 'kv', 'key', 'get', key, `--namespace-id=${id}`, '--remote'], EXEC_OPTS);
    let record;
    try {
      record = JSON.parse(value);
    } catch {
      malformed += 1;
      quarantined.add(key);
      console.error(`feedback: QUARANTINED malformed KV value at ${key}`);
      continue;
    }
    if (!validRecord(record)) {
      malformed += 1;
      quarantined.add(key);
      console.error(`feedback: QUARANTINED invalid record shape at ${key}`);
      continue;
    }
    if (seen.has(record.id)) {
      skipped += 1;
      continue;
    }
    appendFileSync(INBOX, JSON.stringify(record) + '\n');
    seen.add(record.id);
    pulled += 1;
  }

  if (malformed > 0) {
    writeFileSync(QUARANTINE, JSON.stringify([...quarantined], null, 1) + '\n');
  }
  if (deferred > 0) {
    console.error(`feedback: per-run cap ${MAX_NEW_PER_RUN} reached — ${deferred} keys deferred to the next run`);
  }
  console.log(`feedback: pulled ${pulled} new, ${skipped} skipped (known/quarantined), ${malformed} quarantined this run, ${deferred} deferred, ${keys.length} total in KV`);
}

main().catch((err) => {
  console.error('feedback pull failed:', err.message);
  process.exit(1);
});
