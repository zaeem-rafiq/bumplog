// Support-lifecycle context from endoflife.date, matched to an app's current
// version at build time. Data is fetched by `harness/eol.mjs` (operator/daily
// wrapper) into src/data/eol.json — the site NEVER fetches at request time and
// renders nothing for apps without verified lifecycle data.

import eolData from '../data/eol.json';

interface EolCycle {
  cycle: string;
  /** false = still supported; ISO date string = EOL on that date. */
  eol: boolean | string;
  latest?: string;
}

interface EolProduct {
  product: string;
  link: string;
  cycles: EolCycle[];
}

interface EolFile {
  generatedAt: string | null;
  source: string;
  products: Record<string, EolProduct>;
}

export interface Lifecycle {
  /** endoflife.date product slug. */
  product: string;
  /** URL of the product's endoflife.date page. */
  link: string;
  /** The release cycle the app's current version belongs to, e.g. "2.7". */
  cycle: string;
  /** false = supported; ISO date = end-of-life date (may be past or future). */
  eol: boolean | string;
  /** Human-readable status derived at build time. */
  status: 'supported' | 'eol-scheduled' | 'eol';
  /** The EOL date when known, ISO YYYY-MM-DD. */
  eolDate: string | null;
}

/** Match an app's current version to its endoflife.date release cycle.
 *  Returns null when there is no verified data or no cycle match — the page
 *  then simply omits the lifecycle row (honest degradation, nothing invented). */
export function getLifecycle(appSlug: string, latestVersion: string | null): Lifecycle | null {
  if (!latestVersion) return null;
  const product = (eolData as EolFile).products[appSlug];
  if (!product || !Array.isArray(product.cycles)) return null;

  const version = latestVersion.replace(/^v/i, '');
  // Prefer the most specific cycle (longest prefix) — e.g. version 2.7.5
  // matches cycle "2.7" over cycle "2".
  const match = [...product.cycles]
    .filter((c) => typeof c.cycle === 'string' && (version === c.cycle || version.startsWith(`${c.cycle}.`)))
    .sort((a, b) => b.cycle.length - a.cycle.length)[0];
  if (!match) return null;

  let status: Lifecycle['status'];
  let eolDate: string | null = null;
  if (match.eol === false) {
    status = 'supported';
  } else if (typeof match.eol === 'string') {
    eolDate = match.eol;
    status = new Date(match.eol).getTime() < Date.now() ? 'eol' : 'eol-scheduled';
  } else {
    // eol === true with no date: treat as EOL, date unknown.
    status = 'eol';
  }

  return { product: product.product, link: product.link, cycle: match.cycle, eol: match.eol, status, eolDate };
}
