/**
 * Which declared card prompt steps the identical-play proof reaches: the same-seed games (trace-hash.ts
 * --prompts output) and the unit tests (answered steps, noted by step-coverage.setup.ts). A step neither
 * reaches rests on reading the code alone; the hand-off lists them.
 *
 *   npx vitest run --config scripts/step-coverage.vitest.config.ts   (writes $STEP_COVERAGE_OUT)
 *   npx vite-node scripts/step-coverage.ts -- <trace --prompts output> <unit-test steps file>
 */
import { existsSync, readFileSync } from 'node:fs';
import '../src/core';
import { getCardDefinition } from '../src/core/cards';
import { getCardScript, scriptedCardCodes } from '../src/core/scripts';

const [traceFile, testsFile] = process.argv.slice(2).filter(a => a !== '--');
const lines = (file: string | undefined) => (file && existsSync(file) ? readFileSync(file, 'utf8').split('\n') : []);
const traced = new Set(lines(traceFile).flatMap(l => /^prompt (\d{5} \S+):/.exec(l)?.[1] ?? []).map(k => k.replace(/ psi-(corp|runner):/, ' ')));
const tested = new Set(lines(testsFile).map(l => l.trim()).filter(Boolean));

/**
 * Steps a card declares but can never ask, with the reason. Keep this short: a dead step is better deleted.
 * These come from a flow shared by several cards, which declares every step of the flow on each of them.
 */
const NEVER_ASKED: Record<string, string> = {
  '35044 operation': "installFromHQ's play-an-operation step; only Humanoid Resources asks it (Top-Down Solutions passes then = '')",
};

const declared = scriptedCardCodes().flatMap(code => (getCardScript(code)?.promptSteps ?? []).map(step => `${code} ${step}`));
const neither = declared.filter(k => !traced.has(k) && !tested.has(k) && !NEVER_ASKED[k]);
const onlyTests = declared.filter(k => !traced.has(k) && tested.has(k));
console.log(`${declared.length} declared steps: ${declared.filter(k => traced.has(k)).length} reached by the games, ${onlyTests.length} more by unit tests only, ${neither.length} by neither`);
for (const [k, why] of Object.entries(NEVER_ASKED)) console.log(`never asked: ${k}: ${why}`);
for (const k of neither) console.log(`neither: ${k} (${getCardDefinition(k.slice(0, 5)).title})`);
