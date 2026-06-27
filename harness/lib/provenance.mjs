// harness/lib/provenance.mjs
// Enforces the data-integrity rule: NO tracker entry is publishable without a
// source-release link, and concrete data (version/date) must be present (not
// fabricated placeholders). Used as a pre-publish gate by the loop.

/**
 * Validate a tracker entry the agent wants to publish.
 * @param {object} entry
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkProvenance(entry) {
  const violations = [];

  if (!entry || typeof entry !== 'object') {
    return { ok: false, violations: ['entry is not an object'] };
  }

  const prov = entry.provenance;
  if (!prov || typeof prov !== 'object') {
    violations.push('missing provenance object');
  } else {
    if (!isHttpsUrl(prov.url)) {
      violations.push('provenance.url missing or not an https link');
    } else if (!isGitHubHost(prov.url)) {
      // The source of truth is the GitHub API — the link must point at github.com,
      // not just any https URL.
      violations.push('provenance.url host is not github.com — the datum must link to a GitHub release/tag');
    } else if (!isBlankOrPlaceholder(entry.tagName) && !urlReferencesTag(prov.url, entry.tagName)) {
      // The link must actually reference the claimed version, not a generic page.
      violations.push(`provenance.url does not reference the claimed version "${entry.tagName}" — link must point to that release/tag`);
    }
    if (prov.source !== 'github') violations.push('provenance.source must be "github"');
  }

  // Concrete data must trace to the source — no invented/placeholder values.
  if (isBlankOrPlaceholder(entry.tagName) && isBlankOrPlaceholder(entry.latestVersion)) {
    violations.push('no version (tagName/latestVersion) — leave blank rather than invent, but then it is not publishable');
  }
  for (const field of ['name', 'slug']) {
    if (isBlankOrPlaceholder(entry[field])) violations.push(`${field} missing/placeholder`);
  }
  // A published entry must not carry the raw release body verbatim, under the
  // literal key OR aliased into another text field (a long blob ~= wholesale
  // republish, which violates the "summarize, don't republish" rule).
  if (entry._doNotPublishRaw === true || 'raw_body' in entry) {
    violations.push('entry still carries raw_body — summarize and strip raw_body before publishing');
  }
  for (const field of ['summary', 'changelogSummary', 'body', 'notes']) {
    const v = entry[field];
    if (typeof v === 'string' && v.length > MAX_SUMMARY_CHARS) {
      violations.push(`${field} is ${v.length} chars (> ${MAX_SUMMARY_CHARS}) — looks like wholesale republish, not a summary`);
    }
  }

  return { ok: violations.length === 0, violations };
}

const MAX_SUMMARY_CHARS = 2000;

function isHttpsUrl(v) {
  return typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v);
}

function isGitHubHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') === 'github.com';
  } catch {
    return false;
  }
}

function urlReferencesTag(url, tag) {
  // The tag must be the exact release path segment, not just any substring
  // (so "v1" does not match ".../tag/v1.10.0" and a tag in the owner segment
  // does not count). Accepts the raw and percent-encoded forms.
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const t = String(tag);
  const re = new RegExp(`/releases/tag/(?:${esc(t)}|${esc(encodeURIComponent(t))})(?:[/?#]|$)`);
  return re.test(url);
}

const PLACEHOLDERS = new Set([
  '', 'tbd', 'todo', 'placeholder', 'n/a', 'na', 'xxx', 'lorem', 'foo', 'bar', 'example',
]);

function isBlankOrPlaceholder(v) {
  if (v == null) return true;
  if (typeof v !== 'string') return false;
  return PLACEHOLDERS.has(v.trim().toLowerCase());
}
