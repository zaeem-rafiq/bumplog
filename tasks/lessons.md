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
