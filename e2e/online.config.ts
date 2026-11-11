import { defineConfig } from '@playwright/test';

/**
 * The online game on a real Workers runtime (multiplayer phase 2, chunk 2c):
 * `npm run test:e2e:online` builds the site, then runs the site Worker and the
 * staging game Worker under `wrangler dev` (local Durable Object,
 * storage and hibernation included) and plays through e2e/online.workerd.ts
 * with two browsers. Not part of `npm run test:e2e` or CI: wrangler is not a
 * dependency of the repo (the Cloudflare builds bring their own), so this
 * fetches it with npx, or uses the one named in $WRANGLER.
 *
 * `--var ROOM_ENDED_MS:4000` (chunk 2e): a finished room deletes itself after
 * 4 s instead of a day, so the test sees the clean-up alarm run. Only this
 * command line sets it; the game Worker ignores anything but a positive
 * number (server/gameRoom.ts), and no wrangler config file has it.
 */
const wrangler = process.env.WRANGLER ?? 'npx --yes wrangler@4.155.0';

export default defineConfig({
  testDir: '.',
  testMatch: 'online.workerd.ts',
  timeout: 180_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787', viewport: { width: 1600, height: 900 } },
  // Two wrangler processes (they find each other through wrangler's local dev registry): a `--var` reaches only
  // the first Worker of a multi-config `wrangler dev`, so the game Worker runs on its own to get ROOM_ENDED_MS
  webServer: [
    {
      command: `${wrangler} dev -c wrangler.games.staging.jsonc --var ROOM_ENDED_MS:4000 --port 8789 --inspector-port 9230 --ip 127.0.0.1`,
      cwd: '..',
      port: 8789,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run build && ${wrangler} dev -c wrangler.jsonc --port 8787 --ip 127.0.0.1`,
      cwd: '..',
      url: 'http://127.0.0.1:8787/',
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
