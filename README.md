# Bumplog

**The self-hosted update tracker.** For each app: the latest version, a *summarized*
changelog, and a breaking-change / "safe to update?" flag — across a curated self-hosted
stack. Public and crawlable. Source of truth: the GitHub API. The daily synthesis is the moat.

This repo holds two things:
1. **The site** — an Astro static site (`src/`, `public/`, `functions/`), pre-rendered and
   crawlable, with PostHog wired into the base layout.
2. **The harness** — the autonomous daily-loop scaffold (`harness/`) that an agent operates
   to grow returning, engaged visitors over a 30-day experiment. Contract + guardrails are
   frozen; the deterministic invariants are proven by a dry run.

> This repo is the **harness + skeleton**. It does not run the experiment, write tracker
> content, or grow traffic — a separate headless Claude process (the "agent") does that,
> inside what's here. See `harness/AGENT_BRIEF.md`.

## Public endpoints (beyond the pages)
```
/api/v1/apps.json         read-only verdict API (assessed apps only; CORS open)
/api/v1/apps/{slug}.json  one app's verdict + lifecycle context
/badge/{slug}.svg         embeddable verdict badge (flat, square, brand colors)
/feed.xml                 safety-annotated RSS (verdicts + journal)
/apps/{slug}/feed.xml     per-app verdict feed
/stacks/{slug}/feed.xml   per-stack verdict feed
```
All are built statically from `src/data/` — same provenance gates as the pages.

## Layout
```
src/                      Astro site (hub, per-app, stacks, journal, feedback) — empty scaffolding
src/lib/                  build-time helpers: api, feed, feed-items, eol
functions/api/feedback.ts Cloudflare Pages Function (feedback intake → FEEDBACK KV;
                          honeypot + 5/hr/IP rate limit + origin check; 503 if unbound)
wrangler.toml             Pages config: FEEDBACK KV binding (synced on deploy)
harness/
  analytics.mjs           READ-ONLY PostHog HogQL client (exact-to-contract metrics)
  releases.mjs            READ-ONLY GitHub pipeline (ETag cache, provenance, synthesis seams)
  morning_loop.mjs        the 9-step daily scaffold (TODO(agent) creative seams)
  eol.mjs                 refresh endoflife.date lifecycle data → src/data/eol.json
  pull-feedback.mjs       pull FEEDBACK KV records → feedback/inbox.jsonl (deduped)
  freeze_locks.mjs        one-shot writer for the frozen contract + guardrails
  dry_run.mjs             proof-of-success harness (13 checks)
  contract.lock.json      FROZEN success contract (written by freeze_locks)
  guardrails.lock.json    FROZEN constitution (written by freeze_locks)
  locks.manifest.json     sha256 of both locks (integrity witness)
  AGENT_BRIEF.md          the agent's day-one operating strategy
  DISCOVERY.md            stack decisions + open human decisions
  judges/                 dark-pattern + freshness-theater (LLM-as-judge)
  lib/                    env, locks, caps, provenance, freshness, journal, hysteresis,
                          guards, feedback, gate, store, llm
  feedback/inbox.jsonl    dev/dry-run feedback store (includes an injection probe)
  runs/  blockers/  state/  run records · dated halts · loop state (audit trail)
```

## Setup
```bash
cp .env.example .env          # fill in real values (NEVER commit .env)
set -a; source .env; set +a   # load secrets into the shell
npm install                   # site deps (Astro)
```
Required env (see `.env.example`): `POSTHOG_PROJECT_API_KEY`, `POSTHOG_PERSONAL_API_KEY`
(read scope), `POSTHOG_PROJECT_ID`, `POSTHOG_HOST`, `GITHUB_TOKEN` (read-only).
`ANTHROPIC_API_KEY` must be **unset** — the loop runs on the Max subscription and halts if
the key is present (it would silently bill pay-as-you-go).

## Freeze the contract (once)
```bash
node harness/freeze_locks.mjs --target 5   # target = human-confirmed returning-engaged median by Day 30
```
Writes both locks, records their sha256 in `locks.manifest.json`, and chmods them read-only.
Frozen means frozen — it refuses to overwrite.

## Prove the invariants
```bash
npm run build              # so the PostHog-config check can read built HTML
node harness/dry_run.mjs   # phase-aware: runs everything available, marks the rest pending
```

## Run a daily cycle
```bash
node harness/morning_loop.mjs            # live
node harness/morning_loop.mjs --dry-run  # control-flow only, no publish, no LLM
```

## Safety model (summary)
- **Locks** are read-only + sha256-verified every run; mismatch halts. The agent's write
  scope excludes the locks, the manifest, and `harness/lib`.
- **Provenance** is required to publish any datum; **freshness-theater** (cosmetic bumps) is
  blocked; **journal numbers** must equal telemetry.
- **Protected actions** (spend, DNS/auth/permissions, claims about named people, mass posting,
  irreversible deletes, fabrication) halt + write a dated blocker.
- **Rate limits / reprice** halt gracefully and resume next window — never retry-hammer, never
  roll into metered billing.

## Deploy
Connect to a free-tier host (Cloudflare Pages / Netlify), point `bumplog.org` at it, run the
initial deploy, and set DNS. Those are publish/DNS actions performed by a human, not the harness.
