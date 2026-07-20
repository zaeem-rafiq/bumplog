---
title: "Silent daily-loop failures on expired OAuth: three lost cycles, no alert"
date: 2026-07-20
category: integration-issues
module: harness
problem_type: integration_issue
component: background_job
severity: high
symptoms:
  - "claude -p failed (exit 1, claude-sonnet-4-6): Failed to authenticate: OAuth session expired and could not be refreshed"
  - "Three consecutive daily cycles (2026-07-14 through 2026-07-16) lost silently — errors went only to harness/runs/logs/*.log"
  - "run-daily.sh skipped the deploy on non-ok status but still exited 0, so launchd saw success and no alert fired"
  - "OAuth failure surfaced mid-run at the first LLM step (~20 seconds in) instead of at the auth guard"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - "authentication"
  - "tooling"
tags:
  - "oauth"
  - "claude-cli"
  - "launchd"
  - "silent-failure"
  - "headless-automation"
  - "auth-preflight"
  - "failure-alerting"
---

# Silent daily-loop failures on expired OAuth: three lost cycles, no alert

## Problem

bumplog's content is grown by an autonomous daily loop: launchd (`org.bumplog.daily.plist`) runs `harness/run-daily.sh`, which runs the governed loop `harness/morning_loop.mjs`; LLM steps invoke `claude -p` on the Max-subscription OAuth path via `runLLM` in `harness/lib/llm.mjs`.

On 2026-07-14, the CLI's stored OAuth session expired and could not be refreshed. Every `claude -p` call from the harness failed with exit 1. The loop's cheap deterministic steps (auth-guard, verify-locks, pull-metrics, feedback, gate) all passed in seconds, and the run died about 20 seconds in at the first LLM step, `draftJournalViaAgent` — the stack in the run record ends at the `runLLM` throw site (`harness/lib/llm.mjs:128`, via `morning_loop.mjs:437` in the pre-fix tree's numbering). The same thing happened on 07-15 and 07-16. Nothing surfaced any of it: `run-daily.sh` consumed the run record's status only to decide deploy/no-deploy, logged one line to `harness/runs/logs/<date>.log`, and exited 0. Three daily cycles were lost before anyone noticed, and the recovery was a single interactive `claude login`.

Two distinct gaps, not one:

1. **No failure-alert channel.** The job runs headless under launchd. A run record with `"status": "error"` was written to disk and never consumed by anything — no notification, no non-zero signal a human would see.
2. **The precondition guard validated the wrong thing.** Step 0 of the loop (`assertSubscriptionAuth`, `harness/lib/env.mjs:50-61`) is a billing tripwire only: it checks that `ANTHROPIC_API_KEY` is *unset* so the loop can never silently bill pay-as-you-go. It never checked whether the OAuth session the run actually depends on was valid, so an expired session surfaced deep in the run instead of at step 0.

## Symptoms

- Run records `harness/runs/run-2026-07-14.json`, `run-2026-07-15.json`, and `run-2026-07-16.json` all have `"status": "error"` with:

  ```
  Error: claude -p failed (exit 1, claude-sonnet-4-6): Failed to authenticate: OAuth session expired and could not be refreshed
      at runLLM (file:///Users/zaeemkhan/Projects/bumplog/harness/lib/llm.mjs:128:13)
      ...
      at async draftJournalViaAgent (file:///Users/zaeemkhan/Projects/bumplog/harness/morning_loop.mjs:437)
  ```

- The 07-14 record's trace shows the guard passing before the failure: `{"step": "auth-guard", "ok": true}` (run-2026-07-14.json:6-10) — the billing tripwire was satisfied while the credential the run actually needed was dead.
- Each failed run died almost immediately and cheaply. Note the trap in the record: `"budget"` holds budget **remaining**, not consumed (`record.budget = budget.remaining()`, morning_loop.mjs — `remaining()` is caps minus consumption in `harness/lib/caps.mjs`). The 07-14 value `{ "turns": 55, "minutes": 29.67 }` against the 60-turn/30-minute caps means only 5 turns and ~20 seconds were spent. The cost was the lost cycle, not compute.
- No user-visible signal on any of the three days; the site simply didn't update.

## What Didn't Work

None of the existing safeguards was broken — each did its job, and the failure sailed through the gap between them:

- **The billing tripwire passed, correctly.** `assertSubscriptionAuth` only asserts `ANTHROPIC_API_KEY` is unset (env.mjs:51-58). No API key was set, so the auth-guard trace logged `ok: true`. It was never designed to test OAuth validity — session expiry is invisible to an environment-variable check.
- **The deploy gate worked as designed — silently.** The pre-fix `run-daily.sh` checked the run record only to gate deployment:

  ```sh
  # Deploy only on a clean, published run. A halt/error leaves the live site as-is.
  if ! grep -Eq '"status":[[:space:]]*"ok"' "$RUN_RECORD"; then
    echo "loop did not finish ok — no deploy. See $RUN_RECORD"
    exit 0
  fi
  ```

  It correctly held back a deploy on a bad run, then exited 0. Protection against publishing a broken run is not the same thing as telling anyone the run broke.
- **Logs captured everything, and nobody reads them.** `run-daily.sh` redirects all output to `harness/runs/logs/<date>.log`. The full error was on disk each day. A log file only helps once you already know to look.
- **The run record faithfully recorded the failure — and nothing consumed it.** `morning_loop.mjs` always emits a run record, and the record honestly said `"status": "error"` with the full stack. The failure-reporting pipeline ended at the filesystem.
- **A prior fix improved diagnosability, not visibility (session history).** On 2026-07-09 the same loop died at the same step from a transient `claude -p` failure whose run record carried a *blank* error reason; commit `22bfa68` fixed that by classifying both output streams (with `--output-format json`, `claude -p` reports failure detail in stdout JSON, not stderr) and routing overloads to a governed rate-limit halt. That errored run was itself discovered only by accident, days later, while looking at uncommitted files — and an errored cycle still produces a normal-looking `chore(daily)` commit (just fewer files), so even the git history looks superficially healthy. The fix made failures diagnosable after the fact but added no alerting — the exact gap the OAuth outage then fell through.

## Solution

Commit `692780b` ("fix(harness): alert on failed daily runs + fail fast on expired OAuth") on branch `claude/eager-noether-ca27f4`. **Merge state, as of this writing (2026-07-20): not merged to main, no PR** — the SHA is branch-local and will change if the branch is squash- or rebase-merged; update this citation once a PR exists. launchd runs the main checkout at `/Users/zaeemkhan/Projects/bumplog`, so the fix is inert in production until the branch merges — the daily job is still running the pre-fix script.

### 1. `run-daily.sh` — a visible failure alert for `status: "error"` runs

A `notify_failure` helper posts a macOS user notification via osascript. The job runs headless under launchd as the logged-in user, so a `display notification` lands on the desktop. The message is passed as an AppleScript **argv item**, never interpolated into the script source, so quotes/backslashes in error text cannot break it (run-daily.sh:25-31):

```sh
notify_failure() { # notify_failure <message>
  osascript -e 'on run argv' \
            -e 'display notification (item 1 of argv) with title "Bumplog daily loop FAILED"' \
            -e 'end run' \
            "$1" \
    || echo "osascript notification failed (non-fatal)"
}
```

It fires in exactly two cases. A missing run record (run-daily.sh:46-50):

```sh
[ -f "$RUN_RECORD" ] || {
  echo "no run record at $RUN_RECORD — aborting"
  notify_failure "$(date -u +%Y-%m-%d): loop emitted no run record — see harness/runs/logs"
  exit 1
}
```

And a run record with `"status": "error"`, where node extracts the first line of `record.error` for the notification body (run-daily.sh:55-62):

```sh
if grep -Eq '"status":[[:space:]]*"error"' "$RUN_RECORD"; then
  ERR_HEAD=$(node -e '
    const rec = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(String(rec.error ?? "(no error detail)").split("\n")[0].slice(0, 200));
  ' "$RUN_RECORD" 2>/dev/null) || ERR_HEAD="(could not read error from run record)"
  echo "run FAILED (status \"error\"): $ERR_HEAD"
  notify_failure "$(date -u +%Y-%m-%d): $ERR_HEAD"
fi
```

Governed halts — rate-limit, journal-mismatch, experiment-complete — deliberately stay quiet: they either self-recover next window or are by-design stops, and alerting on them would train the operator to ignore the notification.

### 2. `morning_loop.mjs` — step 0b, an OAuth-validity pre-check at the top of the run

Immediately after the reprice guard, live runs now ping the actual auth path before spending anything (morning_loop.mjs:70-84):

```js
    // ── Step 0b: OAuth-validity pre-check (live runs only) ───────────────────
    // A minimal `claude -p` ping so an expired/unrefreshable OAuth session
    // fails HERE with a clear reason instead of mid-run at the first real LLM
    // step (2026-07-14..16 burned three cycles that way). Rate-limit/billing
    // verdicts keep their governed-halt classification; any other ping failure
    // is status 'error' so run-daily.sh raises a visible alert.
    if (!dryRun) {
      const ping = await (opts.authPing ?? pingClaudeAuth)();
      log('auth-ping', ping.ok ? { ok: true } : { ok: false, kind: ping.kind, detail: oneLine(ping.detail) });
      if (!ping.ok) {
        if (ping.kind === 'rate-limit') throw new RateLimitError(`auth ping: ${oneLine(ping.detail)}`);
        if (ping.kind === 'billing') throw new BillingChangeError(`auth ping: ${oneLine(ping.detail)}`);
        throw new Error(`OAuth pre-check failed — claude -p ping did not succeed: ${oneLine(ping.detail)}`);
      }
    }
```

`pingClaudeAuth` is a new export in `harness/lib/llm.mjs:176-190`: one minimal Haiku (`MODELS.routine = 'claude-haiku-4-5'`, llm.mjs:23) invocation of `claude -p 'Reply with the single word: ok'` with a 60-second default timeout, no `--system-prompt` (the ping must stay cheap and independent of the content pipeline), no tools, and the same `--setting-sources project,local` as real steps. It reuses the existing `spawnCapture` (llm.mjs:296) and `classifyResult` (llm.mjs:207) machinery rather than growing a parallel path:

```js
export async function pingClaudeAuth(opts = {}) {
  const auth = assertSubscriptionAuth();
  if (!auth.ok) return { ok: false, kind: 'billing', detail: auth.reason };
  const args = [
    '-p', 'Reply with the single word: ok',
    '--model', MODELS.routine,
    '--output-format', 'json',
    '--allowed-tools', '',
    '--max-budget-usd', '1',
    '--setting-sources', 'project,local',
  ];
  const { stdout, code, stderr } = await spawnCapture('claude', args, opts.timeoutMs ?? 60_000);
  const verdict = classifyResult({ code, stdout, stderr });
  return verdict.kind === 'ok' ? { ok: true } : { ok: false, kind: verdict.kind, detail: verdict.detail };
}
```

**Key design decision — how each ping verdict is classified.** `classifyResult` sorts a failed call into `'rate-limit'` (`/rate.?limit|429|529|overloaded/i`, llm.mjs:237), `'billing'` (`/credit|billing|payment|insufficient|api rate/i`, llm.mjs:238), or `'error'`. Step 0b maps the first two onto their existing governed-halt errors (`RateLimitError`, `BillingChangeError`) — those conditions self-recover or are refuse-to-bill stops, and stay quiet. Everything else, including an expired OAuth session, becomes a plain `Error`, which the loop's catch-all records as run `status: "error"` — precisely the status that now fires the desktop notification. Expired OAuth needs a human to run `claude login`; it must be loud, so it is deliberately *not* a governed halt.

The test seam is `opts.authPing` (morning_loop.mjs:77): tests and simulations inject a fake ping instead of spawning the real CLI.

## Why This Works

- **The failure now has a consumer.** Before, the run record's `status: "error"` terminated at the filesystem. Now `run-daily.sh` reads it and converts it into a desktop notification with the date and the first line of the real error — the one channel a headless launchd job can reliably reach the logged-in user on.
- **The guard now validates the credential the run actually uses.** An env-var check can never observe OAuth expiry; a real (but minimal) `claude -p` round-trip exercises the exact auth path every subsequent step depends on. The 07-14-style failure now stops at step 0b with an explicit `auth-ping` trace entry and a first-line reason, instead of a mid-run stack trace nobody sees — and with the alert, recovery is one `claude login` the same morning instead of three silent days.
- **Failure taxonomy is preserved, not flattened.** By routing ping verdicts through the same `classifyResult` patterns as real steps, a rate-limited morning still halts gracefully (`status: "halted"`, `halt.code: "rate-limit"`, quiet) while a dead session becomes a loud `status: "error"`. Alerts stay high-signal because self-recovering conditions never trigger them.
- **The alert path is injection-proof by construction.** Error text reaches AppleScript as `item 1 of argv`, so arbitrary quotes/backslashes in a stack trace can't produce a second silent failure inside the alerting mechanism itself.
- **Known limitation (session history).** A single up-front ping catches *auth-wide* failures at step 0; it does not cover per-call transients later in the run (on 2026-07-09 the Haiku feedback step succeeded while the Sonnet build step failed mid-run). Mid-run failures remain covered by `classifyResult`'s governed halts and — with this fix — by the status-`error` notification when they are not self-recovering.

Verification (forced-failure simulation with an injected failing `authPing` and an isolated `BUMPLOG_RUNS_DIR`): run record came out `status: "error"` with trace step `auth-ping` and error first line `OAuth pre-check failed — claude -p ping did not succeed: claude -p failed (exit 1, claude-haiku-4-5): Failed to authenticate: OAuth session expired and could not be refreshed`. A rate-limited ping produced `status: "halted"` with `halt.code: "rate-limit"`; a healthy ping let the run proceed past the guard. The notification block, extracted verbatim from `run-daily.sh`, fired osascript with exit 0 both directly and from a one-shot launchd agent (`launchctl submit` → ran → exit 0 → removed). The real `pingClaudeAuth()` returned `{ok:true}` in 4.5s. Regression: `node harness/dry_run.mjs` → 23 pass, 0 fail; `node harness/lib/llm.test.mjs` → all assertions passed.

## Prevention

- **A headless scheduler needs an alert channel distinct from its logs.** Logs are for diagnosis after you know something broke; they are not a notification mechanism. Any launchd/cron job whose failure matters must actively push failure to a human-visible surface (desktop notification, email, chat webhook). "It's in the log" is how three cycles disappear.
- **A precondition guard must validate every credential/session the run will need — not just one billing variable.** Enumerate the run's external dependencies (here: the OAuth session, not just the absence of an API key) and probe each cheaply at step 0. The probe should exercise the same code path as the real usage (`pingClaudeAuth` goes through the same `spawnCapture` + `classifyResult` as `runLLM`), otherwise it can pass while the real path fails.
- **Classify failures by required response, and only alert on the ones needing a human.** Self-recovering conditions (rate limits) → quiet governed halt; human-action conditions (expired OAuth: run `claude login`) → loud error. An alert channel that fires on self-healing noise gets ignored by the time it matters.
- **Make guards injectable.** The `opts.authPing` seam (morning_loop.mjs:77) is what made the forced-failure, rate-limit, and healthy-path simulations trivial to run without a real CLI or a real expired session. Any new step-0 probe should ship with the same seam.
- **Pass untrusted text to osascript via argv, never by interpolation.** The `on run argv` pattern in `notify_failure` (run-daily.sh:25-31) is the reusable template: error strings contain quotes and backslashes, and an alert helper that can be broken by the very text it reports is a second silent failure waiting to happen.
- **Watch for the "every safeguard worked, the system still failed" shape.** Deploy gate, honest run record, complete logs — each component behaved to spec, and the outcome was still three silently lost days. When auditing a pipeline, check that every failure signal a component *emits* has a component that *consumes* it.

## Related Issues

- `tasks/lessons.md` 2026-06-28 — "A scheduled job must be verified AS a scheduled job (launchd + ~/Documents TCC)": the sibling lesson for this same launchd job; this incident is a second instance of the headless-path-fails-while-manual-runs-pass family.
- `tasks/lessons.md` 2026-06-27 — "Prove the real query end-to-end, not just a probe": the reason `pingClaudeAuth` exercises the real `claude -p` spawn path rather than checking a token file.
- Commit `22bfa68` (2026-07-09, merged to main) — the precursor fix: `classifyResult` in `harness/lib/llm.mjs` made `claude -p` failures diagnosable (stdout-JSON classification, governed rate-limit halts) but added no alerting. (session history)
- `harness/DISCOVERY.md` — documents the loop's `claude -p` subscription-path seam and the reprice tripwire this guard extends.
- Evidence: `harness/runs/run-2026-07-14.json` through `run-2026-07-16.json` (status "error" with the OAuth stack), and `harness/runs/run-2026-07-09.json` as of commit `98df620` for the precursor transient failure — the file in the current tree is the successful same-day re-run.
- Operational note for this code area: the loop's vocabulary (`record.halt`, "halted") trips the user-level destructive-command hook's power-state pattern when it appears in commit messages or shell strings — reword (e.g. "governed stop") rather than bypass. Hit on 2026-07-09 and again while committing this fix. (session history)
