// harness/releases.mjs
// READ-ONLY GitHub release pipeline + synthesis library.
//
// Source of truth for every tracker datum. Authenticated (5,000 req/hr vs 60
// unauth), conditional ETag requests + on-disk cache to conserve the budget.
//
// DATA INTEGRITY (hard rules, enforced by buildReleaseRecord + provenance.mjs):
//   - Every version/date/change originates HERE, from the GitHub API. The agent
//     may NEVER fabricate one.
//   - Every record carries provenance: a link to its source release/tag.
//   - The agent SUMMARIZES and LINKS changelogs; it must never wholesale-
//     republish release-note text. `raw_body` is provided only as input to the
//     summarizer and is flagged do-not-publish.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from './lib/env.mjs';
import { RateLimitError, BillingChangeError } from './analytics.mjs';

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HARNESS_DIR);
const CACHE_DIR = join(HARNESS_DIR, 'cache', 'gh');
const API = 'https://api.github.com';

function cachePath(key) {
  return join(CACHE_DIR, `${key.replace(/[^a-z0-9_.-]/gi, '_')}.json`);
}

function readCache(key) {
  try {
    return JSON.parse(readFileSync(cachePath(key), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(key, entry) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(key), JSON.stringify(entry, null, 2));
}

/**
 * Conditional GitHub GET with ETag caching. Returns { status, data, fromCache }.
 * 304 → serves cache (costs no rate-limit budget). 403/429 with exhausted
 * budget → RateLimitError (the loop halts; no retry-hammer).
 */
export async function ghFetch(path, { cacheKey } = {}) {
  const env = loadEnv();
  const key = cacheKey ?? path;
  const cached = readCache(key);

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'bumplog-harness',
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;

  let res;
  try {
    res = await fetch(`${API}${path}`, { headers });
  } catch (err) {
    if (cached) return { status: 304, data: cached.data, fromCache: true };
    throw new Error(`GitHub request failed (${path}): ${err.message}`);
  }

  const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '1');
  const reset = res.headers.get('x-ratelimit-reset');

  if (res.status === 304 && cached) {
    return { status: 304, data: cached.data, fromCache: true };
  }
  if (res.status === 429 || (res.status === 403 && remaining === 0)) {
    throw new RateLimitError(`GitHub rate limit hit on ${path}.`, reset);
  }
  if (res.status === 402) {
    throw new BillingChangeError(`GitHub returned 402 on ${path}.`);
  }
  if (res.status === 404) {
    return { status: 404, data: null, fromCache: false };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status} on ${path}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const etag = res.headers.get('etag');
  writeCache(key, { etag, data, fetchedAt: new Date().toISOString() });
  return { status: 200, data, fromCache: false, remaining };
}

/** Stable content hash of a release's source-meaningful fields (for freshness checks). */
export function releaseContentHash({ tagName, publishedAt, body }) {
  return createHash('sha256')
    .update(`${tagName ?? ''}\n${publishedAt ?? ''}\n${body ?? ''}`, 'utf8')
    .digest('hex');
}

/** Load the shared app registry (same file the site renders). */
export function loadAppRegistry() {
  const p = join(REPO_ROOT, 'src', 'data', 'apps.json');
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read app registry at src/data/apps.json: ${err.message}`);
  }
}

/**
 * Build a provenance-bearing release record for one app from the GitHub API.
 * Falls back to tags when a repo publishes no GitHub Releases. NEVER fabricates:
 * if no release/tag is found, returns { found: false } — the agent must not
 * invent a version.
 * @param {{ slug:string, name:string, repo:string }} app  repo = "owner/name"
 */
export async function buildReleaseRecord(app) {
  const [owner, repo] = String(app.repo).split('/');
  if (!owner || !repo) throw new Error(`app.repo must be "owner/name", got "${app.repo}"`);

  // Try GitHub Releases first.
  const rel = await ghFetch(`/repos/${owner}/${repo}/releases/latest`, {
    cacheKey: `${owner}_${repo}_latest_release`,
  });

  if (rel.status !== 404 && rel.data) {
    const r = rel.data;
    return finalizeRecord(app, {
      kind: 'release',
      tagName: r.tag_name,
      name: r.name,
      publishedAt: r.published_at,
      raw_body: r.body ?? '',
      sourceUrl: r.html_url,
      prerelease: r.prerelease,
    });
  }

  // Fallback: latest tag.
  const tags = await ghFetch(`/repos/${owner}/${repo}/tags?per_page=1`, {
    cacheKey: `${owner}_${repo}_tags`,
  });
  if (tags.data?.length) {
    const t = tags.data[0];
    return finalizeRecord(app, {
      kind: 'tag',
      tagName: t.name,
      name: t.name,
      publishedAt: null, // tags carry no publish date without an extra commit fetch
      raw_body: '',
      sourceUrl: `https://github.com/${owner}/${repo}/releases/tag/${t.name}`,
      prerelease: false,
    });
  }

  return { found: false, slug: app.slug, repo: app.repo };
}

function finalizeRecord(app, src) {
  return {
    found: true,
    slug: app.slug,
    name: app.name,
    repo: app.repo,
    kind: src.kind,
    tagName: src.tagName,
    releaseName: src.name,
    publishedAt: src.publishedAt,
    prerelease: src.prerelease,
    // Provenance — REQUIRED on every published datum.
    provenance: { source: 'github', url: src.sourceUrl, fetchedAt: new Date().toISOString() },
    contentHash: releaseContentHash({
      tagName: src.tagName,
      publishedAt: src.publishedAt,
      body: src.raw_body,
    }),
    // Input to the summarizer ONLY. Do not publish verbatim.
    raw_body: src.raw_body,
    _doNotPublishRaw: true,
  };
}

/** Pull provenance-bearing records for every app in the registry. */
export async function buildAllRecords() {
  const apps = loadAppRegistry();
  const records = [];
  for (const app of apps) {
    if (!app.repo) {
      records.push({ found: false, slug: app.slug, repo: null, note: 'no repo configured' });
      continue;
    }
    records.push(await buildReleaseRecord(app));
  }
  return records;
}

// ───────────────────────────────────────────────────────────────────────────
// SYNTHESIS SEAMS (LLM — the agent's creative work). These wrap the deterministic
// record. The version/date/url ALWAYS come from `record`, never from the model.
// Implemented in the loop via lib/llm.mjs; left as TODO seams here.
// ───────────────────────────────────────────────────────────────────────────

/**
 * TODO(agent): summarize the changelog. MUST:
 *   - take `record.raw_body` as INPUT, emit a fresh SUMMARY (not a copy);
 *   - carry record.provenance.url through to the output;
 *   - never assert a version/date not present in `record`.
 * @returns {{ summary:string, citations:string[] }}
 */
export function summarizeChangelog(/* record, llm */) {
  throw new Error('SEAM: implement via lib/llm.mjs (Sonnet). See AGENT_BRIEF.md §pillar-1.');
}

/**
 * TODO(agent): classify breaking changes / "safe to update?". MUST be grounded
 * only in `record.raw_body` + linked source; emits one of
 * 'safe' | 'caution' | 'breaking' | 'unknown' plus a rationale + citations.
 * @returns {{ safeToUpdate:'safe'|'caution'|'breaking'|'unknown', rationale:string, citations:string[] }}
 */
export function flagBreakingChanges(/* record, llm */) {
  throw new Error('SEAM: implement via lib/llm.mjs (Sonnet). See AGENT_BRIEF.md §pillar-1.');
}
