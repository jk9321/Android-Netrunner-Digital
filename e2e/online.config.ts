import { defineConfig } from '@playwright/test';

/**
 * The online game on a real Workers runtime (multiplayer phase 2, chunk 2c):
 * `npm run test:e2e:online` builds the site, then runs the site Worker and the
 * staging game Worker together under `wrangler dev` (local Durable Object,
 * storage and hibernation included) and plays through e2e/online.workerd.ts
 * with two browsers. Not part of `npm run test:e2e` or CI: wrangler is not a
 * dependency of the repo (the Cloudflare builds bring their own), so this
 * fetches it with npx, or uses the one named in $WRANGLER.
 */
const wrangler = process.env.WRANGLER ?? 'npx --yes wrangler@4.155.0';

export default defineConfig({
  testDir: '.',
  testMatch: 'online.workerd.ts',
  timeout: 180_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787', viewport: { width: 1600, height: 900 } },
  webServer: {
    command: `npm run build && ${wrangler} dev -c wrangler.jsonc -c wrangler.games.staging.jsonc --port 8787 --ip 127.0.0.1`,
    cwd: '..',
    url: 'http://127.0.0.1:8787/',
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
  },
});
