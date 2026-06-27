// harness/lib/env.mjs
// Loads + validates harness environment. NEVER logs secret values.
// Secrets live in `.env` (gitignored); load with `set -a; source .env; set +a`
// before invoking the harness, or rely on the parent shell's exported vars.

/** Required secrets/config for the harness read paths. */
const REQUIRED = [
  'POSTHOG_PROJECT_API_KEY', // public ingest key (phc_…) — client-visible by design
  'POSTHOG_PERSONAL_API_KEY', // read-scoped personal key — THE real secret
  'POSTHOG_PROJECT_ID', // numeric, for the query API
  'POSTHOG_HOST', // region host, e.g. https://us.i.posthog.com
  'GITHUB_TOKEN', // read-only PAT (NOT the gh CLI token)
];

/**
 * Returns the validated environment, or throws with a precise, value-free message.
 * @param {{ requireAll?: boolean }} [opts]
 * @returns {Readonly<Record<string, string>>}
 */
export function loadEnv(opts = {}) {
  const requireAll = opts.requireAll !== false;
  // A blank value OR a leftover template placeholder both count as "missing" so
  // the harness never runs against REPLACE_ME secrets.
  const missing = REQUIRED.filter((k) => {
    const v = process.env[k];
    return !v || v.trim() === '' || /REPLACE_ME/i.test(v);
  });

  if (requireAll && missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}. ` +
        `Copy .env.example to .env, fill values, then \`set -a; source .env; set +a\`. ` +
        `(Values are never printed.)`,
    );
  }

  const env = {};
  for (const k of REQUIRED) env[k] = process.env[k] ?? '';
  // Normalize host (strip trailing slash) so URL building is consistent.
  if (env.POSTHOG_HOST) env.POSTHOG_HOST = env.POSTHOG_HOST.replace(/\/+$/, '');
  return Object.freeze(env);
}

/**
 * Subscription-path guard. ANTHROPIC_API_KEY being set SILENTLY overrides the
 * Max subscription and bills pay-as-you-go at API rates — a reprice tripwire.
 * The loop calls this and HALTS if the key is present.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function assertSubscriptionAuth() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.trim() !== '') {
    return {
      ok: false,
      reason:
        'ANTHROPIC_API_KEY is set in the runtime. This silently overrides the Max ' +
        'subscription and bills pay-as-you-go. Unset it before running the loop.',
    };
  }
  return { ok: true };
}

/** Redact any accidental secret-shaped token from a string before logging. */
export function redact(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/phc_[A-Za-z0-9]+/g, 'phc_***')
    .replace(/phx_[A-Za-z0-9]+/g, 'phx_***')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***')
    .replace(/gh[pousr]_[A-Za-z0-9]+/g, 'gh*_***')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
}
