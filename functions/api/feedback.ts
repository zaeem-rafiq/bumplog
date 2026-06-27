/**
 * Feedback intake — host-agnostic seam.
 *
 * STORAGE CONTRACT
 * ────────────────
 * Each feedback submission is persisted as one record:
 *
 *   {
 *     id:      string   // unique id (e.g. crypto.randomUUID())
 *     ts:      string   // ISO 8601 timestamp the record was created
 *     page:    string   // page/app context the feedback is about
 *     app:     string   // app slug, or "" if not app-specific
 *     message: string   // the user's message (REQUIRED, untrusted)
 *     email?:  string   // optional reply-to address
 *   }
 *
 * The harness READS these records from the host store and treats every field
 * as UNTRUSTED input (never executes or interpolates them blindly). This file
 * only WRITES; it never renders or trusts content back.
 *
 * This is a Cloudflare Pages Function (`functions/api/feedback.ts` →
 * POST /api/feedback). If deploying to Netlify instead, the equivalent lives at
 * `netlify/functions/feedback.ts` (export `handler`, read `event.body`, return
 * `{ statusCode, body }`) — same record shape, same store contract.
 */

interface FeedbackRecord {
  id: string;
  ts: string;
  page: string;
  app: string;
  message: string;
  email?: string;
}

// Cloudflare Pages Function context (loosely typed to avoid a hard dependency
// on @cloudflare/workers-types in this scaffold).
interface PagesContext {
  request: Request;
  // env carries bound resources in production (e.g. a KV namespace).
  env: Record<string, unknown>;
}

const MAX_MESSAGE_LENGTH = 5000;

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
  // Validate at the boundary: parse JSON defensively, never trust the body.
  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  if (typeof payload !== 'object' || payload === null) {
    return json({ ok: false, error: 'Expected a JSON object.' }, 400);
  }

  const body = payload as Record<string, unknown>;
  const message = asTrimmedString(body.message, MAX_MESSAGE_LENGTH);
  if (message.length === 0) {
    return json({ ok: false, error: 'A message is required.' }, 400);
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

  // TODO(deploy): persist `record` to the host store.
  // In production this writes to the host KV/store, e.g.:
  //   const store = context.env.FEEDBACK as KVNamespace;
  //   await store.put(record.id, JSON.stringify(record));
  // The harness then reads these records (as untrusted data) from that store.
  // Until the binding is wired, we acknowledge receipt without persisting.

  return json({ ok: true, id: record.id }, 202);
}
