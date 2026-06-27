# Bumplog — Discovery

Greenfield. The repo `zaeem-rafiq/bumplog` (private) was created empty and scaffolded
from scratch this session. Nothing pre-existing to adapt.

## Environment (verified this session)
- `gh` authenticated as `zaeem-rafiq` (scopes: repo, workflow, gist, read:org) — used
  once to create the repo. The release pipeline uses the separate read-only
  `GITHUB_TOKEN` in `.env`, never the CLI token.
- `ANTHROPIC_API_KEY` confirmed **unset** (`printenv` empty) — subscription path intact.
  The loop re-asserts this every run and halts if it appears (reprice tripwire).
- Node v22.22.3, npm 10.9.8 — harness uses built-in `fetch` + ESM (`.mjs`), zero HTTP deps.
- `claude` CLI 2.1.178 present — the loop's LLM seam shells out to `claude -p` on the
  subscription path. Note: this CLI version exposes `--model`, `--output-format`,
  `--system-prompt`, `--append-system-prompt`, `--max-budget-usd`, but **no `--max-turns`**
  flag — so the turn/wall-clock caps are enforced in-harness (`lib/caps.mjs`), which is
  cleaner anyway.

## Stack decisions
- **Site:** Astro 5 (`output: 'static'`, pure SSG — crawlable, pre-rendered), `@astrojs/sitemap`.
  Plain `.astro` + one global CSS file; no UI framework. Brand: Bumplog.
- **Harness:** Node ESM (`.mjs`), no transpile step, no extra runtime deps. Runs directly
  via `node harness/...`. Rationale: the daily loop must run headless and dependency-light;
  built-in `fetch` covers both API clients.
- **PostHog snippet:** in the base layout, so every page the agent later creates inherits
  it. Initialized from `PUBLIC_POSTHOG_KEY` / `PUBLIC_POSTHOG_HOST` with `autocapture`,
  `capture_pageview`, `capture_pageleave`, `persistence: 'localStorage+cookie'`. Verified
  present in built HTML when the key is set; absent (no crash) when unset.
- **Feedback intake:** static form → `POST /api/feedback`. A Cloudflare Pages Function stub
  (`functions/api/feedback.ts`) documents the storage contract; the loop reads feedback as
  untrusted JSONL. The production persistence backend is a deploy-time seam (see below).

## What was built
- Site skeleton (hub, per-app template, stack-dashboard template, journal index + dated
  template, feedback page) — empty scaffolding, agent fills content.
- `harness/analytics.mjs` — read-only PostHog HogQL client, exact-to-contract metrics.
- `harness/releases.mjs` — read-only GitHub pipeline, ETag cache, provenance-bearing records.
- `harness/lib/*` — locks, env, caps, provenance, freshness, journal, hysteresis, guards,
  feedback, gate, store, llm.
- `harness/judges/*` — dark-pattern + freshness-theater (deterministic gate + LLM layer).
- `harness/morning_loop.mjs` — 9-step daily scaffold with marked TODO(agent) seams.
- `harness/freeze_locks.mjs` — one-shot lock writer (run after target confirmed).
- `harness/dry_run.mjs` — proof harness (13 checks, phase-aware).
- `harness/AGENT_BRIEF.md` — day-one operating strategy for the agent.

## Open decisions for the human (do NOT auto-decide)
1. **Cookie-consent / EU traffic (legal/product).** Cookie-based persistence is required for
   the returning-visitor metric. That means a cookie-consent mechanism is a legal/product
   decision for EU visitors. A consent banner was neither added nor skipped — your call.
   Note: a consent gate will undercount returning visitors among EU traffic that declines;
   factor that into the target.
2. **Primary-metric target.** `target.returning_engaged_median by Day 30` — the spec's
   default is **≥ 5**. This is the single value that must be set before the sha256 freeze.
   Confirm the number (accounting for any consent/persistence undercount) → then
   `node harness/freeze_locks.mjs --target N`.
3. **PostHog project config** (must be set IN PostHog, not in agent-editable code, before
   live data is trustworthy): cookie-based persistence ON, autocapture ON, $pageview +
   $pageleave captured, "Discard bot/spider traffic" ON, and internal-IP / test-account
   exclusion (your IPs + CI). The project domain should be set to `bumplog.org` so host
   config and any domain filters line up. The client uses `filterTestAccounts: true`, which
   expands to *your* PostHog test-account filters — it never defines what counts as internal.
4. **Astro audit advisory.** The site agent pinned Astro 5.18.2 (per the "Astro 5" spec).
   `npm audit` reports a high-severity batch resolvable only by `astro@7.x` (a breaking
   major bump). The flagged `define:vars` XSS is **not exploitable here** — the only values
   passed through it are build-time PostHog env vars, not user input. Decision: stay on 5.x
   (spec-compliant, not exploitable) or take the breaking upgrade. Left on 5.x.
5. **Deploy host.** Cloudflare Pages or Netlify (free tier). This determines the production
   feedback-storage backend wiring (the `functions/api/feedback.ts` seam). You run the
   initial deploy and DNS — those are publish/DNS actions the harness must not take.
