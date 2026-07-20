#!/bin/zsh
# harness/run-daily.sh — Bumplog autonomous daily cycle (launchd entrypoint).
#
# Runs the governed content loop, then on a clean publish builds + deploys the
# static site (wrangler's stored OAuth) and commits the audit trail locally
# (NO push). Past day 30 the loop halts 'experiment-complete' and this wrapper
# unloads its own launchd schedule. launchd does not load your shell profile,
# so PATH is set explicitly. Secrets come from .env; ANTHROPIC_API_KEY is force-
# unset so the loop stays on the Max subscription (never bills PAYG).
set -u
export PATH="/Users/zaeemkhan/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="/Users/zaeemkhan/Projects/bumplog"
PLIST="$HOME/Library/LaunchAgents/org.bumplog.daily.plist"
cd "$REPO" || exit 1

LOG_DIR="$REPO/harness/runs/logs"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/$(date +%Y-%m-%d).log" 2>&1
echo "──────── $(date) bumplog daily run ────────"

# Failure alert: the job runs headless under launchd as the logged-in user, so
# an osascript user notification is visible on the desktop. Text is passed via
# argv (never interpolated into the AppleScript) so quotes/backslashes in error
# text cannot break the script.
notify_failure() { # notify_failure <message>
  osascript -e 'on run argv' \
            -e 'display notification (item 1 of argv) with title "Bumplog daily loop FAILED"' \
            -e 'end run' \
            "$1" \
    || echo "osascript notification failed (non-fatal)"
}

# Load secrets; HARD-guarantee the subscription path (the loop re-asserts this).
set -a
[ -f "$REPO/.env" ] && source "$REPO/.env"
set +a
unset ANTHROPIC_API_KEY

# 0) Pull visitor feedback from KV into the loop-readable inbox (non-fatal —
#    the loop reads whatever the inbox already holds if the pull fails).
node harness/pull-feedback.mjs || echo "feedback pull failed (non-fatal)"

# 1) Governed content loop. Publishes to data files; always emits a run record.
node harness/morning_loop.mjs
RUN_RECORD="$REPO/harness/runs/run-$(date -u +%Y-%m-%d).json"
[ -f "$RUN_RECORD" ] || {
  echo "no run record at $RUN_RECORD — aborting"
  notify_failure "$(date -u +%Y-%m-%d): loop emitted no run record — see harness/runs/logs"
  exit 1
}

# Unexpected failure (status "error", e.g. expired OAuth) → raise a VISIBLE
# alert; 2026-07-14..16 failed silently and lost three cycles. Governed halts
# (rate-limit, experiment-complete, journal-mismatch) stay quiet by design.
if grep -Eq '"status":[[:space:]]*"error"' "$RUN_RECORD"; then
  ERR_HEAD=$(node -e '
    const rec = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(String(rec.error ?? "(no error detail)").split("\n")[0].slice(0, 200));
  ' "$RUN_RECORD" 2>/dev/null) || ERR_HEAD="(could not read error from run record)"
  echo "run FAILED (status \"error\"): $ERR_HEAD"
  notify_failure "$(date -u +%Y-%m-%d): $ERR_HEAD"
fi

# Past day 30 → self-disable the schedule and stop (no deploy).
if grep -q '"experiment-complete"' "$RUN_RECORD"; then
  echo "experiment complete (past day 30) — unloading schedule $PLIST"
  launchctl unload "$PLIST" 2>/dev/null
  exit 0
fi

# Deploy only on a clean, published run. A halt/error leaves the live site as-is.
if ! grep -Eq '"status":[[:space:]]*"ok"' "$RUN_RECORD"; then
  echo "loop did not finish ok — no deploy. See $RUN_RECORD"
  exit 0
fi

# 1b) Refresh support-lifecycle data (non-fatal — a failed refresh keeps the
#     committed src/data/eol.json; the site never depends on the network).
node harness/eol.mjs || echo "eol refresh failed (non-fatal, keeping stale src/data/eol.json)"

# 2) Build + deploy the static site (direct upload via stored wrangler OAuth).
echo "building…"
npm run build || { echo "build FAILED — no deploy"; exit 1; }
echo "deploying via wrangler OAuth…"
npx --yes wrangler pages deploy dist --project-name bumplog --commit-dirty=true \
  || echo "deploy FAILED — content is published locally; will retry next run"

# 2c) Project today's verdicts to the OWNED Mastodon account. Non-fatal and
#     inert without MASTODON_INSTANCE/MASTODON_TOKEN; defaults to a review queue
#     (tasks/discovery/queue/) until MASTODON_MODE=auto. Runs after deploy so the
#     linked pages are live. See harness/social/DECISION.md.
node harness/social/post-daily.mjs || echo "social post failed (non-fatal)"

# 3) Commit the audit trail locally (no push).
git add -A
git commit -m "chore(daily): bumplog cycle $(date -u +%Y-%m-%d)" >/dev/null 2>&1 \
  && echo "committed audit trail" || echo "nothing to commit"
echo "done $(date)"
