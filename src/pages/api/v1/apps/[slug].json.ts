// GET /api/v1/apps/{slug}.json — one app's verdict (built statically).
// Only assessed apps get an endpoint, mirroring the page gating.

import type { APIRoute } from 'astro';
import apps from '../../../../data/apps.json';
import type { App } from '../../../../data/types';
import { assessedApps, siteBase, toApiEntry } from '../../../../lib/api';

export function getStaticPaths() {
  return assessedApps(apps as App[]).map((app) => ({
    params: { slug: app.slug },
    props: { app },
  }));
}

export const GET: APIRoute = ({ props, site }) => {
  const app = (props as { app: App }).app;
  const body = {
    schema: 'bumplog.app.v1',
    generatedAt: new Date().toISOString(),
    ...toApiEntry(app, siteBase(site)),
  };
  return new Response(JSON.stringify(body, null, 1), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
