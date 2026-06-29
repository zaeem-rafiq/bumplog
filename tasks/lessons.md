# Lessons

## 2026-06-27 — UI: verify rendered visibility, not just the property
**Module:** `src/components/ConsentBanner.astro`
**What went wrong:** The consent banner used the `[hidden]` attribute to show/hide,
but `.consent { display: flex }` (an author rule) overrode the UA `[hidden] { display: none }`
rule. So `hide()` set `banner.hidden = true` with **no visual effect** — on production the
buttons recorded the choice and opted in/out, but the banner never disappeared, so it read as
"the buttons do nothing." My Playwright check passed because it asserted `banner.hidden`
(the property) flipped — it never asserted the element actually rendered hidden.
**What to do instead:** When verifying any show/hide UI, assert the **computed style**
(`getComputedStyle(el).display === 'none'`) or true rendered visibility — not just the
`.hidden`/`.style` property. A `display` rule with class specificity will beat the `[hidden]`
attribute; pair `[hidden]` toggling with a `.x[hidden] { display: none }` rule (higher
specificity than the base `.x { display: ... }`).

## 2026-06-27 — Prove the real query end-to-end, not just a probe; trust agent output through gates only after re-derivation
**Module:** `harness/analytics.mjs`, `harness/morning_loop.mjs` (+ adversarial review)
**What went wrong:** The dry run proved 14 invariants but never executed the *full* metric
HogQL against live PostHog (only a simpler schema probe), so two real defects shipped: (a) the
metric query used both `{filters}` and a `values` dict, which PostHog rejects with "Global
variable not found: filters" — `{filters}` must be the sole placeholder, so harness-controlled
constants get interpolated directly (validated, not user input); (b) the loop fed the agent's
*self-supplied* `contentHash`/provenance straight into the freshness + provenance gates, so an
agent could fabricate "freshness." Also found: channel-cap denominator summed overlapping
per-source distinct counts (cap under-fired); engaged-day attributed per-pageview (midnight
sessions counted as returns); journal reconciliation ignored omitted metrics.
**What to do instead:** (1) Add a proof that runs the actual production query/path end-to-end
against the real backend, not a stand-in. (2) Never let agent-supplied values flow through an
integrity gate — re-derive the authoritative value (here, contentHash from the live GitHub
source) in the harness first, then gate. (3) For "must be present" contracts, require the
canonical key set explicitly; iterating only present keys lets omission bypass the check.

## 2026-06-27 — "Designer-grade" needs art direction, not a design system
**Module:** `src/styles/global.css`, hero page templates (Bumplog UI)
**What went wrong:** A competent first pass built a coherent design *system* (tokens, spacing,
semantic status colors, a11y) but the user called it "vibecoded, generic, boring." The tells:
system-ui fonts, soft-filled status pills, shadowed rounded cards, even spacing with no point of
view. A tidy token system is necessary but not sufficient — it reads as default-AI without a
distinctive direction.
**What to do instead:** For an Apple/Vercel/Linear bar, lead with ART DIRECTION: (1) a real
typeface is ~80% of the feel — self-host a distinctive one (Geist/Inter Tight + a mono), never
ship `system-ui` and call it premium; (2) restraint + precision over decoration — hairline
borders instead of shadows, near-monochrome with status as a small exact accent (dot/rail/label),
generous rhythm, mono for technical data; (3) one confident idea executed perfectly (here, the
verdict as the hero). Don't delegate the *taste* call to an unsupervised autonomous agent — its
output trends generic; set the direction, then build. Note: the inline-widget (visualize/CDS)
sandbox enforces the chat aesthetic (system font, two weights, no display type), so it's the
wrong vehicle to preview a premium site direction — build it real and screenshot.

## 2026-06-28 — A scheduled job must be verified AS a scheduled job (launchd + ~/Documents TCC)
**Module:** `harness/run-daily.sh`, `harness/launchd/org.bumplog.daily.plist`
**What went wrong:** The Day-2 8 AM `org.bumplog.daily` launchd run died instantly —
`/bin/zsh: can't open input file: …/harness/run-daily.sh`, exit 127 — and produced no content,
no deploy, no run record. The repo lives in `~/Documents`, a TCC-protected folder. A `launchd`
user agent does NOT inherit Terminal's Full Disk Access, so reads inside `~/Documents` return
`Operation not permitted` (EPERM) even with correct POSIX perms. Confirmed with an isolated probe
launchd agent: reads in `~/Documents` → EPERM, reads in `~/Library` → OK, same gui/501 domain.
The schedule had been "validated" by a *manual* run at arm-time — which executes in an
FDA-having shell and bypasses the exact path that fails under launchd. The checklist caught
"Mac must be awake at 8 AM" but missed the TCC boundary.
**What to do instead:** When arming any `launchd`/cron job that touches `~/Documents`/`~/Desktop`/
`~/Downloads`: keep the working set out of those folders OR grant FDA to the responsible binary,
and verify by triggering it AS the scheduled job (`launchctl kickstart -k gui/$(id -u)/<label>`,
or an isolated probe agent that reads the target paths) — never by a hand-run that has FDA. Treat
"ran it manually, works" as proof of nothing for the scheduled execution path.
