/**
 * The Cloudflare Worker in front of the static site. Only /api/* reaches
 * this code (run_worker_first in wrangler.jsonc); every other request is
 * served straight from the built assets in dist/.
 */
import { BugReportEnv, handleBugReport } from './bugReport';

interface Env extends BugReportEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/bug-report') return handleBugReport(request, env);
    if (pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
