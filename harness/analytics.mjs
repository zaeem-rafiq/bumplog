// harness/analytics.mjs
// READ-ONLY PostHog client over the HogQL query API.
//
// Computes the frozen contract's metrics to their EXACT definitions. It does
// NOT use any built-in "returning" tile. Bot/self exclusion is NEVER defined
// here: we set `filterTestAccounts: true`, which expands to the project's
// PostHog-managed test-account filters, and rely on PostHog's ingestion-time
// bot discarding. The agent cannot change what counts as a real human because
// that config lives in PostHog, not in this file (and this file is outside the
// agent's write scope).
//
// Contract definitions implemented here (kept in lockstep with contract.lock.json):
//   engaged  : a session with a $pageview and (duration > ENGAGED_SECONDS OR a
//              $autocapture interaction event). (scroll depth rides on autocapture)
//   returning: a person seen (engaged) on a calendar day LATER than their first
//              engaged calendar day — i.e. ≥2 distinct engaged days.
//   deduped  : distinct person_id, after bot/self exclusion.
//   primary  : median of the trailing-7 daily returning-engaged counts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from './lib/env.mjs';

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));

/** Thrown on 429 / quota exhaustion so the loop halts gracefully (no retry-hammer). */
export class RateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter ?? null;
  }
}

/** Thrown when PostHog signals a billing/credit change (reprice tripwire). */
export class BillingChangeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BillingChangeError';
  }
}

/**
 * Read ENGAGED_SECONDS from the frozen contract so the query is provably tied
 * to the contract, not a stray constant. Falls back to 45 pre-freeze (dev only).
 */
function engagedSeconds() {
  try {
    const lock = JSON.parse(readFileSync(join(HARNESS_DIR, 'contract.lock.json'), 'utf8'));
    const t = lock?.definitions?.engaged_seconds;
    if (Number.isFinite(t)) return t;
  } catch {
    /* lock not frozen yet — dev fallback below */
  }
  return 45;
}

/** Low-level HogQL POST. Returns rows as arrays + columns. Never logs the key. */
export async function hogql(query, { filters = {}, values = {}, label = 'hogql' } = {}) {
  const env = loadEnv();
  const url = `${env.POSTHOG_HOST}/api/projects/${env.POSTHOG_PROJECT_ID}/query/`;
  const body = {
    query: { kind: 'HogQLQuery', query, values, filters },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`PostHog request failed (${label}): ${err.message}`);
  }

  if (res.status === 429) {
    throw new RateLimitError(
      `PostHog rate-limited the query (${label}).`,
      res.headers.get('retry-after'),
    );
  }
  if (res.status === 402) {
    throw new BillingChangeError(`PostHog returned 402 (billing/credit) on ${label}.`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (/billing|credit|quota|payment/i.test(text)) {
      throw new BillingChangeError(`PostHog ${res.status} with billing-shaped message on ${label}.`);
    }
    throw new Error(`PostHog ${res.status} on ${label}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  return {
    columns: json.columns ?? [],
    results: json.results ?? [],
    rows: (json.results ?? []).map((r) =>
      Object.fromEntries((json.columns ?? []).map((c, i) => [c, r[i]])),
    ),
  };
}

/** Wide filter window: trailing-N plus a lookback so "first engaged day" predates it. */
function windowFilters(days, lookbackDays) {
  return {
    dateRange: { date_from: `-${days + lookbackDays}d`, date_to: null },
    filterTestAccounts: true,
  };
}

/** UTC calendar-day string YYYY-MM-DD, offset days ago from `now`. */
function dayStr(now, offsetDaysAgo) {
  const d = new Date(now.getTime() - offsetDaysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

// PostHog HogQL resolves `{filters}` (date range + test-account exclusion) from
// the `filters` field, but treats any OTHER `{x}` as a `values` lookup — and the
// two mechanisms conflict (passing `values` makes it look for `{filters}` there
// and fail). So we keep `{filters}` as the SOLE placeholder and interpolate the
// harness-controlled constants (engaged-seconds, window dates) directly. These
// are NOT user input (a lock number + ISO dates we generate); both are validated
// below to foreclose any injection.
function dateLit(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error(`unsafe date literal: ${s}`);
  return s;
}
function intLit(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) throw new Error(`unsafe numeric literal: ${n}`);
  return Math.trunc(v);
}

// One engaged-day PER SESSION (attributed to the session's start day, in UTC),
// NOT per pageview — so a single session straddling midnight cannot manufacture a
// second "engaged day" and read as a return. All event→date conversions are
// UTC-pinned (toTimeZone) so SQL day labels always match the UTC JS day keys
// regardless of the PostHog project timezone.
const returningEngagedSQL = (es, ws, we) => `
WITH
sess AS (
  SELECT
    person_id,
    $session_id AS sid,
    toDate(toTimeZone(min(timestamp), 'UTC')) AS day,
    dateDiff('second', min(timestamp), max(timestamp)) AS secs,
    countIf(event = '$autocapture') AS interactions,
    countIf(event = '$pageview') AS pvs
  FROM events
  WHERE {filters} AND notEmpty($session_id)
  GROUP BY person_id, sid
),
epd AS (
  SELECT DISTINCT person_id, day FROM sess
  WHERE pvs > 0 AND (secs > ${intLit(es)} OR interactions > 0)
),
firsts AS (SELECT person_id, min(day) AS first_day FROM epd GROUP BY person_id)
SELECT epd.day AS day, count(DISTINCT epd.person_id) AS returning_engaged
FROM epd
INNER JOIN firsts ON firsts.person_id = epd.person_id
WHERE epd.day > firsts.first_day
  AND epd.day >= toDate('${dateLit(ws)}')
  AND epd.day <= toDate('${dateLit(we)}')
GROUP BY day
ORDER BY day
`;

/**
 * The trailing-N daily returning-engaged series + the primary metric (median).
 * The window is the N most recent COMPLETE UTC days (today is excluded — a
 * still-in-progress day is not a "daily count" and would bias the median down).
 * Days with no qualifying visitors are real zeros and are included in the median.
 * @param {{ days?: number, lookbackDays?: number, now?: Date }} [opts]
 */
export async function getReturningEngaged(opts = {}) {
  const days = opts.days ?? 7;
  const lookbackDays = opts.lookbackDays ?? 90;
  const now = opts.now ?? new Date();
  const windowEnd = dayStr(now, 1); // yesterday — last complete UTC day
  const windowStart = dayStr(now, days); // N complete days back

  const { rows } = await hogql(returningEngagedSQL(engagedSeconds(), windowStart, windowEnd), {
    label: 'returning_engaged',
    filters: windowFilters(days, lookbackDays),
  });

  const byDay = new Map(rows.map((r) => [String(r.day).slice(0, 10), Number(r.returning_engaged)]));
  const series = [];
  for (let i = days; i >= 1; i--) {
    const d = dayStr(now, i);
    series.push({ day: d, returning_engaged: byDay.get(d) ?? 0 });
  }
  const values = series.map((s) => s.returning_engaged);
  return {
    series,
    median: median(values),
    window: { start: windowStart, end: windowEnd, days },
    engaged_seconds: engagedSeconds(),
  };
}

// Channel-cap denominator must be the TRUE distinct count of engaged persons, not
// the sum of per-(channel,referrer) distinct counts (which double-counts a person
// who arrives via multiple sources and understates the cap — making it under-fire).
// Each engaged person is attributed to ONE source (first-touch: the referrer of
// their earliest engaged session), so per-source counts are mutually exclusive and
// sum to the true distinct total.
const channelSQL = (es) => `
WITH
sess AS (
  SELECT person_id, $session_id AS sid,
    dateDiff('second', min(timestamp), max(timestamp)) AS secs,
    countIf(event = '$autocapture') AS interactions,
    countIf(event = '$pageview') AS pvs,
    min(timestamp) AS sess_start,
    argMin(coalesce(nullIf(properties.$channel_type, ''), 'Direct'), timestamp) AS channel,
    argMin(coalesce(nullIf(properties.$referring_domain, ''), '$direct'), timestamp) AS referrer
  FROM events
  WHERE {filters} AND notEmpty($session_id)
  GROUP BY person_id, sid
),
engaged AS (
  SELECT person_id, sess_start, channel, referrer FROM sess
  WHERE pvs > 0 AND (secs > ${intLit(es)} OR interactions > 0)
),
person_source AS (
  SELECT person_id,
    argMin(referrer, sess_start) AS referrer,
    argMin(channel, sess_start) AS channel
  FROM engaged GROUP BY person_id
)
SELECT referrer, channel, count(DISTINCT person_id) AS engaged_uniques
FROM person_source
GROUP BY referrer, channel
ORDER BY engaged_uniques DESC
`;

/** Engaged-uniques by first-touch source, plus the max single-source share. */
export async function getChannelBreakdown(opts = {}) {
  const days = opts.days ?? 7;
  const { rows } = await hogql(channelSQL(engagedSeconds()), {
    label: 'channel_breakdown',
    filters: windowFilters(days, 0),
  });
  // Rows are one-source-per-person → counts are mutually exclusive, so the sum IS
  // the true distinct engaged-person total (the correct cap denominator).
  const total = rows.reduce((a, r) => a + Number(r.engaged_uniques), 0);
  const bySource = new Map(); // a "source" = referring domain
  for (const r of rows) {
    const key = r.referrer || r.channel;
    bySource.set(key, (bySource.get(key) ?? 0) + Number(r.engaged_uniques));
  }
  let maxShare = 0;
  let topSource = null;
  for (const [src, n] of bySource) {
    const share = total > 0 ? n / total : 0;
    if (share > maxShare) {
      maxShare = share;
      topSource = src;
    }
  }
  return { rows, total_engaged_uniques: total, max_source_share: maxShare, top_source: topSource };
}

const newVsReturningSQL = (es, ws) => `
WITH
sess AS (
  SELECT person_id, $session_id AS sid,
    toDate(toTimeZone(min(timestamp), 'UTC')) AS day,
    dateDiff('second', min(timestamp), max(timestamp)) AS secs,
    countIf(event = '$autocapture') AS interactions,
    countIf(event = '$pageview') AS pvs
  FROM events WHERE {filters} AND notEmpty($session_id)
  GROUP BY person_id, sid
),
epd AS (
  SELECT DISTINCT person_id, day FROM sess
  WHERE pvs > 0 AND (secs > ${intLit(es)} OR interactions > 0)
),
firsts AS (SELECT person_id, min(day) AS first_day FROM epd GROUP BY person_id)
SELECT
  countIf(first_day >= toDate('${dateLit(ws)}')) AS new_persons,
  countIf(first_day <  toDate('${dateLit(ws)}')) AS returning_persons
FROM firsts
WHERE person_id IN (SELECT person_id FROM epd WHERE day >= toDate('${dateLit(ws)}'))
`;

/** New vs returning engaged persons over the window (complete days). */
export async function getNewVsReturning(opts = {}) {
  const days = opts.days ?? 7;
  const now = opts.now ?? new Date();
  const { rows } = await hogql(newVsReturningSQL(engagedSeconds(), dayStr(now, days)), {
    label: 'new_vs_returning',
    filters: windowFilters(days, 90),
  });
  const r = rows[0] ?? {};
  return { new: Number(r.new_persons ?? 0), returning: Number(r.returning_persons ?? 0) };
}

const REPORTED_SQL = `
SELECT
  countIf(event = '$pageview') AS raw_pageviews,
  count(DISTINCT person_id) AS total_uniques,
  count(DISTINCT $session_id) AS sessions
FROM events
WHERE {filters}
`;

/** reported_not_gated context: raw visits, total uniques, sessions (bounce proxy). */
export async function getReportedNotGated(opts = {}) {
  const days = opts.days ?? 7;
  const { rows } = await hogql(REPORTED_SQL, {
    label: 'reported_not_gated',
    filters: windowFilters(days, 0),
  });
  const r = rows[0] ?? {};
  return {
    raw_pageviews: Number(r.raw_pageviews ?? 0),
    total_uniques: Number(r.total_uniques ?? 0),
    sessions: Number(r.sessions ?? 0),
  };
}

/**
 * SCHEMA PROBE — the minimal read-path validator used by the dry run:
 * distinct person_ids by calendar day. Validates credential + query API +
 * the returning/engaged columns are queryable, without depending on the full
 * metric SQL. Returns the row schema.
 */
export async function schemaProbe(opts = {}) {
  const days = opts.days ?? 7;
  const sql = `
    SELECT toDate(toTimeZone(timestamp, 'UTC')) AS day,
           count(DISTINCT person_id) AS distinct_persons,
           countIf(event = '$pageview') AS pageviews,
           countIf(event = '$pageleave') AS pageleaves,
           countIf(event = '$autocapture') AS autocaptures
    FROM events
    WHERE {filters}
    GROUP BY day ORDER BY day`;
  const { rows, columns } = await hogql(sql, {
    label: 'schema_probe',
    filters: windowFilters(days, 0),
  });
  return { columns, rows, days };
}

/** Median of a numeric array (returns 0 for empty). */
export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** One call the loop uses: every contract metric in one object. */
export async function pullAllMetrics(opts = {}) {
  const [returningEngaged, channels, newVsReturning, reported] = await Promise.all([
    getReturningEngaged(opts),
    getChannelBreakdown(opts),
    getNewVsReturning(opts),
    getReportedNotGated(opts),
  ]);
  return {
    primary_metric: returningEngaged.median, // gated (lagging)
    returning_engaged_series: returningEngaged.series,
    window: returningEngaged.window,
    channels, // for channel_cap
    new_vs_returning: newVsReturning,
    reported_not_gated: reported,
    pulled_at: new Date().toISOString(),
  };
}
