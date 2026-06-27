// harness/lib/hysteresis.mjs
// PIVOT HYSTERESIS. A "pivot" is a change of strategy/direction. To prevent
// thrash (and reactive over-correction to one noisy day), pivots are disallowed
// within a fixed window of the last pivot. Enforced in code, not by prompt.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const PIVOT_WINDOW_DAYS = 6;

// Test isolation: dry_run.mjs sets BUMPLOG_STATE_DIR to a temp dir.
function statePath() {
  return join(process.env.BUMPLOG_STATE_DIR || join(HARNESS_DIR, 'state'), 'pivots.json');
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return { lastPivotDate: null, history: [] };
  }
}

function writeState(s) {
  const sp = statePath();
  const dir = dirname(sp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(sp, JSON.stringify(s, null, 2));
}

/** Days between two YYYY-MM-DD dates (UTC). */
function daysBetween(aIso, bIso) {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86400000);
}

/**
 * Can the agent pivot today?
 * @param {string} today  YYYY-MM-DD
 * @param {{ windowDays?: number }} [opts]
 * @returns {{ allowed: boolean, reason: string, lastPivotDate: string|null, daysSince: number|null }}
 */
export function canPivot(today, opts = {}) {
  const windowDays = opts.windowDays ?? PIVOT_WINDOW_DAYS;
  const s = readState();
  if (!s.lastPivotDate) {
    return { allowed: true, reason: 'no prior pivot on record', lastPivotDate: null, daysSince: null };
  }
  const daysSince = daysBetween(s.lastPivotDate, today);
  if (daysSince < windowDays) {
    return {
      allowed: false,
      reason: `last pivot was ${daysSince}d ago (< ${windowDays}d hysteresis window)`,
      lastPivotDate: s.lastPivotDate,
      daysSince,
    };
  }
  return { allowed: true, reason: `${daysSince}d since last pivot (≥ ${windowDays}d)`, lastPivotDate: s.lastPivotDate, daysSince };
}

/** Record that a pivot happened today (only call after canPivot().allowed). */
export function recordPivot(today, rationale = '') {
  const s = readState();
  if (s.lastPivotDate) {
    const daysSince = daysBetween(s.lastPivotDate, today);
    if (daysSince < PIVOT_WINDOW_DAYS) {
      throw new Error(`recordPivot blocked: only ${daysSince}d since last pivot (< ${PIVOT_WINDOW_DAYS}d).`);
    }
  }
  s.history = [...(s.history ?? []), { date: today, rationale }];
  s.lastPivotDate = today;
  writeState(s);
  return s;
}
