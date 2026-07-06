// harness/social/post-daily.mjs — daily entrypoint (called by run-daily.sh).
// Reads today's run record for `published_slugs`, projects them to toots via
// the Mastodon seam, and posts (auto) or queues (default) them. Always exits 0:
// social posting is a non-fatal enrichment and must never block the deploy.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSocial } from './mastodon.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

try {
  const runFile = join(REPO, 'harness', 'runs', `run-${date}.json`);
  const appsFile = join(REPO, 'src', 'data', 'apps.json');
  if (!existsSync(runFile)) {
    console.log(`[social] no run record for ${date} — nothing to post`);
    process.exit(0);
  }
  const run = JSON.parse(readFileSync(runFile, 'utf8'));
  const apps = JSON.parse(readFileSync(appsFile, 'utf8'));
  const result = await runSocial({ apps, publishedSlugs: run.published_slugs || [], date });
  console.log('[social]', JSON.stringify(result));
} catch (err) {
  console.log('[social] non-fatal error:', String(err && err.message ? err.message : err));
}
process.exit(0);
