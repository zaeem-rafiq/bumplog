// Shared serialization for the public read-only JSON API (/api/v1/*).
// Same gating as the site: only assessed apps are exposed — the seeded-but-
// unbuilt backlog must not leak through the API either.

import type { App } from '../data/types';
import { getLifecycle, type Lifecycle } from './eol';

export interface ApiAppEntry {
  slug: string;
  name: string;
  repo: string;
  latestVersion: string | null;
  safeToUpdate: string;
  rationale: string | null;
  changelogSummary: string | null;
  /** Provenance: the GitHub release this verdict traces to. */
  sourceUrl: string | null;
  lastChecked: string | null;
  /** Maintained alternative when unmaintained (name or "owner/repo"); null otherwise. */
  successor: string | null;
  /** The human-readable verdict page. */
  url: string;
  /** Embeddable SVG badge for this app's verdict. */
  badge: string;
  /** Support-lifecycle context (endoflife.date), when verified. */
  lifecycle: Lifecycle | null;
}

export function assessedApps(apps: App[]): App[] {
  return apps.filter((app) => app.safeToUpdate != null);
}

export function toApiEntry(app: App, base: string): ApiAppEntry {
  return {
    slug: app.slug,
    name: app.name,
    repo: app.repo,
    latestVersion: app.latestVersion,
    safeToUpdate: app.safeToUpdate ?? 'unknown',
    rationale: app.rationale,
    changelogSummary: app.changelogSummary,
    sourceUrl: app.sourceUrl,
    lastChecked: app.lastChecked,
    successor: app.successor ?? null,
    url: `${base}/apps/${app.slug}/`,
    badge: `${base}/badge/${app.slug}.svg`,
    lifecycle: getLifecycle(app.slug, app.latestVersion),
  };
}

/** Resolve the absolute site base ("https://bumplog.org") from Astro's `site`. */
export function siteBase(site: URL | undefined): string {
  return (site?.href ?? 'https://bumplog.org/').replace(/\/$/, '');
}
