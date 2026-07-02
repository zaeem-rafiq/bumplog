// GET /api/v1/apps.json — the public read-only verdict API (built statically).
// Contract: schema "bumplog.apps.v1"; only assessed apps; every entry carries
// its provenance sourceUrl. Consumers: dashboards, scripts, badges.

import type { APIRoute } from 'astro';
import apps from '../../../data/apps.json';
import type { App } from '../../../data/types';
import { assessedApps, siteBase, toApiEntry } from '../../../lib/api';

export const GET: APIRoute = ({ site }) => {
  const base = siteBase(site);
  const entries = assessedApps(apps as App[]).map((app) => toApiEntry(app, base));
  const body = {
    schema: 'bumplog.apps.v1',
    generatedAt: new Date().toISOString(),
    docs: `${base}/api/v1/apps.json is a build-time snapshot; per-app: /api/v1/apps/{slug}.json; badge: /badge/{slug}.svg`,
    count: entries.length,
    apps: entries,
  };
  return new Response(JSON.stringify(body, null, 1), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
