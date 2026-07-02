# Bumplog — Competitive Benchmark Report

*Generated 2026-07-01 (Day 5 of the 30-day autonomous experiment). Repo analyzed: `~/Projects/bumplog` @ `46748ec`. All repo claims cite file paths; all competitor claims cite URLs fetched this session (18 pages, primary sources) or are marked UNVERIFIED.*

---

## Executive Summary

1. Bumplog owns a real, defensible differentiator: it is the **only product in the set that publishes an update-safety verdict with a human-readable, provenance-linked rationale**. Renovate's Merge Confidence is the sole analog — statistical, developer-scoped, locked inside PRs.
2. But the verdict is trapped: **no API, no badges, no feeds, no notifications** — while 6 of 9 benchmarked products expose an API and 6 push notifications. Bumplog produces the best signal in the category and has no way to deliver it to where self-hosters already look.
3. The moat is time-limited: changedetection.io shipped LLM change-summaries + plain-English AI rules in **June 2026** — AI summarization is being commoditized from adjacent categories.
4. Two openings: **Watchtower was archived 2025-12-17** (its users need an update-trust source), and selfh.st's 30k-reader weekly proves the digest ritual — but with news, not verdicts.
5. Top three moves: (R1) publish the verdict as a static JSON API + embeddable badge — verdict-as-a-service, nobody does it; (R2/R4) safety-annotated ntfy/RSS delivery; (R5) cumulative vX→vY upgrade-path verdicts — genuine white space, since self-hosters upgrade late and in jumps.
6. Hygiene debt that blocks the above: the feedback endpoint validates then silently drops data (`functions/api/feedback.ts:88-95`), no custom 404, no wrangler.toml/CI, and the harness fetches only the latest release (`harness/releases.mjs:128`; latest-tag fallback at `:146`) — never release lists.

---

## Product Model

**What it is.** Bumplog (bumplog.org) is a public, crawlable static site that answers "is it safe to update?" for popular self-hosted apps. For each app it shows the latest version, an LLM-summarized changelog, and a safety verdict — `safe | caution | breaking | unknown` (`src/data/types.ts:7`) — with a grounded rationale and a provenance link to the source GitHub release. All content is produced, published, and deployed daily by an autonomous, guardrailed LLM agent running a 30-day growth experiment.

**Target user & jobs-to-be-done.** Self-hosters and homelabbers (`PRODUCT.md:9`) who arrive "at the exact moment before an upgrade". Jobs: (1) a fast, sourced pre-upgrade safety check; (2) learn what changed without reading the full changelog; (3) a recurring maintenance ritual — "a self-hoster who bookmarks the page and rechecks before each upgrade cycle" (`PRODUCT.md:13`).

**Value loop & monetization.** launchd fires at 8 AM (`harness/run-daily.sh`) → governed 9-step loop (`harness/morning_loop.mjs`) → GitHub release ingestion with ETag caching (`harness/releases.mjs:128`) → one Sonnet call per app: `summarizeAndClassify` → atomic writes into `src/data/apps.json` / `src/data/journal.json` → build + wrangler deploy → PostHog measures the frozen contract: trailing-7-day median of returning-engaged visitors ≥ 3 by Day 30 (`harness/contract.lock.json`). **No monetization anywhere in the repo.**

**Feature inventory (by area, with evidence):**

| Area | Features | Evidence |
|---|---|---|
| Tracker | Severity-sorted homepage + summary strip; client-side status filter chips | `src/pages/index.astro:9-19`, `:52-69`, `:74-119` |
| Verdicts | Per-app pages: plain-language verdict, rationale, version, changelog summary, source-release link | `src/pages/apps/[slug].astro:28-34`, `:73-153` |
| Stacks | 3 curated bundles rendered as update dashboards | `src/data/stacks.json`, `src/pages/stacks/[slug].astro:55-106` |
| Journal | 5 daily entries (Days 1–5), escaped plain-text render | `src/data/journal.json`, `src/pages/journal/[date].astro:47` |
| Feedback | Form + CF Pages Function; validates, returns 202, **does not persist** | `src/pages/feedback.astro:22-46`, `functions/api/feedback.ts:88-95` |
| SEO | Canonical, OG/Twitter cards, sitemap, robots, TechArticle JSON-LD | `src/layouts/BaseLayout.astro:31-75`, `src/pages/apps/[slug].astro:40-54`, `astro.config.mjs:9-12` |
| Privacy/a11y | Consent-gated PostHog (opt-out default), auto dark mode, WCAG-minded badges (never color-only) | `src/layouts/BaseLayout.astro:81-99`, `src/components/ConsentBanner.astro:41-55`, `src/components/SafeToUpdateBadge.astro:13-39` |
| Engine | 9-step loop; grounded synthesis; governed catalog growth (cap 2/day, GitHub-validated) | `harness/morning_loop.mjs`, `harness/releases.mjs` |
| Governance | Frozen sha256 contract+guardrails; 9 protected actions; provenance gate; freshness-theater block; dark-pattern judge; pivot hysteresis; budget caps | `harness/guardrails.lock.json`, `harness/locks.manifest.json`, `harness/lib/guards.mjs`, `harness/lib/provenance.mjs`, `harness/judges/` |

**Maturity signals.** A 25-check dry-run invariant harness (`harness/dry_run.mjs`) is the only automated verification — no unit tests, no CI, no `.github/`, no `wrangler.toml` (verified by find/grep; the feedback KV binding can only be wired via the Cloudflare dashboard). Full JSON audit trail per run (`harness/runs/`), dated blockers, git-committed. Docs are unusually strong (`README.md`, `PRODUCT.md`, `DESIGN.md`, `harness/AGENT_BRIEF.md`, `harness/DISCOVERY.md`, `tasks/lessons.md`).

**Constraints.** Solo author — 29 commits in 6 days (2026-06-26 → 07-01), ~14.7k lines added: very fast LLM-assisted velocity. Stack lock-ins: Astro 5 + Cloudflare Pages direct-upload deploys; LLM engine locked to `claude -p` on a Max subscription (`ANTHROPIC_API_KEY` must be unset — `README.md:48-49`). Catalog: 28 apps, 12 assessed, 16 hidden backlog. Distribution: ~0 verified external visitors; the guardrails ban autonomous mass-posting (`harness/guardrails.lock.json`, `mass_post_external`), so discovery is human-only.

**Verified ABSENT (grep/find evidence in session):** RSS/Atom feed; any notification mechanism; public JSON/API or badge endpoint; catalog *text search* (status filter chips exist — matrix row 21 PARTIAL); custom 404; Docker/semver/calver logic anywhere in `harness/` or `src/`.

**Category benchmarked:** software release/update intelligence for self-hosted apps (release trackers & update notifiers; adjacent: dependency-update automation, lifecycle trackers, AI change monitoring).

---

## Benchmark Set

| Product | Slot | Positioning (from fetched pages) | Pricing | Notable last-12-months |
|---|---|---|---|---|
| [NewReleases.io](https://newreleases.io/) | Direct | Hosted "software releases notification system" for devs/DevOps | Free, donation-supported ([pricing](https://newreleases.io/pricing)) | None dateable from fetched pages |
| [selfh.st](https://selfh.st/) | Direct | "Self-hosted news, content, updates" — Friday newsletter, 30k+ readers | Free + paid membership/sponsors | Continuous weekly issues; apps-directory v1-1 build |
| [WUD](https://github.com/getwud/wud) | Direct | Self-hosted Docker-container update tracker: watchers→registries→triggers | Free, MIT | v8.2.2 (2026-02-26) |
| [Diun](https://crazymax.dev/diun/) | Direct | Notification-first Docker image update watcher | Free, MIT | v4.33.0 containerd provider (2026-05-30); v4.32.0 Prometheus metrics ([releases](https://github.com/crazy-max/diun/releases)) |
| [Anitya](https://anitya.readthedocs.io/en/stable/) | Direct | Fedora's cross-ecosystem upstream release monitor (message-bus output) | Free/open source (no pricing page) | 2.2.2 latest in docs (date unverified) |
| [Watchtower](https://github.com/containrrr/watchtower) | Direct | Automated Docker base-image updater | Free, Apache-2.0 | **Archived 2025-12-17** — unmaintained |
| [Renovate](https://docs.renovatebot.com/merge-confidence/) | Adjacent | Dependency-update automation; **Merge Confidence** = crowd-sourced update-safety badges + confidence-gated automerge | OSS core; hosted app; Merge Confidence free for OSS ([Mend blog](https://www.mend.io/blog/mend-renovate-cloud-oss-plan-github)) | Merge Confidence unlocked for OSS plan (2026) |
| [endoflife.date](https://endoflife.date/) | Adjacent | EOL/support-lifecycle data for ~460 products | Free, open source | v1 API w/ Swagger ([docs](https://endoflife.date/docs/api/v1/)); continuous catalog adds |
| [changedetection.io](https://changedetection.io/) | Adjacent | Generic website change monitoring "for clever people" | $8.99/mo hosted or free self-hosted (Apache-2.0) | **LLM summaries + plain-English AI rules (June 2026)** ([repo](https://github.com/dgtlmoon/changedetection.io)); 0.55.7 (2026-05-25) |

Why each earned its slot: NewReleases = same source (GitHub releases), full delivery surface Bumplog lacks; selfh.st = same audience, proven ritual; WUD/Diun = what this audience actually runs; Anitya = release-tracking-as-infrastructure reference; Watchtower = archived incumbent whose users are in play; Renovate = the only other safety signal in existence; endoflife.date = the version-lifecycle half of "should I update?"; changedetection.io = proof the AI moat is being commoditized.

---

## Feature Matrix

Legend: ✅ verified from a fetched page / repo file · ➖ partial or indirect · ✗ not evidenced (absence verified only on fetched pages) · ❓ UNVERIFIED. Bumplog column: **HAVE/PARTIAL/MISSING** with file evidence.

| # | Capability | Class | Bumplog | NewRel | selfh.st | WUD | Diun | Anitya | Watchtower | Renovate | endoflife | changedet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Release/update detection engine | TABLE-STAKES | **HAVE** `harness/releases.mjs:128` | ✅ | ➖ editorial | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ lifecycle | ➖ page diffs |
| 2 | GitHub-releases source | TABLE-STAKES | **HAVE** `harness/releases.mjs:128` | ✅ | ➖ stars meta | ✗ | ✗ | ✅ | ✗ | ✅ | ✗ | ➖ any page |
| 3 | Docker image/tag tracking | TABLE-STAKES | **MISSING** (grep: 0 hits) | ✅ | ✗ | ✅ | ✅ | ✗ | ✅ | ❓ | ✗ | ✗ |
| 4 | Changelog display (raw notes) | TABLE-STAKES | **HAVE** (summarized) `src/pages/apps/[slug].astro:123-153` | ✅ in notif. | ✗ | ❓ | ✗ | ✗ | ✗ | ✅ in PRs | ✗ | ✗ |
| 5 | LLM changelog summarization | EMERGING | **HAVE** `harness/releases.mjs` (summarizeAndClassify) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ (Jun 2026) |
| 6 | Update-safety verdict | DIFFERENTIATOR | **HAVE** `src/data/types.ts:7`, `src/pages/apps/[slug].astro:28-34` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ statistical | ✗ | ✗ |
| 7 | Grounded rationale + provenance link per verdict | DIFFERENTIATOR | **HAVE** `src/pages/apps/[slug].astro:93-100` (rationale), `:132-153` (source card), `harness/lib/provenance.mjs` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ➖ badges only | ✗ | ✗ |
| 8 | Push notifications (email/chat/webhook) | TABLE-STAKES | **MISSING** (grep: 0 hits) | ✅ 9+ ch. | ✅ email | ✅ | ✅ 17 ch. | ➖ msg bus | ✅ | ➖ via PRs | ✗ | ✅ 85+ ch. |
| 9 | RSS/Atom feed | TABLE-STAKES (content sites) | **MISSING** (grep: 0 hits) | ✗ | ✅ /rss/ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ | ✗ |
| 10 | Public API | TABLE-STAKES | **MISSING** (dist has zero JSON) | ✅ | ✗ | ✅ REST | ✗ | ✅ v1/v2 | ✅ HTTP mode | ❓ | ✅ v1 | ✅ |
| 11 | Badges / embeds | DIFFERENTIATOR | **MISSING** | ✅ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ in-PR | ❓ | ✗ |
| 12 | Accounts / personal watchlists | TABLE-STAKES (hosted) | **MISSING** (deliberate — `README.md`) | ✅ | ➖ membership | ✗ | ✗ | ➖ login, no list | ✗ | ➖ repo config | ✗ | ✅ |
| 13 | Zero-setup curated catalog (public, crawlable) | DIFFERENTIATOR | **HAVE** `src/data/apps.json` (28/12 assessed) | ✗ | ✅ directory | ✗ | ✗ | ➖ crowd-edited | ✗ | ✗ | ✅ 460 products | ✗ |
| 14 | Stack/bundle dashboards | DIFFERENTIATOR | **HAVE** `src/pages/stacks/[slug].astro:55-106` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 15 | Cumulative upgrade-path analysis (vX→vY) | WHITE SPACE | **MISSING** (latest-only: `harness/releases.mjs:128`, tag fallback `:146`) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 16 | Automated update application | out-of-category | **MISSING** (by design) | ✗ | ✗ | ✅ compose triggers | ✗ | ✗ | ✅ | ✅ automerge | ✗ | ✗ |
| 17 | Crowd-sourced adoption/confidence stats | DIFFERENTIATOR | **MISSING** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ | ✗ | ✗ |
| 18 | EOL/lifecycle data | DIFFERENTIATOR | **MISSING** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ | ✗ |
| 19 | Version-scheme intelligence (semver/calver) | TABLE-STAKES | **MISSING** (grep: 0 hits) | ➖ regex filters | ✗ | ✅ semver | ✗ | ✅ schemes | ✗ | ✅ | ➖ cycles | ✗ |
| 20 | Weekly/daily editorial digest | DIFFERENTIATOR | **PARTIAL** — journal is a build log, not an update digest (`src/data/journal.json`) | ➖ email digests | ✅ 30k readers | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 21 | Catalog search/facets | TABLE-STAKES (directories) | **PARTIAL** — status chips only (`src/pages/index.astro:74-119`) | ❓ | ✅ full facets | ✗ | ✗ | ✅ | ✗ | ✗ | ➖ | ✗ |
| 22 | Governed autonomous AI content pipeline | DIFFERENTIATOR | **HAVE** `harness/morning_loop.mjs`, `harness/guardrails.lock.json` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## Gap Analysis

### (a) Table-stakes we're missing
- **Push notifications** — 6/9 products deliver updates to the user; Bumplog requires a manual visit. The single biggest retention gap given the contract metric *is* returning visitors.
- **Public API** — 6/9 expose one (NewReleases, WUD, Anitya, Watchtower, endoflife.date, changedetection.io). `dist/` ships zero JSON.
- **RSS/Atom** — both content-shaped competitors (selfh.st, endoflife.date) have feeds; this audience lives in self-hosted RSS readers.
- **Docker-image awareness** — 4/9 track the artifact self-hosters actually pull; Bumplog only tracks GitHub releases.
- **A watchlist or no-account equivalent** — NewReleases/changedetection have accounts; Bumplog's stacks are fixed at 3 curated bundles (`src/data/stacks.json`).

*Note: some sub-capabilities named in (b) below (iCal export, dependency-file import, CLI, ecosystem integrations, bring-your-own-LLM) sit beneath aggregated matrix rows (5, 8, 10, 11, 18) rather than having rows of their own.*
- **Version-scheme intelligence** — Anitya/WUD/Renovate parse semver/calver; Bumplog's verdict never reasons about version distance deterministically.

### (b) Their differentiators we lack
- **Renovate Merge Confidence**: age/adoption/passing-test/confidence stats from millions of repos, and confidence-gated automation ([docs](https://docs.renovatebot.com/merge-confidence/)).
- **endoflife.date**: lifecycle/EOL data, iCal export, versioned public API.
- **changedetection.io**: user-defined plain-English AI rules and bring-your-own-LLM (June 2026).
- **NewReleases**: dependency-file import (bulk watchlist bootstrap) and free API/CLI/badges.
- **WUD/Diun**: homelab-native integrations — Home Assistant, Prometheus/Grafana, ntfy/Gotify/17 channels.

### (c) Our differentiators they lack — assets to defend
- **The verdict itself**: a grounded, plain-language safety call with rationale, unique in the set (`src/pages/apps/[slug].astro:28-34`). Renovate's analog has no rationale and lives inside developer PRs.
- **Code-enforced honesty**: provenance required to publish, freshness-theater blocked, journal numbers must equal telemetry (`harness/lib/provenance.mjs`, `harness/judges/freshness_theater.mjs`, `harness/lib/guards.mjs`). No competitor can claim "every datum traceable, enforced by code" — this is a publishable trust story, not just plumbing.
- **Zero-setup, crawlable *verdict* pages**: selfh.st's directory and endoflife.date's product pages are also crawlable with zero setup (matrix row 13), but neither carries per-release update-safety intelligence; every product that *does* assess updates (Renovate, WUD, Diun, Watchtower) requires setup/accounts/agents. Bumplog's answers are Google-indexable (TechArticle JSON-LD, `src/pages/apps/[slug].astro:40-54`) at the exact "is it safe to update X" query moment.
- **Stack dashboards**: the only grouped "my whole stack at a glance" update view in the set (`src/pages/stacks/[slug].astro`).
- **Near-zero marginal cost**: one autonomous daily loop produces all content — selfh.st's equivalent is a human editor.

### (d) White space — nothing in the set does it
- **Verdict-as-a-service**: a machine-readable safety verdict (JSON + badge) that READMEs, dashboards (Homarr/Dashy/Homepage), and other tools can embed. Nobody offers safety as an *openly* consumable signal — the one exception, Renovate's Merge Confidence badges (matrix rows 6, 11), is scoped to PRs inside a dev workflow.
- **Cumulative upgrade-path verdicts**: self-hosters upgrade late and in jumps; "what breaks between my v1.9 and latest v2.7" is unanswered by every product in the set.
- **compose-file → instant safety dashboard**: NewReleases imports dependency files for devs; nobody maps a `docker-compose.yml` to a stack-level safety view.
- **Public verdict accuracy ledger**: no product in the set publicly scores its own past calls. Renovate has adoption data; nobody has editorial accountability.
- **Safety-annotated delivery into existing homelab tools**: WUD/Diun tell you *that* an image changed; a Bumplog verdict riding an ntfy topic or webhook would tell you *whether to act*.

---

## Prioritized Recommendations

Scoring: Impact × Differentiation × Feasibility (1–5 each). Effort grounded in observed velocity (29 commits/6 days, solo, LLM-assisted): **S ≤ 1 day, M = 2–4 days, L = 1–2 weeks.** Note: the 30-day experiment's frozen guardrails constrain what the *agent* may build autonomously; these recommendations are for the operator (or post-experiment).

*Buckets encode sequencing (prerequisites + strategic weight), not raw effort — at this repo's velocity every S/M item fits inside two weeks. R10 sits in Quick Wins despite its low score because it is prerequisite hygiene for anything that touches feedback.*

### QUICK WINS (small, ship now)

**R1 — Static verdict API + embeddable SVG badges — I5×D5×F5 = 125**
- **What/why**: Matrix rows 10, 11 and white space (d). Emit `/api/v1/apps.json`, `/api/v1/apps/[slug].json`, and `/badge/[slug].svg` at build time from `src/data/apps.json`. 6/9 competitors have an API; none has a *safety* API. Badges in project READMEs and dashboard widgets create inbound links — directly attacking the ~0-visitor discovery bottleneck without violating the mass-posting guardrail (others embed; Bumplog doesn't post).
- **Beat-the-benchmark**: NewReleases' API returns "a release happened"; endoflife.date's returns dates. Bumplog's returns `safe|caution|breaking` + rationale + source URL — the only actionable one. Include `Cache-Control` headers and a versioned schema from day one.
- **Where it lands**: new static endpoints in `src/pages/api/` + `src/pages/badge/` (Astro static file endpoints), sourced from `src/data/apps.json`; document in README.
- **Effort**: S–M. **AI-powered**: no (serializes existing data).

**R4 — Safety-annotated RSS/Atom feeds — I5×D3×F5 = 75**
- **What/why**: Matrix row 9 — verified ABSENT while both content-site competitors ship feeds; the target user runs FreshRSS/Miniflux. Feeds are the no-account watchlist (gap a).
- **Beat-the-benchmark**: not just a journal feed — **per-app and per-stack feeds where each item carries the verdict and rationale inline** ("Immich v2.7.5 — ⚠ caution: …"). selfh.st's feed carries news; endoflife.date's carries new products; nobody feeds verdicts.
- **Where it lands**: build-time feed generation (hand-rolled XML or `@astrojs/rss`) in `src/pages/` from `src/data/apps.json` + `src/data/journal.json`; `<link rel=alternate>` in `src/layouts/BaseLayout.astro`.
- **Effort**: S. **AI-powered**: no.

**R8 — EOL/lifecycle context via endoflife.date API — I3×D3×F5 = 45**
- **What/why**: Matrix row 18. Their [v1 API](https://endoflife.date/docs/api/v1/) is free and open; a "support lifecycle" line on verdict pages answers the sibling question ("am I on a dying train?") and deepens the SEO page.
- **Beat-the-benchmark**: endoflife.date shows dates; Bumplog fuses lifecycle + safety into one verdict surface. Honest labeling: only for catalog apps they cover.
- **Where it lands**: fetch at harness time (not client) in `harness/releases.mjs` enrichment, new nullable fields in `src/data/types.ts` + render in `src/pages/apps/[slug].astro`.
- **Effort**: S–M. **AI-powered**: no (pure data join; keep the LLM out of it).

**R10 — Wire feedback persistence + abuse protection — I3×D1×F5 = 15 (catch-up, honestly labeled)**
- **What/why**: `functions/api/feedback.ts:88-95` acknowledges receipt and drops the record — the harness's listening loop currently hears nothing, violating the repo's own fail-visibly principle. Session grep confirmed zero rate-limiting/Turnstile/honeypot.
- **Parity, not differentiation**: add the KV binding (needs a `wrangler.toml`, which the repo lacks entirely), Turnstile or a honeypot, and per-IP rate limiting *before* the LLM-consumed store goes live — an unthrottled write path into an LLM's input is a prompt-injection funnel.
- **Where it lands**: `functions/api/feedback.ts`, new `wrangler.toml`, `harness/lib/feedback.mjs` consumption already exists.
- **Effort**: S. **AI-powered**: no.

### STRATEGIC BETS (this quarter)

**R2 — ntfy + webhook verdict notifications — I5×D4×F4 = 80**
- **What/why**: Matrix row 8 — the single most common capability Bumplog lacks (6/9). The contract metric is *returning* visitors; push is the returning-visitor machine.
- **Beat-the-benchmark**: skip accounts/email entirely. Publish to **public ntfy topics per app/stack** (ntfy is itself a beloved self-hosted app — meets the audience in their own tool) + a generic signed webhook on verdict change. Diun's 17 channels say "something changed"; Bumplog's one channel says "and here's whether to act". Fires from the daily loop only on verdict *transitions* — the freshness-theater guard (`harness/judges/freshness_theater.mjs`) already prevents noise, which is precisely what makes a Bumplog notification worth subscribing to.
- **Where it lands**: new publish step in `harness/morning_loop.mjs` (post-deploy), config in `harness/lib/env.mjs`, subscription instructions on `src/pages/apps/[slug].astro`.
- **Effort**: M. **AI-powered**: no (delivers existing verdicts deterministically).

**R3 — docker-compose paste → instant stack dashboard — I4×D5×F4 = 80**
- **What/why**: White space (d) + gap (a) watchlist. Paste a `docker-compose.yml`, get a personal safety dashboard — no account, state in the URL (compressed slugs) or localStorage.
- **Beat-the-benchmark**: NewReleases' dependency-file import requires an account and targets devs. This is client-side only (static-site compatible), instantly shareable ("here's my homelab's safety page"), and every unmatched image is a signal for governed catalog growth (`morning_loop.growCatalog` cap 2/day already exists).
- **Where it lands**: new `src/pages/stacks/custom.astro` + client-side image→slug matcher against `src/data/apps.json`; reuses `src/components/AppRow.astro`.
- **Effort**: M. **AI-powered**: no — image→app matching should be deterministic string mapping; do not LLM this.

**R5 — Cumulative upgrade-path verdicts (vX→vY) — I5×D5×F3 = 75**
- **What/why**: White space (d), matrix row 15. Self-hosters skip versions; the anxious question is "what breaks between *my* version and latest". Today the harness fetches only the latest release (`harness/releases.mjs:128`, latest-tag fallback `:146`; release *lists* are never fetched) — and no product in the set can answer this either.
- **Beat-the-benchmark**: this isn't parity with anyone — it's the category's unanswered question. Static-render the last N release-pair ranges per app; synthesize one cumulative verdict per range with every breaking change cited to its specific release.
- **Where it lands**: `harness/releases.mjs` (fetch release *lists*, extend ETag cache in `harness/cache/gh/`), new synthesis seam alongside `summarizeAndClassify`, range picker on `src/pages/apps/[slug].astro`, schema additions in `src/data/types.ts`.
- **Effort**: L. **AI-powered — must ship with binary evals**:
  1. Every breaking change cited resolves to a release actually inside the range (provenance pass/fail).
  2. Any range containing a release individually classified `breaking` never yields a cumulative `safe`.
  3. Single-step range verdict equals the already-published per-release verdict (parity check).
  4. Degenerate range (vX→vX) returns "no changes", zero LLM claims.
  5. Fabrication probe: a range whose releases have empty notes yields `unknown`, never invented specifics.

**R6 — Weekly Update-Safety Digest — I4×D4×F4 = 64**
- **What/why**: Matrix row 20 (PARTIAL — the journal is an experiment log, not a reader digest). selfh.st's 30k Friday readers prove the ritual; Bumplog's angle is *verdicts, not news*: "this week: 2 safe, 1 breaking — here's the one to be careful with."
- **Beat-the-benchmark**: selfh.st curates by hand weekly; Bumplog's digest compiles from already-grounded verdicts at zero marginal cost, with every line provenance-linked. Ship as page + RSS item (R4) first; email later only if wanted.
- **Where it lands**: new weekly step in `harness/morning_loop.mjs`, `src/pages/digest/[week].astro`, sourced from `src/data/apps.json` + `harness/state/published-entries.json`.
- **Effort**: M. **AI-powered — binary evals**:
  1. Every app mentioned has a verdict published within the digest's week (ledger check).
  2. Stated counts (N safe / M caution / K breaking) exactly equal the ledger's counts.
  3. Every link resolves to an existing page (build-time check).
  4. Brand-voice judge: zero marketing superlatives, per `PRODUCT.md` anti-references — pass/fail.

**R7 — Public verdict accuracy ledger — I4×D5×F3 = 60**
- **What/why**: White space (d). No product in the set publicly audits its own calls. Bumplog already has the raw material: an append-only publish ledger with content hashes (`harness/state/published-entries.json`) and a brand built on "sourced rather than asserted" (`PRODUCT.md:17`).
- **Beat-the-benchmark**: Renovate's confidence comes from adoption stats; Bumplog's would come from *accountability* — T+14 days after each verdict, re-check the app's issue tracker for upgrade-breakage reports; publish hits, misses, and corrections. Turns the governance moat (row 22) into a visitor-facing trust feature no one can quickly copy.
- **Where it lands**: new harness step + state file under `harness/state/`, re-using `harness/releases.mjs` GitHub client (issue search); `src/pages/accuracy.astro`.
- **Effort**: M. **AI-powered (classifying issue reports as upgrade-breakage) — binary evals**:
  1. Every correction cites ≥1 real issue/discussion URL returned by the GitHub API this run.
  2. Accuracy percentage equals the deterministic ledger ratio (code computes it, never the LLM).
  3. Ledger is append-only — original verdicts never silently edited (hash check vs `published-entries.json`).
  4. No claims about named individuals (existing `publish_person_claim` guardrail extended to this surface).

### WATCHLIST (monitor, don't build yet)

**R9 — Docker-tag awareness — I3×D2×F3 = 18.** 4/9 competitors track images (WUD/Diun/Watchtower/NewReleases); verdicts would attach to the artifact users actually pull. But it's catch-up in *their* strength zone, and GitHub releases remain the changelog source of truth. Revisit if R3 shows heavy unmatched-image demand. Lands in `harness/releases.mjs` + registry clients.

**R11 — Self-hostable/open-source Bumplog — I3×D4×F1 = 12.** The audience irony: a self-hosted-update site they can't self-host, while WUD/Diun/changedetection are all self-hostable. Strategically resonant, but the LLM engine is subscription-locked (`README.md:48-49`), the repo is private with unpushed history, and it would cannibalize the hosted SEO moat. Decide post-experiment.

*(Dropped from consideration as below-threshold: full catalog text search — valuable only past ~50 assessed apps; currently 12.)*

---

## Sources Appendix

**Repo** (all paths relative to `~/Projects/bumplog`, commit `46748ec`): `README.md`, `PRODUCT.md`, `DESIGN.md`, `package.json`, `astro.config.mjs`, `src/data/types.ts`, `src/data/apps.json`, `src/data/stacks.json`, `src/data/journal.json`, `src/pages/index.astro`, `src/pages/apps/[slug].astro`, `src/pages/stacks/*.astro`, `src/pages/journal/*.astro`, `src/pages/feedback.astro`, `src/components/*.astro`, `src/layouts/BaseLayout.astro`, `functions/api/feedback.ts`, `harness/morning_loop.mjs`, `harness/releases.mjs`, `harness/analytics.mjs`, `harness/dry_run.mjs`, `harness/contract.lock.json`, `harness/guardrails.lock.json`, `harness/lib/*`, `harness/judges/*`, `harness/state/*`, `harness/runs/run-2026-07-01.json`, `tasks/lessons.md`, git history (29 commits, 2026-06-26 → 2026-07-01).

**Web (18 pages fetched this session — each annotated with the claims it grounded):**
1. https://newreleases.io/ — provider matrix, notification channels, filtering, import, API/CLI/badges (rows 1–4, 8, 10–12)
2. https://newreleases.io/pricing — free tier, donation model
3. https://selfh.st/ — newsletter positioning, 30k readers, RSS feed, membership (rows 8, 9, 12, 20)
4. https://selfh.st/apps/ — apps-directory search/sort/facets, GitHub stars/forks metadata, local bookmarks (rows 2, 13, 21; gap (b))
5. https://github.com/getwud/wud — MIT license, v8.2.2 (2026-02-26), topics/semver, Grafana integration
6. https://raw.githubusercontent.com/getwud/wud/HEAD/docs/README.md — watcher/registry/trigger pipeline, registry coverage, Web UI, REST API, HA/Prometheus/Authelia integrations (rows 1, 3, 8, 10, 16, 19; gap (b))
7. https://crazymax.dev/diun/ — providers, 17 notification channels, MIT, self-hosted-only, no UI/API (rows 3, 8, 10)
8. https://github.com/crazy-max/diun/releases — v4.30.0–v4.33.0 launch dates
9. https://anitya.readthedocs.io/en/stable/ — positioning, release-notes span, API docs listing (rows 1, 10)
10. https://anitya.readthedocs.io/en/stable/user-guide.html — backend list (no Docker), version schemes, message-bus-only notifications, third-party login, distro mappings (rows 2, 3, 8, 12, 19, 21)
11. https://github.com/containrrr/watchtower — archived 2025-12-17, Apache-2.0, auto-update function
12. https://containrrr.dev/watchtower/ — docs nav: notifications, HTTP API mode, metrics, container selection, private registries (rows 8, 10, 16)
13. https://docs.renovatebot.com/merge-confidence/ — Merge Confidence badges, data basis, confidence-gated workflows (rows 6, 11, 17)
14. https://docs.renovatebot.com/key-concepts/changelogs/ — changelog surfacing in PRs, open-source positioning (row 4)
15. https://endoflife.date/ — 460 products, categories, RSS, iCal, recent additions (rows 9, 13, 18; gap (b))
16. https://endoflife.date/docs/api/v1/ — versioned v1 API with Swagger UI (row 10)
17. https://changedetection.io/ — $8.99/mo hosted plan, 5,000 watches, positioning (row 1)
18. https://github.com/dgtlmoon/changedetection.io — LLM summaries + plain-English AI rules (June 2026), Apache-2.0, 0.55.7, notification breadth via Apprise (rows 5, 8, 10; gap (b))

*Claims marked UNVERIFIED in the matrix/notes were not confirmable from these pages and should not be treated as facts. One secondary source used and labeled as such: Mend blog URL for the Renovate OSS-plan launch (surfaced via the merge-confidence docs research).*
