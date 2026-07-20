# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Daily Loop

### Daily Cycle
One scheduled, autonomous run of the content loop: an ordered sequence of guarded steps that pulls real telemetry and source data, drafts the day's public journal, and publishes only what passes the loop's judges and gates. Runs headless on a schedule; no human is in the loop during a cycle.

### Run Record
The machine-readable outcome of a Daily Cycle, emitted unconditionally — success, Governed Halt, or Error Run alike — carrying an ordered trace of every step taken. It is the single artifact downstream automation consults to decide what happens after a cycle (deploy, self-disable, alert).

### Governed Halt
A by-design stop the loop classified itself — a condition it anticipated, such as rate limiting, a billing change, a failed integrity check, or the experiment window closing. A Governed Halt normally writes a Blocker (a few by-design stops, such as the experiment window closing, record the halt only in the Run Record), ends the cycle quietly, and expects a later cycle to proceed without human action. Distinct from an Error Run.

### Error Run
A Daily Cycle that failed in a way the loop could not classify into a governed category. Error Runs require human attention and are surfaced loudly rather than silently retried; the recovery is whatever a human does about the recorded cause, not a resume.

### Blocker
A dated note the loop writes when it stops with a Governed Halt, recording what stopped the cycle so the next cycle or a human can see why. Writing it is best-effort: a failure to write a Blocker never suppresses the Run Record.

### Subscription Path
The billing invariant for LLM work: every model call in a cycle rides the operator's flat-rate subscription credentials, never a pay-as-you-go API key. The mere presence of such a key is treated as a Reprice Tripwire condition.

### Reprice Tripwire
The guard family that stops a cycle the moment its economics could silently change — a pay-as-you-go key appearing in the environment, or a billing-shaped failure from the model CLI. A trip is a Governed Halt: the loop refuses to spend at unknown cost rather than proceed.
