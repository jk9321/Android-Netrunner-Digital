/** Small HTTP helpers shared by the game Worker, the room and the site's forwarding. */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** Largest request body the game API reads (a deck is a few KB). */
export const MAX_BODY_BYTES = 64_000;

/** The request's JSON body, or null when it is missing, too big or not JSON. */
export async function readJson(request: Request, max = MAX_BODY_BYTES): Promise<unknown> {
  if (Number(request.headers.get('Content-Length') ?? 0) > max) return null;
  const text = await request.text();
  if (text.length > max) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
