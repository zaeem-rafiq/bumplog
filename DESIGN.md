# Design

## Theme

Calm, technical-editorial for a self-hosted update tracker. Register: product. Reference: Linear. The interface serves the verdict; chrome stays quiet. First-class light and dark, cool near-neutral surfaces (never warm paper), one restrained green accent, hairline structure. Authoritative typeface from GitHub's own families (the source of truth is the GitHub API).

## Color

OKLCH throughout. Surfaces are cool near-neutrals, faintly tinted toward the brand green (hue ~168), never warm. Full ramps live in `src/styles/global.css`.

- Light: bg `oklch(0.985 0.004 168)`, surface `oklch(1 0 0)`, border `oklch(0.912 0.006 168)`, text `oklch(0.255 0.013 168)`, muted `oklch(0.478 0.013 168)`.
- Dark: bg `oklch(0.17 0.006 168)`, surface `oklch(0.205 0.007 168)`, text `oklch(0.935 0.006 168)`.
- Accent (brand green): light `oklch(0.56 0.125 158)`, dark `oklch(0.66 0.14 158)`. Used for primary action, links, focus, and the safe status only. Restrained (well under 10% of surface).

Status is semantic and always paired with a label or glyph, never color alone: safe = green (158), caution = amber (76), breaking = red (25), pending = neutral. Each carries a soft bg, a readable fg, a solid accent, and an AA-safe icon color.

## Typography

- One family carries the product: Hubot Sans (variable, self-hosted) for display, UI, and body.
- Data (versions, dates, repo slugs): Monaspace Neon, with tabular numerals.
- Fixed rem scale (product, not fluid), ratio ~1.22: base 1rem, h1 2.375rem, h2 1.375rem, h3 1.125rem.
- Headings: weight 600, letter-spacing -0.021em, `text-wrap: balance`. Body: line-height 1.6, `text-wrap: pretty`, prose capped near 64ch.

## Components

- App list: hairline-divided rows inside one bordered container (not a card grid). Sorted assessed-first by severity, pending last. Each row: name + repo (mono) on the left, version (mono) + status badge on the right.
- Verdict (app-page hero): a solid status glyph plus a plain-text answer that is itself the accessible status label, then the grounded rationale, then a meta row (latest version, last checked). No side rail, no eyebrow, no tinted band.
- Status badge: tinted chip, small radius, glyph plus text label. Consistent everywhere it appears.
- Cards: flat with a 1px hairline border; shadow only where elevation is real.
- Breadcrumb and all data render in Monaspace; summary counts use tabular numerals.

## Layout & Motion

- Content column 48rem; wide surfaces (stack dashboards) 66rem. Generous vertical rhythm.
- Motion 150–250ms, state-only (hover, focus), ease-out. `prefers-reduced-motion` honored globally.

## Bans (from impeccable, enforced)

No side-stripe rails, no uppercase tracked eyebrows, no warm cream or beige body background, no overused fonts (Inter, Geist, Mona Sans, Plus Jakarta, Space Grotesk, etc.), at most two em-dashes per page. `impeccable detect` runs clean.
