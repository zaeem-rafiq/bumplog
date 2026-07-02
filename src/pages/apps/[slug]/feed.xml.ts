// GET /apps/{slug}/feed.xml — per-app safety feed (built statically).
// One item per published (version, verdict); readers get a new entry whenever
// the daily loop bumps the version or flips the verdict.

import type { APIRoute } from 'astro';
import apps from '../../../data/apps.json';
import type { App } from '../../../data/types';
import { assessedApps, siteBase } from '../../../lib/api';
import { buildRss } from '../../../lib/feed';
import { appToFeedItem } from '../../../lib/feed-items';

export function getStaticPaths() {
  return assessedApps(apps as App[]).map((app) => ({
    params: { slug: app.slug },
    props: { app },
  }));
}

export const GET: APIRoute = ({ props, site }) => {
  const app = (props as { app: App }).app;
  const base = siteBase(site);
  const xml = buildRss({
    title: `Bumplog — is it safe to update ${app.name}?`,
    description: `Update-safety verdicts for ${app.name} (${app.repo}), traceable to the GitHub release.`,
    link: `${base}/apps/${app.slug}/`,
    selfUrl: `${base}/apps/${app.slug}/feed.xml`,
    items: [appToFeedItem(app, base)],
  });
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
