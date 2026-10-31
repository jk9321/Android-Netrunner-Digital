import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { execSync } from 'node:child_process';

/** The commit (and branch) this build came from, shown in bug reports. Cloudflare's builds set WORKERS_CI_*. */
function buildVersion(): string {
  let commit = (process.env.WORKERS_CI_COMMIT_SHA ?? '').slice(0, 7);
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = 'unknown';
    }
  }
  const branch = process.env.WORKERS_CI_BRANCH;
  return branch ? `${commit} (${branch})` : commit;
}

/**
 * Beta builds list every test deck (NSG samples, NetrunnerDB lists) in the deck picker; every other
 * branch, main included, lists only the official starters. The branch comes from Cloudflare's build
 * variables, or from git for local builds; VITE_ALL_DECKS=1/0 overrides it.
 */
function allDecksBuild(): boolean {
  if (process.env.VITE_ALL_DECKS) return process.env.VITE_ALL_DECKS === '1';
  let branch = process.env.WORKERS_CI_BRANCH ?? process.env.CF_PAGES_BRANCH ?? '';
  if (!branch) {
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      branch = '';
    }
  }
  return branch === 'beta';
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
    __ALL_DECKS__: JSON.stringify(allDecksBuild()),
    // Beta-only tools (the bulk NetrunnerDB importer); compiled out of every other build
    __BETA_TOOLS__: JSON.stringify(allDecksBuild()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
