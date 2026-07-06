// Self-test for the Mastodon seam. Pure logic only — no network, no side effects.
// Run: node harness/social/mastodon.test.mjs
import assert from 'node:assert/strict';
import { formatVerdictPost, selectPostable, runSocial } from './mastodon.mjs';

const apps = [
  {
    slug: 'immich', name: 'Immich', latestVersion: 'v2.7.5', safeToUpdate: 'safe',
    rationale: 'v2.7.5 contains only a server-side bug fix and a translation update. The notes call out no breaking changes.',
  },
  {
    slug: 'paperless-ngx', name: 'Paperless-ngx', latestVersion: 'v2.20.15', safeToUpdate: 'breaking',
    rationale: 'This release requires a database migration and changes the default consumer path; back up before upgrading.',
  },
  { slug: 'draft-app', name: 'Draft', latestVersion: null, safeToUpdate: null, rationale: '' }, // unassessed
  {
    slug: 'overseerr', name: 'Overseerr', latestVersion: 'v1.35.0', safeToUpdate: 'unmaintained',
    rationale: 'The sct/overseerr repository is archived and read-only — no further fixes or security patches.',
    successor: 'Jellyseerr',
  },
];

// 1) format: contains verified route, verdict emoji, tags, and fits the limit.
const safe = formatVerdictPost(apps[0]);
assert.ok(safe.includes('https://bumplog.org/apps/immich/'), 'uses verified /apps/{slug}/ route');
assert.ok(safe.startsWith('🟢'), 'safe → green');
assert.ok(safe.includes('#selfhosted') && safe.includes('#immich'), 'has tags');
assert.ok(safe.length <= 500, 'within 500-char limit');
assert.ok(formatVerdictPost(apps[1]).startsWith('🔴'), 'breaking → red');

// 2) overflow: a giant rationale still yields a valid post with the link intact.
const huge = formatVerdictPost({ ...apps[0], rationale: 'x'.repeat(2000) });
assert.ok(huge.length <= 500 && huge.includes('/apps/immich/'), 'overflow drops reason, keeps link');

// 3) selection: unassessed filtered out, cap respected.
const picked = selectPostable(['immich', 'paperless-ngx', 'draft-app', 'nope'], apps, 5);
assert.equal(picked.length, 2, 'unassessed + unknown slug filtered');
assert.equal(selectPostable(['immich', 'paperless-ngx'], apps, 1).length, 1, 'cap respected');

// 4) inert without credentials — the whole point of the safe default.
const skipped = await runSocial({ apps, publishedSlugs: ['immich'], env: {}, date: '2026-07-05' });
assert.equal(skipped.skipped, true, 'no creds → inert, no posting');

// 5) with creds but nothing new (empty published set) → clean no-op, no network.
const noop = await runSocial({
  apps, publishedSlugs: [], date: '2026-07-05',
  env: { MASTODON_INSTANCE: 'https://example.test', MASTODON_TOKEN: 't' },
});
assert.equal(noop.posted.length, 0, 'no candidates → no posts');

// 6) unmaintained: formats with the ⚫ emoji, the "no longer maintained" phrase,
//    and appends the successor line — all within the 500-char limit.
const dead = formatVerdictPost(apps[3]);
assert.ok(dead.startsWith('⚫'), 'unmaintained → black circle');
assert.ok(dead.includes('no longer maintained'), 'unmaintained phrase present');
assert.ok(dead.includes('Successor: Jellyseerr'), 'appends the successor');
assert.ok(dead.includes('/apps/overseerr/'), 'keeps the verified route');
assert.ok(dead.length <= 500, 'unmaintained post within 500-char limit');
// overflow: a huge rationale still keeps the successor line and the link.
const deadHuge = formatVerdictPost({ ...apps[3], rationale: 'x'.repeat(2000) });
assert.ok(
  deadHuge.length <= 500 && deadHuge.includes('Successor: Jellyseerr') && deadHuge.includes('/apps/overseerr/'),
  'overflow drops reason but keeps successor + link',
);

console.log('mastodon.test.mjs: all', 6, 'checks passed');
console.log('\n--- sample toots ---\n');
console.log(safe, '\n');
console.log(formatVerdictPost(apps[1]), '\n');
console.log(dead);
