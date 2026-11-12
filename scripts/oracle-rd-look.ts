/**
 * What plan.oracle.rd changes (oracle split, 2026-11-12): per game-0 deal, the Corp's draw clicks (and how many drew an
 * agenda), ice it installs on R&D, agendas the Runner steals from R&D, agendas the Corp scores. Run once with
 * PLAN_OFF=+oracle.rd and once without.  SEEDS=1001,1011 npx vite-node scripts/oracle-rd-look.ts
 */
import { GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';

applyPlanOff(process.env.PLAN_OFF ?? '');
const isAgenda = (c: { cardCode: string }) => cardDef(c as never).type_code === 'agenda';
function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  const start = createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  const o = { draws: 0, drawAgenda: 0, rdIce: 0, rdSteals: 0, scores: 0, corpTurns: 0 };
  let lastTurn = -1;
  const pick = corp.chooseAction.bind(corp);
  corp.chooseAction = (s: GameState) => {
    const a = pick(s);
    if (s.activePlayer === 'corp' && !s.activeRun && !s.turnStep && s.pendingPrompts.length === 0) {
      if (s.turnNumber !== lastTurn) { lastTurn = s.turnNumber; o.corpTurns++; }
      const top = s.corp.rd[0];
      if (a.type === 'DRAW_CARD') { o.draws++; if (top && isAgenda(top)) o.drawAgenda++; }
      if (a.type === 'INSTALL_CARD' && (a as { targetServerId?: string }).targetServerId === 'rd') o.rdIce++;
    }
    return a;
  };
  let prev = start;
  const game = new GameRunner(start, { corp, runner });
  for (let i = 0; i < 6000; i++) {
    const s = game.state;
    const had = new Set(prev.runner.scoreArea.map(x => x.instanceId));
    for (const x of s.runner.scoreArea) if (!had.has(x.instanceId) && prev.corp.rd.some(y => y.instanceId === x.instanceId)) o.rdSteals++;
    o.scores += s.corp.scoreArea.filter(x => !prev.corp.scoreArea.some(y => y.instanceId === x.instanceId)).length;
    prev = s;
    if (!game.step()) break;
  }
  return { seed, winner: game.state.winner, ...o };
}
for (const seed of (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number)) console.log(JSON.stringify(playDeal(seed)));
