/**
 * R-14h fix, bar 2's stops (rulings 16 (b)): at one decision of a base-pool deal, what moved between commit 2 and the
 * commit 3 draft. Both trees play the deal (identical up to the decision), then at the decision each records:
 *   - the planner's candidates and their values (turnPlanner planTurn, both sides) and its pick after the contenders step,
 *     and the deciding Runner's own rank list (runner/core.ts), so the gap between the two picks is read on each tree;
 *   - every cardRate answer in call order with its caller's site (the two trees' calls are paired in order while their
 *     sites agree): per site, the largest |draft - base|, and where the call sequences part.
 *
 *   npx vite-node scripts/runner-rework/last-credits-fix-why.ts -- POOL=batch SEED=2231 STEP=25 DRAFT=2,today
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';
import { HOOKS, Patch, applyPatches } from './core-hooks';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '1ed2469098c5b2a7a43fa2e4371df23da4963289'; // commit 2's src (scripts after it only)
const POOL = process.env.POOL ?? 'batch';
const SEED = Number(process.env.SEED);
const STEP = Number(process.env.STEP);
const DRAFT = (process.env.DRAFT ?? '2,today').split(',');
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/last-credits-fix-why');
const G = globalThis as any;

const WHY: Patch[] = [
  ['ai/valueModel.ts', `import { actingSide, plan, pricingKey } from './pricing';`, `import { actingSide, plan, pricingKey, pricing as __whyPricing } from './pricing';`],
  [
    'ai/valueModel.ts',
    `  return logValue('cardDrawn', 'cardRate', state, state && deckCard ? deckCard(state, side, when) : RATES.drawnCard, side, when);\n`,
    `  const __avg = __whyPricing().averaging;\n  const __v = logValue('cardDrawn', 'cardRate', state, state && deckCard ? deckCard(state, side, when) : RATES.drawnCard, side, when);\n  (globalThis as any).__whyRate?.(new Error().stack, side, when, __v, __avg);\n  return __v;\n`,
  ],
  [
    'ai/turnPlanner.ts',
    `    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;\n`,
    `    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;\n    (globalThis as any).__whyPlan?.(side, scored.map(x => [x.action, x.value]), best?.action, best?.value);\n`,
  ],
];

function trees(): Record<'base' | 'draft', string> {
  rmSync(root, { recursive: true, force: true });
  const out = {} as Record<'base' | 'draft', string>;
  for (const name of ['base', 'draft'] as const) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
    if (name === 'draft') execSync(`python3 scripts/runner-rework/last-credits-fix-draft.py ${DRAFT[0]} ${DRAFT[1]} ${dir}`);
    const read = (p: string) => readFileSync(p, 'utf8');
    const write = (p: string, t: string) => writeFileSync(p, t);
    applyPatches(dir, HOOKS, `tree ${name}`, read, write);
    applyPatches(dir, WHY, `why ${name}`, read, write);
    // NOCLEAR=1: the deck average map is never cleared at its size cap (its key is kept incomplete, so when it is cleared
    // decides which board's value a hit serves; the draft adds 'later' keys and so moves the clears)
    // NOCACHE=1: no deck average is served from the map (each is worked out on the asking board: the exact value)
    if (process.env.NOCACHE === '1') applyPatches(dir, [['ai/handValues.ts', `  if (cached !== undefined && !drawAudit.on) return cached;`, `  if (cached !== undefined && !drawAudit.on && false) return cached;`]], `nocache ${name}`, read, write);
    if (process.env.NOCLEAR === '1') applyPatches(dir, [['ai/handValues.ts', `  if (deckAverage.size > 500) deckAverage.clear();`, `  if (deckAverage.size > 5e7) deckAverage.clear();`]], `noclear ${name}`, read, write);
    out[name] = dir;
  }
  return out;
}

type Deal = { seed: number; corpDeck: string; runnerDeck: string };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const siteOf = (stack: string) => {
  const line = stack.split('\n')[2] ?? '';
  const m = line.match(/src\/ai\/([^:)]+):(\d+)/);
  return m ? `${m[1]}:${m[2]}` : line.trim().slice(0, 60);
};
const short = (a: unknown) => JSON.stringify(a).replace(/"player":"(corp|runner)",?/, '').slice(0, 110);

async function main() {
  const dirs = trees();
  const T: Record<'base' | 'draft', Tree> = { base: await loadTree('base', dirs.base), draft: await loadTree('draft', dirs.draft) };
  const deals: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/last-credits-fix-deals-${POOL === 'batch' ? '45617829233' : '45621322301'}.json`, 'utf8'));
  const d = deals.find(x => x.seed === SEED);
  if (!d) throw new Error(`no deal ${SEED} in ${POOL}`);
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck)!;
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck)!;
  const rec: Record<string, { rates: [string, string, number][]; plans: unknown[]; ranks: unknown[]; act?: unknown }> = {};
  for (const name of ['base', 'draft'] as const) {
    const t = T[name];
    t.clear();
    const g = new t.GameRunner(t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r)), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
    for (let i = 0; i < STEP; i++) g.step();
    const R = (rec[name] = { rates: [], plans: [], ranks: [] } as any);
    let depth = 0;
    G.__lkIn = () => {
      depth++;
      return () => void depth--;
    };
    // the flat answers inside a deck average (averaging) are left out: the draft works out more averages (the money is in the key)
    G.__whyRate = (stack: string, side: string, when: string, v: number, avg: boolean) => !avg && R.rates.push([`${siteOf(stack)} ${side} ${when}`, depth === 1 ? 'top' : 'look', v]);
    G.__whyPlan = (side: string, scored: [unknown, number][], best: unknown, value: number) => depth === 1 && R.plans.push({ side, scored: scored.map(([a, v]) => [short(a), +v.toFixed(4)]).sort((x, y) => y[1] - x[1]), best: short(best), value });
    G.__lkDecRank = (_s: GameState, ranked: any[]) => depth === 1 && R.ranks.push(ranked.slice(0, 6).map(x => [short(x.action), +Number(x.score).toFixed(4)]));
    const s: GameState = g.state;
    R.board = { T: s.turnNumber, active: s.activePlayer, corp: s.corp.credits, runner: s.runner.credits, cc: s.corp.clicks, rc: s.runner.clicks };
    g.step();
    R.act = short(g.last);
    G.__lkIn = G.__whyRate = G.__whyPlan = G.__lkDecRank = undefined;
  }
  const B = rec.base;
  const D = rec.draft;
  console.log(`# ${POOL} ${SEED} step ${STEP}: board ${JSON.stringify((B as any).board)}; base pick ${B.act}; draft pick ${D.act}\n`);
  for (const [name, x] of Object.entries(rec)) {
    console.log(`## ${name}: planner candidates (top level), best first`);
    for (const p of x.plans as any[]) console.log(`- ${p.side}: pick ${p.best} (${p.value}); ${p.scored.map((s: any) => `${s[0]} = ${s[1]}`).join('; ')}`);
    if (x.ranks.length) console.log(`  Runner rank lists (first 6): ${JSON.stringify(x.ranks)}`);
  }
  // pair the cardRate answers in order while the sites agree
  const n = Math.min(B.rates.length, D.rates.length);
  // a site is paired by file, side and when: the draft's handValues.ts lines sit below the base's (drawMoney's body)
  const pairKey = (x: string) => x.replace(/:\d+ /, ' ');
  let k = 0;
  while (k < n && pairKey(B.rates[k][0]) === pairKey(D.rates[k][0])) k++;
  console.log(`\n## cardRate answers: base ${B.rates.length}, draft ${D.rates.length}; paired in order: ${k}${k < n ? ` (they part at answer ${k}: base ${B.rates[k][0]}, draft ${D.rates[k][0]})` : ''}`);
  const by = new Map<string, { calls: number; max: number; top: number }>();
  for (let i = 0; i < k; i++) {
    const key = B.rates[i][0];
    const e = by.get(key) ?? { calls: 0, max: 0, top: 0 };
    e.calls++;
    const dv = Math.abs(D.rates[i][2] - B.rates[i][2]);
    e.max = Math.max(e.max, dv);
    if (B.rates[i][1] === 'top') e.top = Math.max(e.top, dv);
    by.set(key, e);
  }
  console.log(`| site (base tree's line) | side | when | calls | largest move | largest move outside nested GameRunner scopes |`);
  console.log(`|---|---|---|---:|---:|---:|`);
  for (const [key, e] of [...by].sort((a, b) => b[1].max - a[1].max)) {
    const [site, side, when] = key.split(' ');
    console.log(`| ${site} | ${side} | ${when} | ${e.calls} | ${e.max.toExponential(3)} | ${e.top.toExponential(3)} |`);
  }
}
main();
