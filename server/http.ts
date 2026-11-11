/** Small HTTP helpers shared by the game Worker, the room and the site's forwarding. */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** Largest request body the game API reads (a deck is a few KB). */
export const MAX_BODY_BYTES = 64_000;

export type BodyRead = { ok: true; value: unknown } | { ok: false; tooBig: boolean };

/**
 * The request's JSON body, read as a stream with a byte cap (audit
 * MP-BODY-READ): a body with no Content-Length (chunked), or one that says
 * less than it sends, is cut off past `max` bytes instead of read in full.
 */
export async function readBody(request: Request, max = MAX_BODY_BYTES): Promise<BodyRead> {
  if (Number(request.headers.get('Content-Length') ?? 0) > max) return { ok: false, tooBig: true };
  if (!request.body) return { ok: false, tooBig: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return { ok: false, tooBig: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, tooBig: false };
  }
}

/** The request's JSON body, or null when it is missing, too big or not JSON (readBody, without the reason). */
export async function readJson(request: Request, max = MAX_BODY_BYTES): Promise<unknown> {
  const read = await readBody(request, max);
  return read.ok ? read.value : null;
}
