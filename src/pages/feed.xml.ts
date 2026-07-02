// GET /feed.xml — the site-wide safety-annotated feed (built statically).
// Items: every assessed app's current verdict (new item on version/verdict
// change via the guid) + the daily journal. Newest first, capped at 50.

import type { APIRoute } from 'astro';
import apps from '../data/apps.json';
import journal from '../data/journal.json';
import type { App, JournalEntry } from '../data/types';
import { assessedApps, siteBase } from '../lib/api';
import { buildRss } from '../lib/feed';
import { appToFeedItem, byDateDesc, journalToFeedItem } from '../lib/feed-items';

const MAX_ITEMS = 50;

export const GET: APIRoute = ({ site }) => {
  const base = siteBase(site);
  const items = [
    ...assessedApps(apps as App[]).map((app) => appToFeedItem(app, base)),
    ...(journal as JournalEntry[]).map((entry) => journalToFeedItem(entry, base)),
  ]
    .sort(byDateDesc)
    .slice(0, MAX_ITEMS);

  const xml = buildRss({
    title: 'Bumplog — is it safe to update?',
    description:
      'Update-safety verdicts for self-hosted apps: summarized changelogs and breaking-change flags, every claim traceable to its GitHub release.',
    link: `${base}/`,
    selfUrl: `${base}/feed.xml`,
    items,
  });
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
