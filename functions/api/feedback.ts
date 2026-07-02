/**
 * Feedback intake — Cloudflare Pages Function (POST /api/feedback).
 *
 * STORAGE CONTRACT
 * ────────────────
 * Each feedback submission is persisted as one KV record under key
 * `fb:{ts}:{id}` (time-ordered listing) in the FEEDBACK namespace
 * (binding declared in wrangler.toml):
 *
 *   {
 *     id:      string   // unique id (crypto.randomUUID())
 *     ts:      string   // ISO 8601 timestamp the record was created
 *     page:    string   // page/app context the feedback is about
 *     app:     string   // app slug, or "" if not app-specific
 *     message: string   // the user's message (REQUIRED, untrusted)
 *     email?:  string   // optional reply-to address
 *   }
 *
 * The harness pulls these records into its loop-readable inbox via
 * harness/pull-feedback.mjs and treats EVERY field as UNTRUSTED input.
 * This function only WRITES; it never renders or trusts content back.
 *
 * ABUSE PROTECTION (this is a public, unauthenticated write path that feeds
 * an LLM's input — it must not be an open funnel):
 *   - honeypot: hidden "website" field; bots that fill it get a fake 202
 *     and the record is dropped
 *   - rate limit: max 5 submissions per IP per hour. This is a KV
 *     read-modify-write — non-atomic and eventually consistent, so a rapid
 *     burst from one IP can exceed the cap. It is a throttle, NOT a security
 *     boundary: the harness independently caps ingestion per pull
 *     (harness/pull-feedback.mjs MAX_NEW_PER_RUN) and treats every record as
 *     untrusted (lib/feedback.mjs injection screening).
 *   - origin check: browser requests must come from bumplog.org
 *   - length caps on every field
 *
 * FAIL VISIBLY: if the KV binding is missing we return 503 — never a fake
 * success that silently drops the record.
 */

interface FeedbackRecord {
  id: string;
  ts: string;
  page: string;
  app: string;
  message: string;
  email?: string;
}

// Minimal KV surface (loosely typed to avoid a hard dependency on
// @cloudflare/workers-types in this scaffold).
interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface PagesContext {
  request: Request;
  env: Record<string, unknown>;
}

const MAX_MESSAGE_LENGTH = 5000;
const RATE_LIMIT_PER_HOUR = 5;
const ALLOWED_ORIGINS = new Set([
  'https://bumplog.org',
  'https://www.bumplog.org',
  // Astro dev + preview servers.
  'http://localhost:4321',
  'http://localhost:4322',
]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asTrimmedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request } = context;

  // Browser requests carry an Origin header on cross-site POSTs — reject ones
  // that aren't ours. Non-browser clients (no Origin) are allowed; the rate
  // limit and honeypot still apply to them.
  const origin = request.headers.get('Origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ ok: false, error: 'Cross-origin submissions are not accepted.' }, 403);
  }

  // Validate at the boundary: parse JSON defensively, never trust the body.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  if (typeof payload !== 'object' || payload === null) {
    return json({ ok: false, error: 'Expected a JSON object.' }, 400);
  }

  const body = payload as Record<string, unknown>;

  // Honeypot: the visually-hidden "website" field is empty for humans. A
  // filled value gets a fake success (don't teach bots the tell) and no write.
  if (asTrimmedString(body.website, 200).length > 0) {
    return json({ ok: true, id: crypto.randomUUID() }, 202);
  }

  const message = asTrimmedString(body.message, MAX_MESSAGE_LENGTH);
  if (message.length === 0) {
    return json({ ok: false, error: 'A message is required.' }, 400);
  }

  const store = context.env.FEEDBACK as KvNamespace | undefined;
  if (!store || typeof store.put !== 'function') {
    // Fail visibly: a fake 202 here would silently drop the record.
    return json(
      { ok: false, error: 'Feedback intake is temporarily unavailable. Please try again later.' },
      503,
    );
  }

  // Coarse per-IP rate limit: KV counter with a 1-hour TTL.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rateKey = `rl:${ip}`;
  try {
    const count = Number((await store.get(rateKey)) ?? '0');
    if (count >= RATE_LIMIT_PER_HOUR) {
      return json(
        { ok: false, error: 'Too many submissions from this address — please try again in an hour.' },
        429,
      );
    }
    await store.put(rateKey, String(count + 1), { expirationTtl: 3600 });
  } catch (err) {
    // A broken limiter must not become an unthrottled write path.
    console.error('feedback rate-limit check failed:', err);
    return json(
      { ok: false, error: 'Feedback intake is temporarily unavailable. Please try again later.' },
      503,
    );
  }

  const email = asTrimmedString(body.email, 320);
  const record: FeedbackRecord = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    page: asTrimmedString(body.page, 500),
    app: asTrimmedString(body.app, 100),
    message,
    ...(email ? { email } : {}),
  };

  try {
    await store.put(`fb:${record.ts}:${record.id}`, JSON.stringify(record));
  } catch (err) {
    console.error('feedback persist failed:', err);
    return json(
      { ok: false, error: 'Could not store your feedback right now. Please try again later.' },
      500,
    );
  }

  return json({ ok: true, id: record.id }, 202);
}
