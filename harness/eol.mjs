// harness/eol.mjs — refresh support-lifecycle data from endoflife.date into
// src/data/eol.json (read at build time by src/lib/eol.ts).
//
// READ-ONLY against the network; the only write is src/data/eol.json. Coverage
// is whatever endoflife.date actually tracks: each app's slug (or its alias
// below) is probed and only HTTP-200 responses with a valid cycle shape are
// kept — nothing is invented for uncovered apps. A transient per-product
// failure (timeout/5xx) carries the previously-verified entry forward instead
// of dropping it — partial failure must never erase good data. Only a genuine
// 404 (endoflife.date stopped tracking it) drops a product. On total network
// failure the existing file is left untouched and the exit code is non-zero.
//
//   node harness/eol.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = join(dirname(HARNESS_DIR), 'src', 'data', 'apps.json');
const EOL_FILE = join(dirname(HARNESS_DIR), 'src', 'data', 'eol.json');
const API_BASE = 'https://endoflife.date/api';
const MAX_CYCLES = 10;
const TIMEOUT_MS = 10_000;

// App slug → endoflife.date product slug, where they differ.
const ALIASES = {
  'pi-hole': 'pihole',
};

async function fetchProduct(product) {
  const res = await fetch(`${API_BASE}/${product}.json`, {
    headers: { 'User-Agent': 'bumplog.org lifecycle refresh (harness/eol.mjs)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return { found: false };
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${product}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`unexpected shape for ${product}: not an array`);
  const cycles = data
    .filter((c) => c && typeof c.cycle === 'string' && (typeof c.eol === 'boolean' || typeof c.eol === 'string'))
    .slice(0, MAX_CYCLES)
    .map((c) => ({
      cycle: c.cycle,
      eol: c.eol,
      ...(typeof c.latest === 'string' ? { latest: c.latest } : {}),
    }));
  if (cycles.length === 0) return { found: false };
  return { found: true, cycles };
}

async function main() {
  const apps = JSON.parse(readFileSync(APPS_FILE, 'utf8'));

  // Previous data: a transient failure below falls back to this so a flaky
  // lookup can never erase a previously-verified product.
  let previous = {};
  try {
    previous = JSON.parse(readFileSync(EOL_FILE, 'utf8')).products ?? {};
  } catch {
    // First run or malformed file — nothing to carry forward.
  }

  const products = {};
  let errors = 0;
  let carried = 0;

  for (const app of apps) {
    const product = ALIASES[app.slug] ?? app.slug;
    try {
      const result = await fetchProduct(product);
      if (result.found) {
        products[app.slug] = {
          product,
          link: `https://endoflife.date/${product}`,
          cycles: result.cycles,
        };
        console.log(`eol: ${app.slug} → ${product} (${result.cycles.length} cycles)`);
      } else {
        console.log(`eol: ${app.slug} — not tracked by endoflife.date`);
      }
    } catch (err) {
      errors += 1;
      if (previous[app.slug]) {
        products[app.slug] = previous[app.slug];
        carried += 1;
        console.error(`eol: ${app.slug} FAILED (${err.message}) — carrying forward previous data`);
      } else {
        console.error(`eol: ${app.slug} FAILED: ${err.message}`);
      }
    }
  }

  if (Object.keys(products).length === 0 && errors > 0) {
    console.error(`eol: all ${errors} lookups failed — keeping the existing ${EOL_FILE}`);
    process.exit(1);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'https://endoflife.date',
    products,
  };
  writeFileSync(EOL_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`eol: wrote ${Object.keys(products).length} products to ${EOL_FILE}${errors ? ` (${errors} lookups failed, ${carried} carried forward stale)` : ''}`);
}

main().catch((err) => {
  console.error('eol refresh crashed:', err);
  process.exit(1);
});
