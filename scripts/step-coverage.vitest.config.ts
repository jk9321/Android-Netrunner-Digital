// Unit tests with step-coverage.setup.ts: see scripts/step-coverage.ts.
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../vite.config';

export default mergeConfig(base, defineConfig({ test: { setupFiles: ['tests/setup.ts', 'scripts/step-coverage.setup.ts'] } }));
