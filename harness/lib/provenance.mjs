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
    if (!isHttpsUrl(prov.url)) violations.push('provenance.url missing or not an https link');
    if (!prov.source) violations.push('provenance.source missing (e.g. "github")');
  }

  // Concrete data must trace to the source — no invented/placeholder values.
  if (isBlankOrPlaceholder(entry.tagName) && isBlankOrPlaceholder(entry.latestVersion)) {
    violations.push('no version (tagName/latestVersion) — leave blank rather than invent, but then it is not publishable');
  }
  for (const field of ['name', 'slug']) {
    if (isBlankOrPlaceholder(entry[field])) violations.push(`${field} missing/placeholder`);
  }
  // A published entry must not carry the raw release body verbatim.
  if (entry._doNotPublishRaw === true || 'raw_body' in entry) {
    violations.push('entry still carries raw_body — summarize and strip raw_body before publishing');
  }

  return { ok: violations.length === 0, violations };
}

function isHttpsUrl(v) {
  return typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v);
}

const PLACEHOLDERS = new Set([
  '', 'tbd', 'todo', 'placeholder', 'n/a', 'na', 'xxx', 'lorem', 'foo', 'bar', 'example',
]);

function isBlankOrPlaceholder(v) {
  if (v == null) return true;
  if (typeof v !== 'string') return false;
  return PLACEHOLDERS.has(v.trim().toLowerCase());
}
