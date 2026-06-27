// harness/lib/gate.mjs
// Staged success-gate evaluation, read from the frozen contract.
//   Days 1–14  → LEADING: engaged uniques + source diversity (easy-to-move,
//                early signal). Channel cap enforced.
//   Days 15–19 → TRANSITION: both reported, neither gated.
//   Days 20–30 → LAGGING: returning-engaged median vs target (hard-to-fake).
// The leading stage is what you steer by early; the lagging stage is what the
// experiment is ultimately judged on.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

export function loadContract() {
  return JSON.parse(readFileSync(join(HARNESS_DIR, 'contract.lock.json'), 'utf8'));
}

/** 1-indexed experiment day → stage. */
export function stageForDay(dayIndex) {
  if (dayIndex <= 14) return 'leading';
  if (dayIndex <= 19) return 'transition';
  if (dayIndex <= 30) return 'lagging';
  return 'post';
}

/**
 * Evaluate the gate for the current day.
 * @param {object} telemetry  from analytics.pullAllMetrics()
 * @param {number} dayIndex   1-indexed day of the experiment
 * @param {object} [contract] defaults to the frozen contract
 */
export function evaluateGate(telemetry, dayIndex, contract = loadContract()) {
  const stage = stageForDay(dayIndex);
  const channelCap = contract.channel_cap ?? 0.5;
  const target = contract.target?.returning_engaged_median ?? contract.target ?? 5;

  const engagedUniques = telemetry.channels?.total_engaged_uniques ?? 0;
  const distinctSources = new Set((telemetry.channels?.rows ?? []).map((r) => r.referrer || r.channel)).size;
  const maxShare = telemetry.channels?.max_source_share ?? 0;
  const channelCapOk = maxShare <= channelCap;
  const median = telemetry.primary_metric ?? 0;

  const leading = {
    engaged_uniques: engagedUniques,
    distinct_sources: distinctSources,
    max_source_share: maxShare,
    channel_cap_ok: channelCapOk,
    // "On track" early = some engaged traffic AND not single-source dependent.
    on_track: engagedUniques > 0 && channelCapOk && distinctSources >= 2,
  };
  const lagging = {
    returning_engaged_median: median,
    target,
    on_track: median >= target && channelCapOk,
  };

  const gatedOnTrack =
    stage === 'leading' ? leading.on_track : stage === 'lagging' ? lagging.on_track : null;

  return {
    stage,
    day_index: dayIndex,
    leading,
    lagging,
    channel_cap: channelCap,
    channel_cap_ok: channelCapOk,
    gated_on_track: gatedOnTrack, // null during transition (nothing gated)
  };
}
