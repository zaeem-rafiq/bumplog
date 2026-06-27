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
