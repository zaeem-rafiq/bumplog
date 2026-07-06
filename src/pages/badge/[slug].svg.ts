// GET /badge/{slug}.svg — embeddable verdict badge (built statically).
// Flat, square-cornered (matches the brand's de-rounded language), shields-
// style two-segment layout: "bumplog | <verdict>". Colors are fixed hex
// approximations of the site's oklch status-solid tokens so the badge renders
// identically in READMEs, dashboards, and RSS readers.

import type { APIRoute } from 'astro';
import apps from '../../data/apps.json';
import { toBadgeStatus, type App, type SafeToUpdate } from '../../data/types';
import { assessedApps } from '../../lib/api';
import { escapeXml } from '../../lib/feed';

const STATUS_COLOR: Record<SafeToUpdate, string> = {
  safe: '#2f9e68',
  caution: '#9a7420',
  breaking: '#c8432e',
  unknown: '#7a7873',
  unmaintained: '#4b5563',
};

const LABEL = 'bumplog';
const LABEL_BG = '#3f4143';
// Verdana@11px average glyph width; textLength pins the exact fit.
const CHAR_W = 6.3;
const PAD = 6;

export function getStaticPaths() {
  return assessedApps(apps as App[]).map((app) => ({
    params: { slug: app.slug },
    props: { app },
  }));
}

export const GET: APIRoute = ({ props }) => {
  const app = (props as { app: App }).app;
  const status = toBadgeStatus(app.safeToUpdate);
  const color = STATUS_COLOR[status];

  const leftW = Math.round(LABEL.length * CHAR_W) + PAD * 2;
  const rightW = Math.round(status.length * CHAR_W) + PAD * 2;
  const width = leftW + rightW;
  // app.name can originate from autonomous catalog growth (LLM-proposed) —
  // escape it like every other XML surface, or a name with & or " breaks the
  // badge's XML well-formedness in every embed.
  const aria = escapeXml(`bumplog: ${app.name} — ${status}`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${aria}">
  <title>${aria}</title>
  <g shape-rendering="crispEdges">
    <rect width="${leftW}" height="20" fill="${LABEL_BG}"/>
    <rect x="${leftW}" width="${rightW}" height="20" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${leftW / 2}" y="14" textLength="${leftW - PAD * 2}" lengthAdjust="spacingAndGlyphs">${LABEL}</text>
    <text x="${leftW + rightW / 2}" y="14" textLength="${rightW - PAD * 2}" lengthAdjust="spacingAndGlyphs">${status}</text>
  </g>
</svg>
`;
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' },
  });
};
