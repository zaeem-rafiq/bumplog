// harness/lib/freshness.mjs
// FRESHNESS-THEATER guard (deterministic layer; the LLM judge is an added layer).
// An "update" to a tracker entry is only legitimate if the underlying GitHub
// source actually changed. A cosmetic timestamp/lastChecked bump with an
// unchanged source contentHash is fake-fresh — a logged failure.
//
// The source contentHash is computed in releases.mjs from (tag, publishedAt,
// body), i.e. from the GitHub source — not from anything the agent controls.

/**
 * Decide whether a proposed entry update reflects a real source change.
 * @param {object|null} prev   the previously published entry (or null if first time)
 * @param {object} next        the proposed entry, carrying `contentHash` from the source
 * @returns {{ fresh: boolean, reason: string, firstPublish: boolean }}
 */
export function assessFreshness(prev, next) {
  if (!next || typeof next.contentHash !== 'string' || next.contentHash.length === 0) {
    return { fresh: false, firstPublish: false, reason: 'next entry has no source contentHash — cannot verify freshness' };
  }
  if (!prev) {
    return { fresh: true, firstPublish: true, reason: 'first publish for this app' };
  }
  if (prev.contentHash !== next.contentHash) {
    return { fresh: true, firstPublish: false, reason: 'source contentHash changed (real upstream change)' };
  }
  // Same source content. If only timestamps/cosmetics changed, it's theater.
  const cosmeticOnly = onlyTimestampsDiffer(prev, next);
  return {
    fresh: false,
    firstPublish: false,
    reason: cosmeticOnly
      ? 'FRESHNESS THEATER: source unchanged, only timestamp/cosmetic fields bumped'
      : 'source unchanged; non-source fields differ but no upstream change to report',
  };
}

const TIMESTAMP_FIELDS = new Set(['lastChecked', 'updatedAt', 'publishedAt', 'fetchedAt']);

function onlyTimestampsDiffer(prev, next) {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (TIMESTAMP_FIELDS.has(k)) continue;
    if (k === 'provenance') {
      // ignore provenance.fetchedAt churn
      if (JSON.stringify(stripFetchedAt(prev[k])) !== JSON.stringify(stripFetchedAt(next[k]))) return false;
      continue;
    }
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) return false;
  }
  return true;
}

function stripFetchedAt(prov) {
  if (!prov || typeof prov !== 'object') return prov;
  const { fetchedAt, ...rest } = prov;
  return rest;
}
