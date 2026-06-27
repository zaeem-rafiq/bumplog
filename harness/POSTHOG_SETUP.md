# PostHog project setup (do this in the PostHog UI)

The harness reads metrics to the frozen contract's exact definitions, but it **does not**
define what counts as a real human — that lives in PostHog so the agent can't edit it.
Configure these six things in your project (id `486957`, US Cloud). Menu paths are current
as of mid-2026; if a label moved, search Settings for the quoted term.

> Project settings live at **https://us.posthog.com/project/486957/settings**.

### 1. Cookie-based persistence — ON (precision the Day 20–30 gate needs)
- This is set client-side in the snippet (`persistence: 'localStorage+cookie'`) — already done.
- In **Settings → Project → "Cookieless server hash mode"**: make sure it is **OFF**. Cookieless
  mode would fragment returning-visitor identity and break the lagging metric.

### 2. Autocapture — ON (the engaged signal)
- **Settings → Project → "Autocapture"** (a.k.a. "Web autocapture"): toggle **ON**.
- The snippet also sets `autocapture: true`; the project toggle must not override it off.

### 3. `$pageview` + `$pageleave` — captured (session duration + engaged)
- Captured by the snippet (`capture_pageview: true`, `capture_pageleave: true`) — already done.
- Nothing to toggle; just don't disable pageview/pageleave capture. `$pageleave` is what gives
  session duration, which the >45s engaged rule depends on.

### 4. Discard bot/spider traffic — ON
- **Settings → Project → "Bot and spam protection"** → enable **"Discard client-side bot traffic"**.
- PostHog also filters known bots in queries by default; this drops them at ingestion too.

### 5. Internal / test-account exclusion — ADD YOUR IP (critical)
- **Settings → Project → "Filter out internal and test users"** → add filter(s):
  - `IP address = <your home/office IP>` (and any CI/runner IP).
  - Optionally `Email does not contain @yourdomain` style rules if you ever identify users.
- **Why it matters:** the harness queries pass `filterTestAccounts: true`, which expands to
  *these* filters. If you define none, nothing is excluded — including your own testing (e.g. the
  one pre-launch pageview the build verification generated). Add your IP so your traffic never
  counts toward returning-engaged.

### 6. Project domain = bumplog.org
- **Settings → Project → "Authorized domains / URLs"** (toolbar + web analytics): add
  `https://bumplog.org`. Aligns host config and any domain filters with the live site.

---

When all six are set, the metric becomes trustworthy as soon as real visitor data flows
post-deploy. The harness read path is already verified; only live-visitor data is pending the
deploy. Nothing here is editable by the daily agent — that's by design.
