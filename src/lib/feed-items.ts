// Feed-item mappers: turn published site data (apps, journal) into RSS items.
// The safety verdict rides inside every app item — that annotation is the
// entire point of a Bumplog feed versus a plain release feed.

import type { App, JournalEntry, SafeToUpdate } from '../data/types';
import { toBadgeStatus } from '../data/types';
import type { FeedItem } from './feed';

// Same plain-language answers the verdict pages use.
const VERDICT_LABEL: Record<SafeToUpdate, string> = {
  safe: 'Safe to update',
  caution: 'Update with care',
  breaking: 'Holds breaking changes',
  unknown: 'Not assessed yet',
};

/** One item per (app, version, verdict). The guid changes whenever the daily
 *  loop publishes a new version or flips a verdict, so RSS readers surface it
 *  as a new entry — no history store needed. */
export function appToFeedItem(app: App, base: string): FeedItem {
  const status = toBadgeStatus(app.safeToUpdate);
  const label = VERDICT_LABEL[status];
  const version = app.latestVersion ?? 'version pending';
  const parts = [
    `${label}.`,
    app.rationale ?? '',
    app.changelogSummary ? `What changed: ${app.changelogSummary}` : '',
    app.sourceUrl ? `Source release: ${app.sourceUrl}` : '',
  ].filter(Boolean);
  return {
    title: `${app.name} ${version} — ${label}`,
    link: `${base}/apps/${app.slug}/`,
    description: parts.join(' '),
    date: app.lastChecked ?? '1970-01-01',
    guid: `bumplog:app:${app.slug}:${version}:${status}`,
    guidIsPermaLink: false,
  };
}

export function journalToFeedItem(entry: JournalEntry, base: string): FeedItem {
  const link = `${base}/journal/${entry.date}/`;
  return {
    title: entry.title,
    link,
    description: entry.body.slice(0, 400) + (entry.body.length > 400 ? '…' : ''),
    date: entry.date,
    guid: link,
    guidIsPermaLink: true,
  };
}

/** Newest first; date ties broken by title for a stable build. */
export function byDateDesc(a: FeedItem, b: FeedItem): number {
  const d = new Date(b.date).getTime() - new Date(a.date).getTime();
  return d !== 0 ? d : a.title.localeCompare(b.title);
}
