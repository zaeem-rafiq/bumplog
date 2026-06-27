// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Bumplog is a pure static, pre-rendered, crawlable site.
// SEO is the whole point — `site` must be set so canonical URLs and the
// sitemap resolve to absolute https://bumplog.org/... URLs.
export default defineConfig({
  site: 'https://bumplog.org',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
});
