// GET /stacks/{slug}/feed.xml — per-stack safety feed (built statically).
// One subscription covers a whole curated stack: an item per member app's
// current (version, verdict), newest first.

import type { APIRoute } from 'astro';
import apps from '../../../data/apps.json';
import stacks from '../../../data/stacks.json';
import type { App, Stack } from '../../../data/types';
import { siteBase } from '../../../lib/api';
import { buildRss } from '../../../lib/feed';
import { appToFeedItem, byDateDesc } from '../../../lib/feed-items';

export function getStaticPaths() {
  const appBySlug = new Map((apps as App[]).map((app) => [app.slug, app]));
  return (stacks as Stack[]).map((stack) => {
    const stackApps = stack.appSlugs
      .map((slug) => appBySlug.get(slug))
      .filter((app): app is App => app !== undefined && app.safeToUpdate != null);
    return { params: { slug: stack.slug }, props: { stack, stackApps } };
  });
}

export const GET: APIRoute = ({ props, site }) => {
  const { stack, stackApps } = props as { stack: Stack; stackApps: App[] };
  const base = siteBase(site);
  const xml = buildRss({
    title: `Bumplog — ${stack.name} stack updates`,
    description: `Update-safety verdicts for the ${stack.name} self-hosted stack: ${stack.description}`,
    link: `${base}/stacks/${stack.slug}/`,
    selfUrl: `${base}/stacks/${stack.slug}/feed.xml`,
    items: stackApps.map((app) => appToFeedItem(app, base)).sort(byDateDesc),
  });
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
