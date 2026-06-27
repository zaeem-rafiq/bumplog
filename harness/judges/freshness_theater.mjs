// harness/judges/freshness_theater.mjs
// JUDGE (b): FRESHNESS-THEATER. Every published "update" must reflect a REAL
// change in the GitHub source, not a cosmetic timestamp bump. The deterministic
// source-contentHash comparison (lib/freshness.mjs) is AUTHORITATIVE and is what
// blocks theater. The optional LLM layer is a logged second opinion for nuance
// (e.g. a real source change that's nonetheless trivial/non-user-facing).

import { assessFreshness } from '../lib/freshness.mjs';
import { MODELS } from '../lib/llm.mjs';

/**
 * @param {{ prev:object|null, next:object }} input
 * @param {{ llm?: (o:object)=>Promise<{json?:any,text:string}> }} [deps]
 * @returns {Promise<{ verdict:'fresh'|'theater', authoritative:object, llm:object|null }>}
 */
export async function judgeFreshness(input, deps = {}) {
  const det = assessFreshness(input.prev, input.next);
  const verdict = det.fresh ? 'fresh' : 'theater';

  // LLM layer is advisory only; never overrides the deterministic block.
  let llm = null;
  if (deps.llm && det.fresh && !det.firstPublish) {
    const prompt = [
      'You are a freshness auditor. A tracker entry changed because its GitHub',
      'source content hash changed. Decide whether the change is a MEANINGFUL,',
      'user-relevant update worth surfacing, or a trivial non-user-facing churn.',
      'Reply with JSON only: {"meaningful": boolean, "reason": string}.',
      `PREV: ${safe(input.prev)}`,
      `NEXT: ${safe(input.next)}`,
    ].join('\n');
    try {
      const out = await deps.llm({ prompt, role: 'routine', model: MODELS.routine, expectJson: true });
      llm = out.json ?? { meaningful: true, reason: out.text?.slice(0, 200) };
    } catch (err) {
      llm = { error: String(err.message) };
    }
  }

  return { verdict, authoritative: det, llm };
}

function safe(o) {
  try {
    const { raw_body, ...rest } = o ?? {};
    return JSON.stringify(rest).slice(0, 1500);
  } catch {
    return '{}';
  }
}
