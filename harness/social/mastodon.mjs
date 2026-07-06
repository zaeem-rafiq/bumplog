// harness/social/mastodon.mjs — project the day's verdicts to an OWNED Mastodon
// account. Free API, one POST per toot, no dependency (built-in fetch).
//
// This is a SCOPE EXPANSION over the day-one brief — see ./DECISION.md. It is
// NOT `mass_post_external` (that guardrail targets spamming other people's
// communities in a blacklist-risking pattern). This posts to our own account,
// capped, bot-labelled, and defaults to a human-approval QUEUE. It stays inert
// until MASTODON_INSTANCE + MASTODON_TOKEN are present in the environment.
//
// Every posted value traces to a real source: the verdict, version, and link
// all come from src/data/apps.json (itself GitHub-derived). Nothing invented.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POSTED_LOG = join(HERE, 'posted.jsonl'); // idempotency: (slug,version) already handled
const QUEUE_DIR = join(HERE, '..', '..', 'tasks', 'discovery', 'queue');

const MASTODON_MAX_LEN = 500; // default instance status limit
const VERDICT = {
  safe: { emoji: '🟢', phrase: 'safe to update' },
  caution: { emoji: '🟠', phrase: 'update with caution' },
  breaking: { emoji: '🔴', phrase: 'breaking changes — read before you upgrade' },
  unknown: { emoji: '⚪', phrase: 'changes unclear — check the notes' },
  unmaintained: { emoji: '⚫', phrase: 'no longer maintained' },
};

/** First sentence of the strongest available reason, trimmed to `max` chars. */
function shortReason(app, max = 180) {
  const src = (app.rationale || app.changelogSummary || '').trim();
  if (!src) return '';
  const first = src.split(/(?<=\.)\s+/)[0].trim();
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

function hashtag(slug) {
  return `#${String(slug).replace(/[^a-z0-9]/gi, '')}`;
}

/** Pure: build one toot string for a verdict entry. Never exceeds MASTODON_MAX_LEN. */
export function formatVerdictPost(app) {
  const v = VERDICT[app.safeToUpdate] || VERDICT.unknown;
  const url = `https://bumplog.org/apps/${app.slug}/`;
  const tags = `#selfhosted ${hashtag(app.slug)}`;
  const header = `${v.emoji} ${app.name} ${app.latestVersion} — ${v.phrase}.`;
  const reason = shortReason(app);
  const successor = app.successor ? `Successor: ${app.successor}` : '';
  const parts = [header, reason, successor, url, tags].filter(Boolean);
  let post = parts.join('\n\n');
  if (post.length > MASTODON_MAX_LEN) {
    // Over budget: keep the successor (it's the actionable takeaway) but drop the
    // reason. Header + link + tags are non-negotiable.
    post = [header, successor, url, tags].filter(Boolean).join('\n\n');
  }
  if (post.length > MASTODON_MAX_LEN) {
    // Still over: the successor line is droppable too, like the reason.
    post = [header, url, tags].join('\n\n');
  }
  return post;
}

/** Pure: resolve published slugs to postable, assessed app entries, capped. */
export function selectPostable(publishedSlugs, apps, cap) {
  const bySlug = new Map(apps.map((a) => [a.slug, a]));
  return (publishedSlugs || [])
    .map((s) => bySlug.get(s))
    .filter((a) => a && a.safeToUpdate != null && a.latestVersion)
    .slice(0, cap);
}

function alreadyPosted() {
  if (!existsSync(POSTED_LOG)) return new Set();
  const seen = new Set();
  for (const line of readFileSync(POSTED_LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      seen.add(`${r.slug}@${r.version}`);
    } catch { /* skip malformed audit line */ }
  }
  return seen;
}

function recordPosted(entry) {
  appendFileSync(POSTED_LOG, JSON.stringify(entry) + '\n');
}

/** POST one status to the instance. Throws on non-2xx (caller decides fatality). */
async function postStatus(instance, token, status, idemKey) {
  const res = await fetch(`${instance.replace(/\/$/, '')}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idemKey,
    },
    body: JSON.stringify({ status, visibility: 'public' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Mastodon POST ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return { id: json.id, url: json.url };
}

/**
 * Orchestrate the day's social posting.
 * @param {{ apps: object[], publishedSlugs: string[], env?: object, date: string }} args
 * @returns {Promise<object>} a run-record-friendly result (never throws for a
 *   missing config or a single failed post; posting is a non-fatal enrichment).
 */
export async function runSocial({ apps, publishedSlugs, env = process.env, date }) {
  const instance = env.MASTODON_INSTANCE;
  const token = env.MASTODON_TOKEN;
  const mode = (env.MASTODON_MODE || 'queue').toLowerCase(); // queue | auto
  const cap = Number(env.MASTODON_MAX_POSTS_PER_DAY || 3);

  if (!instance || !token) {
    return { skipped: true, reason: 'no MASTODON_INSTANCE/MASTODON_TOKEN — inert', posted: [] };
  }

  const seen = alreadyPosted();
  const candidates = selectPostable(publishedSlugs, apps, cap).filter(
    (a) => !seen.has(`${a.slug}@${a.latestVersion}`),
  );

  if (candidates.length === 0) {
    return { skipped: false, mode, reason: 'nothing new to post', posted: [], queued: [] };
  }

  if (mode === 'queue') {
    mkdirSync(QUEUE_DIR, { recursive: true });
    const file = join(QUEUE_DIR, `mastodon-${date}.md`);
    const body = [
      `# Mastodon — proposed toots for ${date} (review, then flip MASTODON_MODE=auto)`,
      '',
      ...candidates.map((a) => '```\n' + formatVerdictPost(a) + '\n```'),
    ].join('\n\n');
    writeFileSync(file, body + '\n');
    const queued = candidates.map((a) => ({ slug: a.slug, version: a.latestVersion }));
    return { skipped: false, mode, queued, posted: [], queueFile: file };
  }

  // mode === 'auto'
  const posted = [];
  for (const a of candidates) {
    const status = formatVerdictPost(a);
    const idemKey = `bumplog-${date}-${a.slug}-${a.latestVersion}`;
    try {
      const { id, url } = await postStatus(instance, token, status, idemKey);
      const entry = { date, slug: a.slug, version: a.latestVersion, status_url: url, id };
      recordPosted(entry);
      posted.push(entry);
    } catch (err) {
      // Fail visibly but non-fatally: surface the skipped post in the record.
      posted.push({ date, slug: a.slug, version: a.latestVersion, error: String(err.message || err) });
    }
  }
  return { skipped: false, mode, posted, queued: [] };
}
