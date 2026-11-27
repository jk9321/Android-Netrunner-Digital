/**
 * F119 phase A step 9 (local probe; brief rev 1, finding 8, ruling-redteam.md "Rev 1, ruled" item 1): loops and keys. On
 * boards from a g1 deal where the Runner is tagged at a Runner turn start, with one card swapped into HQ (the probe's own
 * HIDDEN-READ edit, on separate structuredClone objects): Bigger Picture (both credit reads), Mindscaping (damageWorth),
 * IP Enforcement with an agenda to take (agendaWorth, the corpAgenda kind), an installed Orbital the next turn can finish
 * (damageWorth on the onScore path), and Bigger Picture's hand plan entered from handPlanWorth. Per board, under U+G, both
 * views: the clock's prices, tagsWorth calls made inside the use part (each one answered by the tag-pricing frame's flat
 * rate, so the clock is not entered: frame), the value guard's flat answers (guard: a re-entry the frame did not stop),
 * and tagClock entries inside the use part (must be 0). Then the fields the use part reads against its memo key.
 *   npx vite-node scripts/f119-punisher-field/loops.ts [-- DEAL=2691 POOL=batch]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Patch, makeTree } from '../corp-owed/trees';
import { MERGE_BASE, armPatches, setArm, treeRoot } from './trees';

for (const kv of process.argv.slice(2).filter(x => x.includes('='))) process.env[kv.split('=')[0]] = kv.split('=')[1];
const DEAL = Number(process.env.DEAL ?? 2691);
const POOL = process.env.POOL ?? 'batch';
const G = globalThis as any;
const C = `((globalThis as any).__f119Loop ?? { in: 0 })`;
const LOOP: Patch[] = [
  ['ai/evaluate.ts', `  if (pricing().pricingTagLoss) return logValue('tag', 'tagsWorth flat (tag clock)',`, `  if (pricing().pricingTagLoss && ${C}.in) ${C}.frame = (${C}.frame ?? 0) + 1;\n  if (pricing().pricingTagLoss) return logValue('tag', 'tagsWorth flat (tag clock)',`],
  ['ai/evaluate.ts', `  const flat = () => logValue('tag', 'tagsWorth flat (loop)',`, `  const flat = () => ((${C}.guard = (${C}.guard ?? 0) + 1), logValue('tag', 'tagsWorth flat (loop)',`],
  ['ai/evaluate.ts', `'tagsWorth flat (loop)', state, tags * RATES.tagAgainstRunner, viewer, count);`, `'tagsWorth flat (loop)', state, tags * RATES.tagAgainstRunner, viewer, count));`],
  ['ai/evaluate.ts', `function tagClock(state: GameState, viewer: SideCode, tags: number, actual: boolean, memoHome?: GameState): number {`, `function tagClock(state: GameState, viewer: SideCode, tags: number, actual: boolean, memoHome?: GameState): number {\n  if (${C}.in) ${C}.clockIn = (${C}.clockIn ?? 0) + 1;\n  ${C}.clock = (${C}.clock ?? 0) + 1;`],
  ['ai/evaluate.ts', `export function tagUsePerTurn(state: GameState, viewer: SideCode, n: number): number {\n  return withPricing(`, `export function tagUsePerTurn(state: GameState, viewer: SideCode, n: number): number {\n  ${C}.in++;\n  try { return tagUsePerTurnIn(state, viewer, n); } finally { ${C}.in--; }\n}\nfunction tagUsePerTurnIn(state: GameState, viewer: SideCode, n: number): number {\n  return withPricing(`],
  ['ai/evaluate.ts', `export function tagUseHandWorth(state: GameState, code: string): number {\n  const use = tagUseOf(code);`, `export function tagUseHandWorth(state: GameState, code: string): number {\n  ${C}.in++;\n  try { return tagUseHandWorthIn(state, code); } finally { ${C}.in--; }\n}\nfunction tagUseHandWorthIn(state: GameState, code: string): number {\n  const use = tagUseOf(code);`],
];

async function main() {
  const dir = makeTree(join(treeRoot(99), 'B'), { ref: MERGE_BASE, patches: [...armPatches('B'), ...LOOP] });
  const entry = join(dir, 'src', '__f119l.ts');
  writeFileSync(entry, ["export * as ai from './ai/index';", "export * as po from './ai/playout';", "export * as core from './core/index';", "export * as decks from './data/decks';", "export * as ev from './ai/evaluate';", "export * as hv from './ai/handValues';", "export * as pricing from './ai/pricing';", "export * as plans from './ai/cardPlans';", "export * as runs from './ai/runs';"].join('\n') + '\n');
  const B: any = await import(/* @vite-ignore */ entry);
  setArm('B', 'base');
  const runs: Record<string, string> = { batch: '46008214593', nrdb: '46012461062' };
  const rec = JSON.parse(readFileSync(`scripts/f119-punisher-field/deals-${runs[POOL]}.json`, 'utf8')).find((r: any) => r.seed === DEAL);
  const pool: any[] = [...ALL_DECKS, ...NRDB_TEST_DECKS];
  const setup = B.decks.deckGameSetup(rec.seed, pool.find(d => d.side === 'corp' && d.name === rec.corpDeck), pool.find(d => d.side === 'runner' && d.name === rec.runnerDeck));
  const g = new B.po.GameRunner(B.core.createInitialGameState(setup), { corp: B.ai.createAgent('corp', 'normal'), runner: B.ai.createAgent('runner', 'normal') });
  // the first tagged Runner turn start (the base plays: switches off)
  let s: GameState | undefined;
  for (let n = 0; n < 8000 && !g.state.winner; n++) {
    const st: GameState = g.state;
    if (st.activePlayer === 'runner' && !st.activeRun && !st.pendingPrompts.length && st.runner.tags > 0 && st.runner.scoreArea.length) {
      s = structuredClone(st);
      break;
    }
    if (!g.step()) break;
  }
  if (!s) throw new Error('no tagged Runner turn start with an agenda in the Runner score area');
  const swap = (code: string, edit?: (x: GameState) => void) => {
    const x = structuredClone(s!);
    x.corp.hq[0] = { ...x.corp.hq[0], cardCode: code };
    edit?.(x);
    return x;
  };
  const scoreAgenda = s.runner.scoreArea.map(c => `${B.core.getCardDefinition(c.cardCode).title} (${B.core.getCardDefinition(c.cardCode).agenda_points})`).join(', ');
  const boards: [string, GameState][] = [
    ['Bigger Picture in HQ', swap('35065')],
    ['Mindscaping in HQ', swap('34045')],
    [`IP Enforcement in HQ, ${scoreAgenda} in the Runner's score area, tags 3`, swap('35066', x => (x.runner.tags = 3))],
    [
      'an installed Orbital Superiority with 3 counters',
      swap('30056', x => {
        const remote = Object.values(x.corp.servers).find((v: any) => v.isRemote && v.root.length) as any;
        if (remote) {
          remote.root[0] = { ...remote.root[0], cardCode: '30068', advancementCounters: 3 };
        }
      }),
    ],
  ];
  setArm('B', 'UG');
  console.log(`deal ${POOL} ${DEAL} (${rec.corpDeck} v ${rec.runnerDeck}), board T${s.turnNumber}, tags ${s.runner.tags}, Corp credits ${s.corp.credits}, Runner credits ${s.runner.credits}, grip ${s.runner.grip.length}`);
  for (const [name, b] of boards)
    for (const viewer of ['corp', 'runner'] as const) {
      G.__f119Loop = { in: 0 };
      const st = structuredClone(b);
      const v = B.pricing.asSide(viewer, () => B.hv.inDecision(st, viewer, () => ({ clock: B.ev.tagsWorth(st, viewer), next: B.ev.tagsWorth(st, viewer, st.runner.tags + 1), use: B.ev.tagUseCandidates(st, viewer, st.runner.tags) })));
      const c = G.__f119Loop;
      console.log(`  ${name}, ${viewer}'s view: clock ${v.clock.toFixed(3)}, next tag ${(v.next - v.clock).toFixed(3)}; uses ${v.use.map((u: any) => `${u.code} ${u.swing.toFixed(2)}@${u.p.toFixed(2)}`).join(' ') || 'none'}; clock prices ${c.clock ?? 0}; inside the use part: tagsWorth answered by the frame ${c.frame ?? 0}, tagClock entered ${c.clockIn ?? 0}; guard flats ${c.guard ?? 0}`);
    }
  // entered from handPlanWorth (Bigger Picture held), the Corp deciding
  G.__f119Loop = { in: 0 };
  const st = structuredClone(boards[0][1]);
  const hp = B.pricing.asSide('corp', () => B.hv.inDecision(st, 'corp', () => B.plans.handPlanWorth(st, st.corp.hq[0])));
  const c = G.__f119Loop;
  console.log(`  entered from handPlanWorth (Bigger Picture held): ${hp?.toFixed(3)}; inside: tagsWorth answered by the frame ${c.frame ?? 0}, tagClock entered ${c.clockIn ?? 0}; guard flats ${c.guard ?? 0}`);
  setArm('B', 'base');
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
