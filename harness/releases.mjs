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
  const retryAfter = res.headers.get('retry-after');

  if (res.status === 304 && cached) {
    return { status: 304, data: cached.data, fromCache: true };
  }
  // Primary limit (403 + remaining 0) AND secondary/abuse limit (429, or 403 with a
  // Retry-After even when the primary quota isn't exhausted) both halt gracefully.
  if (res.status === 429 || (res.status === 403 && (remaining === 0 || retryAfter))) {
    throw new RateLimitError(`GitHub rate limit hit on ${path}.`, retryAfter ?? reset);
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

// Keep summaries well under provenance.mjs's MAX_SUMMARY_CHARS (2000) so a
// summary can never read as a wholesale republish. Raw notes fed to the model
// are bounded too — long changelogs cost budget without improving the gist.
const SUMMARY_MAX_CHARS = 1500;
const RATIONALE_MAX_CHARS = 600;
const RAW_BODY_INPUT_CHARS = 6000;
const SAFE_VALUES = new Set(['safe', 'caution', 'breaking', 'unknown']);

function clamp(s, n) {
  const str = typeof s === 'string' ? s.trim() : '';
  return str.length > n ? `${str.slice(0, n - 1).trimEnd()}…` : str;
}

/** Source URL is the one citation we can always assert — it comes from the record. */
function withSource(citations, record) {
  const url = record?.provenance?.url;
  const list = Array.isArray(citations) ? citations.filter((c) => typeof c === 'string') : [];
  if (url && !list.includes(url)) list.unshift(url);
  return list;
}

/**
 * Summarize the changelog (Sonnet). Takes `record.raw_body` as INPUT and emits a
 * FRESH summary (never a copy); carries record.provenance.url through; never
 * asserts a version/date not present in `record`. When the source has no notes
 * (tag-only fallback), returns a deterministic stub WITHOUT an LLM call rather
 * than letting the model invent content.
 * @param {object} record  a buildReleaseRecord() result (found: true)
 * @param {(o:object)=>Promise<{text:string,json?:any}>} llm  lib/llm.mjs runLLM
 * @returns {Promise<{ summary:string, citations:string[] }>}
 */
export async function summarizeChangelog(record, llm) {
  const url = record?.provenance?.url;
  const raw = (record?.raw_body ?? '').trim();
  if (!raw) {
    return {
      summary: `${record.name} ${record.tagName}: GitHub published no release notes for this ${record.kind}. See the linked source.`,
      citations: withSource([], record),
    };
  }
  if (typeof llm !== 'function') {
    throw new Error('summarizeChangelog requires an llm function (lib/llm.mjs runLLM)');
  }
  const prompt = [
    `Summarize the GitHub release notes for ${record.name} ${record.tagName}.`,
    'Reply with JSON only: {"summary": string, "citations": string[]}.',
    'RULES:',
    `- summary: plain text, 2–5 sentences, no markdown headers, focus on notable user-facing changes.`,
    `- Mention NO version number other than "${record.tagName}". Invent no dates.`,
    `- This is a fresh summary, NOT a copy of the notes.`,
    `- Put the source URL ${url} in citations.`,
    '',
    'RELEASE NOTES (input only — do not republish verbatim):',
    raw.slice(0, RAW_BODY_INPUT_CHARS),
  ].join('\n');

  const out = await llm({ prompt, role: 'build', expectJson: true });
  const j = out.json ?? {};
  const summary = clamp(j.summary ?? out.text, SUMMARY_MAX_CHARS) ||
    `${record.name} ${record.tagName}: see the linked release notes.`;
  return { summary, citations: withSource(j.citations, record) };
}

/**
 * Classify breaking changes / "safe to update?" (Sonnet). Grounded ONLY in
 * `record.raw_body` + the linked source. Emits one of
 * 'safe'|'caution'|'breaking'|'unknown' plus a rationale + citations. With no
 * source notes, returns 'unknown' deterministically (no LLM call).
 * @param {object} record  a buildReleaseRecord() result (found: true)
 * @param {(o:object)=>Promise<{text:string,json?:any}>} llm  lib/llm.mjs runLLM
 * @returns {Promise<{ safeToUpdate:'safe'|'caution'|'breaking'|'unknown', rationale:string, citations:string[] }>}
 */
export async function flagBreakingChanges(record, llm) {
  const url = record?.provenance?.url;
  const raw = (record?.raw_body ?? '').trim();
  if (!raw) {
    return {
      safeToUpdate: 'unknown',
      rationale: 'No published release notes to assess. Review the linked source before updating.',
      citations: withSource([], record),
    };
  }
  if (typeof llm !== 'function') {
    throw new Error('flagBreakingChanges requires an llm function (lib/llm.mjs runLLM)');
  }
  const prompt = [
    `Assess whether it is safe to update to ${record.name} ${record.tagName}, based ONLY on these release notes.`,
    'Reply with JSON only: {"safeToUpdate": "safe"|"caution"|"breaking"|"unknown", "rationale": string, "citations": string[]}.',
    'CLASSIFY:',
    '- "breaking": notes call out breaking changes, required migrations, or manual upgrade steps.',
    '- "caution": notable behavioral changes, deprecations, or config changes worth reading first.',
    '- "safe": routine fixes/features with no migration or breaking note.',
    '- "unknown": notes are insufficient to judge.',
    `- rationale: 1–3 sentences grounded ONLY in the notes; cite the source URL ${url}.`,
    '',
    'RELEASE NOTES (input only):',
    raw.slice(0, RAW_BODY_INPUT_CHARS),
  ].join('\n');

  const out = await llm({ prompt, role: 'build', expectJson: true });
  const j = out.json ?? {};
  const safeToUpdate = SAFE_VALUES.has(j.safeToUpdate) ? j.safeToUpdate : 'unknown';
  const rationale = clamp(j.rationale, RATIONALE_MAX_CHARS) ||
    'Assessment unavailable from the release notes; review the linked source.';
  return { safeToUpdate, rationale, citations: withSource(j.citations, record) };
}

/**
 * PROTOTYPE (not yet wired into morning_loop): summary + safe-to-update assessment
 * in ONE Sonnet call. Functionally equals summarizeChangelog + flagBreakingChanges
 * but halves the per-app LLM cost — the loop's two Sonnet calls/app collapse to one,
 * and the (large) raw_body is sent once instead of twice (input-token saving too).
 * Preserves every integrity guarantee: same grounding rules, the same empty-notes
 * deterministic path (NO llm call), the same enum + length validation. Returns the
 * union of both results so the per-app loop can drop in a single call.
 * @param {object} record  a buildReleaseRecord() result (found: true)
 * @param {(o:object)=>Promise<{text:string,json?:any}>} llm  lib/llm.mjs runLLM
 * @returns {Promise<{ summary:string, safeToUpdate:'safe'|'caution'|'breaking'|'unknown', rationale:string, citations:string[] }>}
 */
export async function summarizeAndClassify(record, llm) {
  const url = record?.provenance?.url;
  const raw = (record?.raw_body ?? '').trim();
  if (!raw) {
    return {
      summary: `${record.name} ${record.tagName}: GitHub published no release notes for this ${record.kind}. See the linked source.`,
      safeToUpdate: 'unknown',
      rationale: 'No published release notes to assess. Review the linked source before updating.',
      citations: withSource([], record),
    };
  }
  if (typeof llm !== 'function') {
    throw new Error('summarizeAndClassify requires an llm function (lib/llm.mjs runLLM)');
  }
  const prompt = [
    `Summarize AND assess update-safety for ${record.name} ${record.tagName}, based ONLY on these release notes.`,
    'Reply with JSON only: {"summary": string, "safeToUpdate": "safe"|"caution"|"breaking"|"unknown", "rationale": string, "citations": string[]}.',
    'SUMMARY:',
    '- plain text, 2–5 sentences, no markdown headers, focus on notable user-facing changes.',
    `- mention NO version number other than "${record.tagName}"; invent no dates; write a fresh summary, NOT a copy of the notes.`,
    'safeToUpdate — CLASSIFY:',
    '- "breaking": notes call out breaking changes, required migrations, or manual upgrade steps.',
    '- "caution": notable behavioral changes, deprecations, or config changes worth reading first.',
    '- "safe": routine fixes/features with no migration or breaking note.',
    '- "unknown": notes are insufficient to judge.',
    '- rationale: 1–3 sentences grounded ONLY in the notes.',
    `- put the source URL ${url} in citations.`,
    '',
    'RELEASE NOTES (input only — do not republish verbatim):',
    raw.slice(0, RAW_BODY_INPUT_CHARS),
  ].join('\n');

  const out = await llm({ prompt, role: 'build', expectJson: true });
  const j = out.json ?? {};
  const summary = clamp(j.summary ?? out.text, SUMMARY_MAX_CHARS) ||
    `${record.name} ${record.tagName}: see the linked release notes.`;
  const safeToUpdate = SAFE_VALUES.has(j.safeToUpdate) ? j.safeToUpdate : 'unknown';
  const rationale = clamp(j.rationale, RATIONALE_MAX_CHARS) ||
    'Assessment unavailable from the release notes; review the linked source.';
  return { summary, safeToUpdate, rationale, citations: withSource(j.citations, record) };
}
