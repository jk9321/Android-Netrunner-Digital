/**
 * Money step M1 (plan.moneyFirst): on the decisions where moneyPick took the click, what the Corp would have played
 * instead (the same agent's judgement with the switch off: a fresh Corp AI holding the same two-turn line), whether that
 * action was still played later the same turn, and whether HQ held an agenda with none in a remote at the turn's end.
 * One JSON line per deal.
 *
 *   SEEDS=1431,1853 PLAN_OFF=+moneyFirst npx vite-node scripts/money-displaced.ts
 */
import { GameAction, GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { moneyStats } from '../src/ai/incomeLine';

applyPlanOff(process.env.PLAN_OFF ?? '+moneyFirst');

const kind = (s: GameState, a: GameAction): string => {
  const id = (a as { cardInstanceId?: string }).cardInstanceId;
  const c = id ? s.corp.hq.find(x => x.instanceId === id) : undefined;
  const t = c ? cardDef(c).type_code : '';
  if (a.type === 'INSTALL_CARD') return `install ${t}`;
  if (a.type === 'PLAY_OPERATION_OR_EVENT') return 'operation';
  return a.type.toLowerCase();
};
const same = (a: GameAction, b: GameAction) => JSON.stringify(a) === JSON.stringify(b);
const agendaOnlyInHq = (s: GameState) => s.corp.hq.some(c => cardDef(c).type_code === 'agenda') && !Object.values(s.corp.servers).some(v => v.isRemote && v.root.some(c => cardDef(c).type_code === 'agenda'));

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  const start = createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
  const corp = createAgent('corp', 'normal') as HeuristicCorpAI;
  const events: { turn: number; displaced: string; heldLine: boolean; agendaInHq: boolean; laterSameTurn?: boolean; agendaOnlyInHqAtEnd?: boolean }[] = [];
  const pending: { ev: (typeof events)[number]; action: GameAction }[] = [];
  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (s: GameState) => {
    const before = moneyStats.ops;
    const a = choose(s);
    for (const q of pending) if (q.ev.turn === s.turnNumber && q.ev.laterSameTurn === false && same(q.action, a)) q.ev.laterSameTurn = true;
    if (moneyStats.ops > before && a.type === 'PLAY_OPERATION_OR_EVENT') {
      const held = (corp as unknown as { heldLine: unknown }).heldLine;
      applyPlanOff('moneyFirst');
      const shadow = new HeuristicCorpAI({ synergy: true });
      (shadow as unknown as { heldLine: unknown }).heldLine = held ? structuredClone(held) : null;
      let other: GameAction;
      try {
        other = shadow.chooseAction(s);
      } finally {
        applyPlanOff('+moneyFirst');
      }
      if (!same(other, a)) {
        const ev = { turn: s.turnNumber, displaced: kind(s, other), heldLine: !!held, agendaInHq: s.corp.hq.some(c => cardDef(c).type_code === 'agenda'), laterSameTurn: false };
        events.push(ev);
        pending.push({ ev, action: other });
      }
    }
    return a;
  };
  const game = new GameRunner(start, { corp, runner: createAgent('runner', 'normal') });
  let prev = game.state;
  for (let i = 0; i < 6000 && game.step(); i++) {
    const s = game.state;
    if (prev.activePlayer === 'corp' && s.activePlayer === 'runner') for (const e of events) if (e.turn === prev.turnNumber && e.agendaOnlyInHqAtEnd === undefined) e.agendaOnlyInHqAtEnd = agendaOnlyInHq(prev);
    prev = s;
  }
  console.log(JSON.stringify({ seed, winner: game.state.winner ?? null, events }));
}
