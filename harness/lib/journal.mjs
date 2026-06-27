// harness/lib/journal.mjs
// JOURNAL-HONESTY reconciliation. Every quantitative claim in a journal entry
// must derive from the pulled analytics. We extract numbers from the entry's
// machine-readable `metrics` block and assert they equal the telemetry the loop
// pulled. A mismatch refuses publication (fail visibly — never silently ship).

/**
 * @param {object} entryMetrics  numbers the journal entry asserts, e.g.
 *   { primary_metric, returning_engaged_today, raw_pageviews, total_uniques, max_source_share }
 * @param {object} telemetry     the object from analytics.pullAllMetrics()
 * @param {{ tolerance?: number }} [opts]  fractional tolerance for rounding (default 0)
 * @returns {{ ok: boolean, mismatches: Array<{field:string, claimed:number, actual:number}> }}
 */
export function reconcileJournal(entryMetrics, telemetry, opts = {}) {
  const tol = opts.tolerance ?? 0;
  const mismatches = [];

  const actuals = {
    primary_metric: telemetry.primary_metric,
    returning_engaged_today: lastSeriesValue(telemetry.returning_engaged_series),
    raw_pageviews: telemetry.reported_not_gated?.raw_pageviews,
    total_uniques: telemetry.reported_not_gated?.total_uniques,
    max_source_share: telemetry.channels?.max_source_share,
  };

  for (const [field, claimed] of Object.entries(entryMetrics ?? {})) {
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

  return { ok: mismatches.length === 0, mismatches };
}

function lastSeriesValue(series) {
  if (!Array.isArray(series) || !series.length) return 0;
  return Number(series[series.length - 1].returning_engaged ?? 0);
}
