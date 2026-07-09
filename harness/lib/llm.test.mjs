// Self-test for the `claude -p` result classifier. Pure logic — no spawn, no
// network, no env. Run: node harness/lib/llm.test.mjs
import assert from 'node:assert/strict';
import { classifyResult } from './llm.mjs';

// 1) Clean success → ok.
const ok = JSON.stringify({ subtype: 'success', is_error: false, api_error_status: null, result: 'All clear.' });
assert.equal(classifyResult({ code: 0, stdout: ok, stderr: '' }).kind, 'ok', 'clean success → ok');

// 2) CRITICAL: a SUCCESSFUL call whose model output mentions tripwire words must
//    NOT halt. Only failed calls have their result scanned.
const scary = JSON.stringify({ subtype: 'success', is_error: false, api_error_status: null,
  result: 'Upstream had a rate limit and a billing hiccup last week; resolved now.' });
assert.equal(classifyResult({ code: 0, stdout: scary, stderr: '' }).kind, 'ok',
  'model output containing "rate limit"/"billing" on success must not trip a halt');

// 3) The bug we fixed: exit 1, EMPTY stderr, error detail only in the stdout
//    envelope → transient overload must classify as rate-limit, not a blank fail.
const overload = classifyResult({ code: 1, stderr: '',
  stdout: JSON.stringify({ subtype: 'error_during_execution', is_error: true, api_error_status: { type: 'overloaded_error' }, result: '' }) });
assert.equal(overload.kind, 'rate-limit', 'overload in stdout → rate-limit (graceful halt + resume)');
assert.ok(/overloaded/i.test(overload.detail), 'detail names the overload — no more blank reason');

// 4) 429 surfaced via api_error_status (numeric) → rate-limit.
assert.equal(classifyResult({ code: 1, stderr: '',
  stdout: JSON.stringify({ is_error: true, subtype: 'error', api_error_status: 429, result: '' }) }).kind,
  'rate-limit', '429 status → rate-limit');

// 5) Credit/billing condition in the envelope → billing (refuse to bill).
assert.equal(classifyResult({ code: 1, stderr: '',
  stdout: JSON.stringify({ is_error: true, subtype: 'error', api_error_status: null, result: 'Insufficient credit balance.' }) }).kind,
  'billing', 'credit/billing in stdout → billing');

// 6) Generic failure is now diagnosable, not a blank "exited 1".
const gen = classifyResult({ code: 1, stderr: '',
  stdout: JSON.stringify({ is_error: true, subtype: 'error_during_execution', api_error_status: null, result: 'unexpected end of input' }) });
assert.equal(gen.kind, 'error', 'non-transient failure → error');
assert.ok(gen.detail.includes('error_during_execution') && gen.detail.includes('unexpected end of input'),
  'detail carries subtype + reason');

// 7) Transport-level rate limit on stderr still caught (back-compat).
assert.equal(classifyResult({ code: 1, stdout: '', stderr: 'Error: 429 Too Many Requests (rate limit)' }).kind,
  'rate-limit', 'rate limit on stderr still caught');

// 8) Timeout: SIGKILL → code null, stderr has [timeout], stdout not JSON.
const to = classifyResult({ code: null, stdout: '', stderr: '\n[timeout]' });
assert.equal(to.kind, 'error', 'timeout → error');
assert.ok(to.detail.includes('[timeout]'), 'timeout reason preserved');

// 9) Even a truly empty failure yields a non-blank, honest detail.
const empty = classifyResult({ code: 1, stdout: '', stderr: '' });
assert.equal(empty.kind, 'error');
assert.ok(empty.detail.length > 0 && !empty.detail.startsWith('undefined'), 'never a blank detail');

console.log('llm.test.mjs: all assertions passed');
