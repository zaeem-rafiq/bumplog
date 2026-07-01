# Community share — draft (for YOU to post)

The AGENT_BRIEF allows **exactly one** community share for discovery, timed for
Week 2. This is a draft for **you** to publish — an autonomous agent must not
mass-post (a protected action), and one genuine, well-received share beats several
that read as spam. Post it yourself, from your own account, and engage with replies.

**Ground rules that decide whether this lands or gets removed**
- r/selfhosted requires a clear "I built this" disclosure and dislikes pure promo.
  Lead with the problem, not the product. Read the sub's self-promotion rule first.
- Post when you can sit with it for a few hours to reply — engagement in the first
  hour drives reach.
- One share. Do not cross-post the same day to multiple large subs.

---

## Option A — r/selfhosted (recommended)

**Title:** I got tired of not knowing whether a self-hosted update was safe, so I built a tracker that reads the GitHub release notes for you

**Body:**

Every time Immich or Home Assistant shipped a release I'd do the same dance —
open the GitHub releases page, skim for "breaking", grep for "migration", decide
whether to risk the upgrade tonight. I do this across ~10 apps and it never got
less tedious.

So I built **Bumplog** (https://bumplog.org): for each app it pulls the latest
GitHub release, summarizes the changelog, and flags **safe / caution / breaking**
with a one-line reason — every value linked back to the exact GitHub release it
came from. No invented details; if the notes don't say, it says "unknown," not a
guess.

It's early (a handful of apps so far, more being added), and the whole thing is
deliberately boring: static pages, no login, no tracking beyond privacy-friendly
analytics. The idea is you bookmark the apps you run and check before you upgrade.

Honest asks:
- Does the **safe/caution/breaking** call match what you'd conclude from the notes?
- Which apps should it cover next?
- Anything that would make it a page you'd actually re-check before upgrading?

(I built it — feedback welcome, especially where the assessment is wrong.)

---

## Option B — selfh.st (newsletter / directory)

selfh.st runs a weekly self-hosted newsletter and a software directory; a short,
factual submission fits their format better than a Reddit-style post.

**Blurb:**
> **Bumplog** (https://bumplog.org) — a "is it safe to update?" tracker for
> self-hosted apps. For each app it summarizes the latest GitHub release and flags
> breaking changes (safe / caution / breaking), with every value traceable to the
> source release. Static, no account, privacy-friendly. Aimed at the "check before
> you upgrade" habit.

Submit via their "submit software / news" form.

---

## After you post
- Watch PostHog for the first **non-`$direct`** referral source — that's the
  leading-gate diversity signal we've been missing.
- Reply to every substantive comment; fixes/feedback feed the next day's agent run.
- Do NOT post again for a while — the experiment's whole point is that returns are
  earned through utility, not repeated promotion.
