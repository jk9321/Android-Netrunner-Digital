// R-B B1b hand-off check (Corp side's owed-counts item 8): the lockstep's hooks and clears reach the module instance the
// games play on. Loads a tree as core-lockstep.ts does (facts-trees.ts loadTree, then ai/diagnostics.ts by the same
// path), plays deal 1001 to step K, then asks the Runner/Corp the same decision three times: fresh, again (cache hits:
// fewer values computed), and after the loader's clear (if the clear landed on a copy, the third ask would compute as
// few values as the second). Usage: npx vite-node scripts/runner-rework/b1b/instance-probe.ts [-- <tree dir>]
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join, resolve } from 'node:path';
import { loadTree } from '../facts-trees';
import { STARTER_DECKS } from '../../../src/data/decks';

const dir = resolve(process.argv.slice(2).find(a => a !== '--') ?? '.');
const t: any = await loadTree('probe', dir);
const diag = await import(/* @vite-ignore */ join(dir, 'src', 'ai/diagnostics.ts'));
const pricing = await import(/* @vite-ignore */ join(dir, 'src', 'ai/pricing.ts'));
let values = 0;
let byQ: Record<string, number> = {};
const sink = diag.installDiagnostics();
sink.onValue = (q: string) => {
  values++;
  byQ[q] = (byQ[q] ?? 0) + 1;
};
console.log('same namespace (loader vs second import): pricing', pricing === t.pricing);
const c = STARTER_DECKS.find((d: any) => d.side === 'corp')!;
const r = STARTER_DECKS.find((d: any) => d.side === 'runner')!;
const agents = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
const g = new t.GameRunner(t.core.createInitialGameState(t.decks.deckGameSetup(1001, c, r)), agents);
const ask = (clear?: () => void) => {
  clear?.();
  values = 0;
  byQ = {};
  const s = g.state;
  agents[s.activePlayer as 'corp' | 'runner'].chooseAction(s);
  return { n: values, q: byQ };
};
const more = (a: Record<string, number>, b: Record<string, number>) =>
  Object.entries(a).filter(([k, v]) => v > (b[k] ?? 0)).map(([k, v]) => `${k} +${v - (b[k] ?? 0)}`).join(', ');
let ok = true;
let steps = 0;
let judged = 0;
for (const K of [30, 45, 60, 75, 90, 105, 120]) {
  while (g.step() && (++steps < K || g.state.pendingPrompts.length || g.state.priority));
  const a = ask(), b = ask(), h = ask(() => t.handValues.clearHandCaches()), b2 = ask(), d = ask(() => t.clear()), b3 = ask();
  if (a.n) console.log(`- ${g.state.activePlayer} at step ${steps}: fresh ${a.n}, again ${b.n}; after clearHandCaches ${h.n} (${more(h.q, b.q)}), again ${b2.n}; after the loader's clear ${d.n} (${more(d.q, b2.q)}), again ${b3.n}`);
  if (!a.n) continue; // an ask that hands the sink no value (a run under way) says nothing either way
  judged++;
  if (!(h.n > b2.n && d.n > b3.n)) ok = false; // each clear makes the ask after it compute more than the repeat that follows it
}
if (!judged) ok = false;
console.log(`${judged} asks judged`);
console.log(ok ? 'OK: the sink sees the games, and each clear makes the next ask compute again' : 'CHECK: a clear did not change what the next ask computes');
