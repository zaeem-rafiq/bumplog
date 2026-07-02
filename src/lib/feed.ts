// RSS 2.0 feed builder — hand-rolled on purpose (no new dependencies).
// Every value is escaped; feeds are generated at build time from src/data only,
// so a feed can never carry anything the site itself doesn't publish.

export interface FeedItem {
  title: string;
  /** Absolute URL the item links to. */
  link: string;
  /** Plain-text description (escaped here; never HTML). */
  description: string;
  /** ISO date (YYYY-MM-DD or full ISO 8601). */
  date: string;
  /** Stable unique id. Non-permalink guids let readers detect verdict changes. */
  guid: string;
  /** Whether guid is a resolvable URL. */
  guidIsPermaLink: boolean;
}

export interface FeedOptions {
  title: string;
  description: string;
  /** Absolute URL of the page this feed describes. */
  link: string;
  /** Absolute URL of the feed itself (atom:link rel=self). */
  selfUrl: string;
  items: FeedItem[];
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRfc822(isoDate: string): string {
  const parsed = new Date(isoDate);
  // A malformed date must not produce "Invalid Date" in the feed — fall back
  // to the epoch so the item still validates and the bug stays visible.
  return Number.isNaN(parsed.getTime()) ? new Date(0).toUTCString() : parsed.toUTCString();
}

export function buildRss({ title, description, link, selfUrl, items }: FeedOptions): string {
  const itemsXml = items
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="${item.guidIsPermaLink}">${escapeXml(item.guid)}</guid>
      <pubDate>${toRfc822(item.date)}</pubDate>
      <description>${escapeXml(item.description)}</description>
    </item>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <description>${escapeXml(description)}</description>
    <language>en</language>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />
${itemsXml}
  </channel>
</rss>
`;
}
