/**
 * The Cloudflare Worker in front of the static site. Only /api/* reaches
 * this code (run_worker_first in wrangler.jsonc); every other request is
 * served straight from the built assets in dist/.
 */
import { handleBugReport } from './bugReport';
import { ForwardEnv, forwardGames, isGamesPath } from '../server/forward';

interface Env extends ForwardEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/bug-report') return handleBugReport(request, env);
    // Online games: forwarded to the game Worker through a service binding (server/forward.ts)
    if (isGamesPath(pathname)) return forwardGames(request, env);
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
