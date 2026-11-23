/**
 * ai-hr-install-steps: a lockstep trace of one deal (spec ruling follow-up: trace, do not only count). The deal is played
 * twice from the start, Normal v Normal, on the beta tree (Q0a out) and on the hq tree (the branch), each with its own
 * agents (hq-trees.ts). They play the same moves until the first decision whose answers differ; from there each line's
 * log is printed side by side, turn by turn, to the game's end or TURNS turns after the split.
 *
 *   DEAL=1801 TURNS=4 npx vite-node scripts/hr-install-steps/hq-trace.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolve } from 'node:path';
import { dealState } from '../stage-a/harness';
import { loadTree, makeTrees } from './hq-trees';

const seed = Number(process.env.DEAL ?? 1801);
const TURNS = Number(process.env.TURNS ?? 4);
const root = resolve('node_modules/.cache/hq-trace');

async function main() {
  const dirs = makeTrees(root, ['beta', 'hq']);
  const b = await loadTree('beta', dirs.beta);
  const h = await loadTree('hq', dirs.hq);
  const gb = new b.GameRunner(dealState(seed), { corp: b.createAgent('corp', 'normal'), runner: b.createAgent('runner', 'normal') });
  const gh = new h.GameRunner(dealState(seed), { corp: h.createAgent('corp', 'normal'), runner: h.createAgent('runner', 'normal') });
  let split: { T: number; at: number; before: any } | null = null;
  for (let n = 0; n < 6000; n++) {
    const before = structuredClone(gb.state);
    const ob = gb.step();
    const oh = gh.step();
    if (JSON.stringify(gb.last) !== JSON.stringify(gh.last)) {
      split = { T: before.turnNumber, at: before.log.length, before };
      console.log(`SPLIT turn ${before.turnNumber} (${before.activePlayer}), decision ${n}: prompt ${JSON.stringify(before.pendingPrompts[0]?.message ?? null)}`);
      console.log(`  beta: ${JSON.stringify(gb.last)}`);
      console.log(`  hq:   ${JSON.stringify(gh.last)}`);
      console.log(`  Corp ${before.corp.credits} cr, ${before.corp.clicks} clicks, HQ ${before.corp.hq.map((c: any) => b.core.cardDef(c).title).join(', ')}`);
      console.log(`  servers: ${Object.values(before.corp.servers).map((v: any) => `${v.id}[${v.ice.map((c: any) => b.core.cardDef(c).title).join('+')} | ${v.root.map((c: any) => b.core.cardDef(c).title).join('/')}]`).join(' ')}`);
      break;
    }
    if (!ob || !oh) break;
  }
  if (!split) return console.log('no split: the lines never differ');
  for (const g of [gb, gh]) for (let n = 0; n < 6000 && g.state.turnNumber <= split.T + TURNS && g.step(); n++);
  for (const [name, g] of [['beta', gb], ['hq', gh]] as const) {
    console.log(`\n=== ${name}: turns ${split.T}..${split.T + TURNS}; score Corp ${g.state.corp.score} Runner ${g.state.runner.score} at turn ${g.state.turnNumber}`);
    for (const l of g.state.log.slice(split.at)) if (l.turnNumber <= split.T + TURNS) console.log(`  T${l.turnNumber} ${l.player}: ${l.message}`);
  }
  for (const g of [gb, gh]) for (let n = 0; n < 6000 && g.step(); n++);
  console.log(`\nEND beta: winner ${gb.state.winner} ${gb.state.corp.score}-${gb.state.runner.score} T${gb.state.turnNumber}; hq: winner ${gh.state.winner} ${gh.state.corp.score}-${gh.state.runner.score} T${gh.state.turnNumber}`);
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
