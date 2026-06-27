// harness/lib/caps.mjs
// Runtime caps for a single loop run. On the subscription path the binding
// constraint is the rate-limit allowance, not dollars — these caps protect that
// allowance and kill runaway loops. Values come from guardrails.lock.json so
// they cannot drift from the frozen constitution.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** Load runtime caps from the frozen guardrails (with safe defaults pre-freeze). */
export function loadCaps() {
  try {
    const g = JSON.parse(readFileSync(join(HARNESS_DIR, 'guardrails.lock.json'), 'utf8'));
    const c = g?.runtime_caps ?? {};
    return Object.freeze({
      max_output_tokens: c.max_output_tokens ?? 8000,
      max_turns: c.max_turns ?? 60,
      max_wall_clock_minutes: c.max_wall_clock_minutes ?? 30,
    });
  } catch {
    return Object.freeze({ max_output_tokens: 8000, max_turns: 60, max_wall_clock_minutes: 30 });
  }
}

/** Tracks turns + wall-clock for a run and halts when a cap is exceeded. */
export class RunBudget {
  constructor(caps = loadCaps(), now = Date.now()) {
    this.caps = caps;
    this.startedAt = now;
    this.turns = 0;
  }

  /** Call before each tool-call/LLM turn; throws a halting error if a cap is hit. */
  tick(now = Date.now()) {
    this.turns += 1;
    if (this.turns > this.caps.max_turns) {
      throw halt(`turn cap exceeded (${this.turns} > ${this.caps.max_turns})`, 'turn-cap');
    }
    const elapsedMin = (now - this.startedAt) / 60000;
    if (elapsedMin > this.caps.max_wall_clock_minutes) {
      throw halt(
        `wall-clock cap exceeded (${elapsedMin.toFixed(1)}m > ${this.caps.max_wall_clock_minutes}m)`,
        'wall-clock-cap',
      );
    }
    return { turns: this.turns, elapsedMin };
  }

  remaining(now = Date.now()) {
    return {
      turns: Math.max(0, this.caps.max_turns - this.turns),
      minutes: Math.max(0, this.caps.max_wall_clock_minutes - (now - this.startedAt) / 60000),
    };
  }
}

function halt(message, code) {
  const e = new Error(`HALT: ${message}`);
  e.halt = true;
  e.code = code;
  return e;
}
