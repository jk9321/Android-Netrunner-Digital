import { defineConfig } from '@playwright/test';

// Browser smoke test of the built app: `npm run test:e2e` (builds, then serves dist/)
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 90_000,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1600, height: 900 } },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
