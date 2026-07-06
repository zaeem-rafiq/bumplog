# Scope decision — owned Mastodon posting (2026-07-05)

## What changed
The daily loop may now project each day's published verdicts to an **owned
Mastodon account** (one toot per newly-published app), to fix the experiment's
real bottleneck: `distinct_sources: 0` — zero referral diversity, the site has
no external audience. Operator (Zaeem) approved the channel; this file is the
audit record.

## Why this is NOT the `mass_post_external` protected action
`guardrails.lock.json` forbids `mass_post_external`: *"Never mass-post externally
in any pattern risking the domain being blacklisted."* That rule targets
**spamming other people's communities** (Reddit/HN/forums) from a promo account —
a pattern those platforms punish with account + domain bans.

Owned-account posting is materially different and stays within the guardrail's
intent:
- **Own channel**, not someone else's community — no third-party moderation to trip.
- **Capped** at `MASTODON_MAX_POSTS_PER_DAY` (default 3 = the content cadence),
  and de-duplicated by `(slug, version)` so an unchanged app is never re-posted.
- **Bot-labelled** — the account must set `bot: true` (Mastodon "automated"
  flag); honest disclosure, ToS-clean.
- **Approval-gated by default** — `MASTODON_MODE=queue` writes proposed toots to
  `tasks/discovery/queue/` for human review. It only auto-posts once the operator
  flips `MASTODON_MODE=auto` (graduated trust, mirroring the harness's other
  trust-graduation patterns).

Crucially, this was added as an **explicit, logged decision** — NOT by inventing
a new un-protected `action.kind` to slip past `lib/guards.mjs`'s allow-list. The
guard is declarative (it halts only on self-declared protected kinds); dodging it
by renaming would defeat the whole point of the experiment. If the cadence ever
scales toward blacklist-risking volume, that is `mass_post_external` again and
must halt.

## What is unchanged / still forbidden
- **No spend.** Mastodon's API is free; `spend_money` remains absolute. (This is
  why Mastodon, not X — X removed its free tier in Feb 2026: ~$0.20 per
  link-post, which would collide with `spend_money`.)
- **No fabrication.** Every toot's verdict, version, and link derive from
  `src/data/apps.json` (GitHub-sourced). The formatter invents nothing; an
  unassessed app is skipped, not guessed.
- **Human-only setup.** Account creation, the API token, and the bot label are
  operator actions. The agent cannot create the account or hold the credential;
  it only reads `MASTODON_TOKEN` from `.env` at run time.

## Honest limitation
A Mastodon following is engagement **on Mastodon**, not the contract's on-site
`returning_engaged_median`. This feeds the top of the funnel and should move the
**leading** gate's referral-diversity signal (`distinct_sources`); it does not
directly satisfy the **lagging** on-site gate, which is still measured by opt-in
cookies. Treat it as distribution + a durable owned asset, not a gate cheat.
