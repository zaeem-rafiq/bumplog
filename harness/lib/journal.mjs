// harness/lib/journal.mjs
// JOURNAL-HONESTY reconciliation. Every quantitative claim in a journal entry
// must derive from the pulled analytics. We (1) REQUIRE a fixed set of canonical
// metric keys to be present (so a dishonest entry cannot pass by simply OMITTING
// the gated metric), and (2) assert each present value equals the telemetry the
// loop pulled. Either a mismatch or a missing required key refuses publication
// (fail visibly — never silently ship). The returned `verified` block is the
// telemetry-derived source of truth the loop publishes, so public-facing numbers
// are rendered from telemetry rather than from free-form agent prose.

/** The canonical metrics a journal entry MUST declare; absence is a failure. */
export const REQUIRED_METRICS = [
  'primary_metric',
  'returning_engaged_today',
  'raw_pageviews',
  'total_uniques',
  'max_source_share',
];

/**
 * @param {object} entryMetrics  numbers the journal entry asserts
 * @param {object} telemetry     the object from analytics.pullAllMetrics()
 * @param {{ tolerance?: number }} [opts]  fractional tolerance for rounding (default 0)
 * @returns {{ ok: boolean, mismatches: Array, missing: string[], verified: object }}
 */
export function reconcileJournal(entryMetrics, telemetry, opts = {}) {
  const tol = opts.tolerance ?? 0;
  const mismatches = [];
  const missing = [];

  const actuals = {
    primary_metric: telemetry.primary_metric,
    returning_engaged_today: lastSeriesValue(telemetry.returning_engaged_series),
    raw_pageviews: telemetry.reported_not_gated?.raw_pageviews,
    total_uniques: telemetry.reported_not_gated?.total_uniques,
    max_source_share: telemetry.channels?.max_source_share,
  };

  const em = entryMetrics ?? {};

  // (1) Every canonical metric must be present and non-null.
  for (const key of REQUIRED_METRICS) {
    const v = em[key];
    if (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) {
      missing.push(key);
    }
  }

  // (2) Every declared value must match telemetry (and reference a known source).
  for (const [field, claimed] of Object.entries(em)) {
    if (!(field in actuals)) {
      mismatches.push({ field, claimed: Number(claimed), actual: NaN, note: 'no telemetry source for this claim' });
      continue;
    }
    const actual = Number(actuals[field]);
    const c = Number(claimed);
    const diff = Math.abs(c - actual);
    const allowed = tol * Math.max(1, Math.abs(actual));
    if (!(diff <= allowed)) {
      mismatches.push({ field, claimed: c, actual });
    }
  }

  return {
    ok: mismatches.length === 0 && missing.length === 0,
    mismatches,
    missing,
    verified: actuals, // telemetry-derived; the loop publishes THESE, not agent prose
  };
}

function lastSeriesValue(series) {
  if (!Array.isArray(series) || !series.length) return 0;
  return Number(series[series.length - 1].returning_engaged ?? 0);
}
