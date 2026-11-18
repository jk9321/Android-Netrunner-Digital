/**
 * Stage D exploit F2 (grip money), brief Q4: where an arm's Corp time goes on one decision. Plays the deal (DEAL, this
 * tree's Normal AIs, as grip-money-fire.ts) to its Corp decision I, then asks a fresh Normal Corp there in control and in
 * each arm (ARMS), REPS times each: milliseconds, hold questions asked and searched (holdCacheStats), the pick.
 *   DEAL=1201 I=49 ARMS=control,f2max,playable npx vite-node scripts/stage-d/grip-money-trace.ts
 */
import { join, resolve } from 'node:path';
import { GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { dealState } from '../stage-a/harness';
import { makeTrees, readArms } from './runner-money-trees';

process.env.ARMS_FILE ||= 'scripts/stage-d/grip-money-arms.json';
const want = Number(process.env.I ?? 49);
const file = readArms();
const dirs = makeTrees(file, resolve('.gm-trace'));
let i = 0;
let at: GameState | null = null;
const watch = (inner: Agent): Agent =>
  new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === 'chooseAction')
        return (state: GameState) => {
          if (i++ === want) at = structuredClone(state);
          return target.chooseAction(state);
        };
      return Reflect.get(target, prop, recv);
    },
  });
const g = new GameRunner(dealState(Number(process.env.DEAL ?? 1201)), { corp: watch(createAgent('corp', 'normal')), runner: createAgent('runner', 'normal') });
for (let k = 0; k < 4000 && !at && g.step(); k++);
if (!at) throw new Error('no such decision');
const s: GameState = at;
console.log(`decision ${want} at T${s.turnNumber}, Corp ${s.corp.credits} credits ${s.corp.clicks} clicks`);
for (const [t, dir] of Object.entries(dirs)) {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hold = await m('ai/corp/hold.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const pr = await m('ai/pricing.ts');
  const dg = await m('ai/diagnostics.ts');
  for (let r = 0; r < Number(process.env.REPS ?? 3); r++) {
    hv.clearHandCaches();
    ev.clearDamageThreats();
    const st = hold.holdCacheStats;
    const [a0, s0] = [st.asked, st.searched];
    const t0 = performance.now();
    const d = dg.newDiagnostics();
    const pick = pr.withPricing({ diagnostics: d }, () => ai.createAgent('corp', 'normal').chooseAction(structuredClone(s)));
    console.log(`${t} ${(performance.now() - t0).toFixed(0)} ms, hold asked ${st.asked - a0} searched ${st.searched - s0}, planner ${JSON.stringify(d.planner)}, scoreInTwo ${JSON.stringify(d.scoreInTwo)}, scoreNow ${JSON.stringify(d.scoreNow)}, pick ${JSON.stringify(pick)}`);
  }
}
