/**
 * Traces one failing deep-fuzz seed (brief rd-fuzz-fixes): replays it to the failing step and prints the Runner's R&D
 * marks and HQ list before and after the failing action, with R&D's contents and the action's log lines.
 *
 *   npx vite-node scripts/runner-rework/rd-fuzz/trace.ts -- <seed> [--base 1128084000] [--json out.json]
 */
import { writeFileSync } from 'node:fs';
import { createInitialGameState, executeAction, GameState } from '../../../src/core';
import { deckGameSetup } from '../../../src/data/decks';
import { fuzzEngineGame, knownByCopy, pairing, relabelledCopy, relabelledRdCopy, summaryLine } from '../../engine-fuzz-check';

const args = process.argv.slice(2).filter(a => a !== '--');
const seed = Number(args[0]);
const bi = args.indexOf('--base');
const base = bi >= 0 ? Number(args[bi + 1]) : 1128084000;
const ji = args.indexOf('--json');
const g = seed - base;
const { corp, runner } = pairing(g);
const players = g % 1000 === 999 ? 'ai' : 'random';
const res = fuzzEngineGame(seed, corp, runner, { maxSteps: players === 'ai' ? 4000 : 1500, players });
console.log(summaryLine(res));
const f = res.failures[0];
if (!f) process.exit(0);
let state: GameState = { ...createInitialGameState(deckGameSetup(seed, corp, runner)), stops: res.stops };
for (let i = 0; i < f.step - 1; i++) state = executeAction(state, res.actions[i]);
const prev = state;
const next = executeAction(prev, res.actions[f.step - 1]);
const rd = (s: GameState) => s.corp.rd.map((c, i) => `${i}:${c.cardCode}/${c.instanceId}`).join(' ');
const marks = (s: GameState) => JSON.stringify(s.corp.rdKnownToRunner ?? []);
console.log('action', JSON.stringify(res.actions[f.step - 1]));
console.log('prev R&D', rd(prev));
console.log('prev marks', marks(prev));
console.log('prev HQ', prev.corp.hq.map(c => `${c.cardCode}/${c.instanceId}`).join(' '));
console.log('prev HQ known', JSON.stringify(prev.corp.knownToRunner ?? []));
console.log('next R&D', rd(next));
console.log('next marks', marks(next));
console.log('next HQ', next.corp.hq.map(c => `${c.cardCode}/${c.instanceId}`).join(' '));
console.log('next HQ known', JSON.stringify(next.corp.knownToRunner ?? []));
console.log('log:\n ' + next.log.slice(prev.log.length).map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n '));
if (f.check === 'known-by-copy') {
  for (const [name, r] of [['hand', relabelledCopy(prev)], ['rd', relabelledRdCopy(prev)]] as const) {
    if (!r) continue;
    const o = executeAction(r, res.actions[f.step - 1]);
    console.log(`relabelled (${name}) prev HQ known`, JSON.stringify(r.corp.knownToRunner ?? []), 'grip', JSON.stringify(r.runner.knownToCorp ?? []), 'arch', JSON.stringify(r.corp.archKnownToRunner ?? []));
    console.log(`relabelled (${name}) next HQ known`, JSON.stringify(o.corp.knownToRunner ?? []));
    console.log(`  by copy  ${knownByCopy(o)}\n  as played ${knownByCopy(next)}`);
  }
}
if (ji >= 0) writeFileSync(args[ji + 1], JSON.stringify({ seed, corp: corp.id, runner: runner.id, step: f.step, prev, action: res.actions[f.step - 1] }));
