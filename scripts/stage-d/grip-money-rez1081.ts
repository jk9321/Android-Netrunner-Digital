/**
 * Stage D exploit F2 (grip money), "found" (AI Coordinator 15:20Z, item 2): deal 1081, the Runner's turn after Corp turn
 * 16, where the Runner got into remote-2 (Corp commit at margin 2) with the Corp's holding set partly unrezzed. Played
 * by the GameRunner (src/ai/playout.ts) with this tree's Normal AIs, as the fire count's deals are: every Runner action
 * that turn, and at each Corp rez window on that server the candidates, chooseRez's answer and the reasons it reads
 * (countedRez, the 'thisRun' hold with and without the ice, rezStops, modelRezGain, the Corp's and Runner's credits).
 *   DEAL=1081 T=16 SERVER=remote-2 npx vite-node scripts/stage-d/grip-money-rez1081.ts
 */
import { CardInstance, GameState, cardDef } from '../../src/core';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { dealState } from '../stage-a/harness';
import { serverHold } from '../../src/ai/corp/hold';
import { countedRez, rezStops } from '../../src/ai/corp/rez';
import { modelRezGain } from '../../src/ai/rezModel';
import { rezMoney } from '../../src/ai/corp/rezMoney';

const T = Number(process.env.T ?? 16);
const SERVER = process.env.SERVER ?? 'remote-2';
const title = (c: CardInstance) => cardDef(c).title;
const corp = createAgent('corp', 'normal');
let watching = false;
const inner = corp.chooseRez!.bind(corp);
corp.chooseRez = (state: GameState, cards: CardInstance[]) => {
  const a = inner(state, cards);
  if (watching && state.activeRun?.server === SERVER) {
    const run = state.activeRun;
    const sv = state.corp.servers[SERVER];
    console.log(`REZ WINDOW ${run.phase} pos ${run.icePosition}: server ice [${sv.ice.map(c => `${title(c)} ${c.instanceId}${c.isRezzed ? '' : '(u)'}`).join(', ')}], Corp ${state.corp.credits} credits, Runner ${state.runner.credits} credits ${state.runner.clicks} clicks`);
    for (const c of cards)
      if (cardDef(c).type_code === 'ice') {
        const withIt = serverHold(state, SERVER, { when: 'thisRun', mustRez: [c.instanceId], further: true });
        const without = serverHold(state, SERVER, { when: 'thisRun', mustRez: [], further: true });
        const onlyIt = serverHold(state, SERVER, { when: 'thisRun', mustRez: [c.instanceId], further: false });
        let gain: number | string;
        try {
          gain = modelRezGain(state, c, true);
        } catch (e) {
          gain = `error ${(e as Error).message}`;
        }
        console.log(`  candidate ${title(c)} ${c.instanceId}: countedRez ${countedRez(state, c)}, rezStops(further) ${rezStops(state, c)}, thisRun with it ${JSON.stringify({ holds: withIt.holds, rez: withIt.rez, cost: withIt.rezCost, need: withIt.need, budget: withIt.budget })}, without ${JSON.stringify({ holds: without.holds, rez: without.rez, cost: without.rezCost, need: without.need })}, it alone ${JSON.stringify({ holds: onlyIt.holds, need: onlyIt.need })}, modelRezGain ${gain}`);
      }
    try {
      const k = rezMoney(state);
      console.log(`  rezMoney keep ${k.keep} byServer ${JSON.stringify(k.byServer)}`);
    } catch (e) {
      console.log(`  rezMoney error ${(e as Error).message}`);
    }
    console.log(`  chooseRez -> ${a ? JSON.stringify(a) : 'pass'}`);
  }
  return a;
};
const g = new GameRunner(dealState(Number(process.env.DEAL ?? 1081)), { corp, runner: createAgent('runner', 'normal') });
for (let k = 0; k < 4000; k++) {
  const before = g.state;
  if (!g.step()) break;
  const after = g.state;
  if (before.turnNumber === T && before.activePlayer === 'corp' && after.activePlayer === 'runner') {
    watching = true;
    const sv = after.corp.servers[SERVER];
    const h = serverHold(after, SERVER, { when: 'runnerTurn', corpCredits: after.corp.credits });
    console.log(`RUNNER TURN after Corp T${T}: ${SERVER} ice [${sv.ice.map(c => `${title(c)} ${c.instanceId}${c.isRezzed ? '' : '(u)'}`).join(', ')}] root [${sv.root.map(title).join(', ')}]; Corp ${after.corp.credits}; Runner ${after.runner.credits} credits, grip [${after.runner.grip.map(title).join(', ')}]; hold ${JSON.stringify({ holds: h.holds, rez: h.rez, rezCost: h.rezCost, need: h.need, budget: h.budget })}`);
  }
  if (watching && before.activePlayer === 'runner' && g.last?.player === 'runner') console.log(`  runner ${JSON.stringify(g.last).slice(0, 140)} | ${after.runner.credits} credits${after.activeRun ? ` run ${after.activeRun.server} ${after.activeRun.phase} pos ${after.activeRun.icePosition}` : ''}`);
  if (watching && before.activePlayer === 'runner' && after.activePlayer === 'corp') break;
}
