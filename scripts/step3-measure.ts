/**
 * Step 3 measurements (spec-step3-rez.md, Part B): over a set of deals (Normal v Normal), every rez the counted rez
 * (rezModel.ts countedRez) makes on approached ice, by rule (R2 a root agenda, R3 HQ, R4 R&D) and stop or toll, how
 * often it leaves the Corp under the money floor after a line (countedScore.ts afterLineFloor) counting its known
 * income, and what followed (the Runner stole on that run; the Corp's credits at its next turn start). Also the mean
 * and 95th-percentile time of a Corp decision (chooseAction and chooseRez), for the hand-off's per-decision time.
 *
 *   DEALS=1001,1211,1641,2301 [FULL=1] npx vite-node scripts/step3-measure.ts
 * (Measured while the rules had temporary switches, since deleted: the rules-off runs used PLAN_OFF with them.)
 */
import { CardInstance, GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { afterLineFloor, knownIncome } from '../src/ai/countedScore';
import { countedRez } from '../src/ai/rezModel';
import { iceCreditNeed } from '../src/ai/runs';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

applyPlanOff(process.env.PLAN_OFF ?? '');
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const deals = (process.env.DEALS ?? '').split(',').filter(Boolean).map(Number);

interface Rez { seed: number; turn: number; rule: string; credits: number; floor: number; under: boolean; stole?: boolean; nextStart?: number }
/** Corp credits at each of its turn starts, by deal (for pairing against a run with the rules off). */
const starts: Record<number, Record<number, number>> = {};
const rezzes: Rez[] = [];
const ms: number[] = [];
let games = 0;
let corpWins = 0;

function rule(state: GameState, ice: CardInstance): string {
  const run = state.activeRun!;
  const rezzed = { ...ice, rezzed: true };
  const view = { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [run.server]: { ...state.corp.servers[run.server], ice: state.corp.servers[run.server].ice.map(c => (c.instanceId === ice.instanceId ? rezzed : c)) } } } };
  const need = iceCreditNeed(view, rezzed);
  const ahead = state.corp.servers[run.server].ice.slice(0, run.icePosition).filter(c => c.rezzed).reduce((t, c) => t + iceCreditNeed(state, c), 0);
  const stop = need === Infinity || need + ahead > state.runner.credits ? 's' : 't';
  const root = state.corp.servers[run.server].root.some(c => cardDef(c).type_code === 'agenda');
  if (stop === 's' && root) return 'R2';
  return (run.server === 'hq' ? 'R3' : run.server === 'rd' ? 'R4' : 'R?') + stop;
}

for (const seed of deals) {
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  const corp = createAgent('corp', 'normal');
  // Timed and watched in place (the agent is a class instance: its other methods stay)
  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (s: GameState) => {
    const t = performance.now();
    const a = choose(s);
    ms.push(performance.now() - t);
    return a;
  };
  const chooseRez = corp.chooseRez!.bind(corp);
  let pending: Rez | null = null;
  corp.chooseRez = (s: GameState, cards: CardInstance[]) => {
    const t = performance.now();
    const a = chooseRez(s, cards);
    ms.push(performance.now() - t);
    const run = s.activeRun;
    if (a?.type === 'REZ_CARD' && run?.phase === 'approach_ice') {
      const ice = cards.find(x => x.instanceId === a.cardInstanceId);
      if (ice && cardDef(ice).type_code === 'ice' && asSide('corp', () => (decisionContext(s, 'corp'), countedRez(s, ice))) === 'rez') {
        const cost = cardDef(ice).cost ?? 0;
        const credits = s.corp.credits - cost;
        const after = { ...s, corp: { ...s.corp, credits } };
        const floor = afterLineFloor(after, '');
        const rez: Rez = { seed, turn: s.turnNumber, rule: rule(s, ice), credits, floor, under: credits + knownIncome(after) < floor };
        rezzes.push(rez);
        pending = rez;
      }
    }
    return a;
  };
  const runner = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp, runner: createAgent('runner', 'normal') });
  const open: Rez[] = [];
  let lastTurn = -1;
  for (let i = 0; i < 6000; i++) {
    const s = runner.state;
    if (s.activePlayer === 'corp' && s.turnNumber !== lastTurn) {
      lastTurn = s.turnNumber;
      (starts[seed] ??= {})[s.turnNumber] = s.corp.credits;
      for (const x of open.splice(0)) x.nextStart = s.corp.credits;
    }
    const stolen = s.runner.scoreArea.length;
    const hadRun = !!s.activeRun;
    if (!runner.step()) break;
    const after = runner.state;
    if (pending) {
      open.push(pending);
      if (after.runner.scoreArea.length > stolen) pending.stole = true;
      if (hadRun && !after.activeRun) pending = null;
    }
  }
  games++;
  if (runner.state.winner === 'corp') corpWins++;
}
const mean = (v: number[]) => (v.length ? +(v.reduce((x, y) => x + y, 0) / v.length).toFixed(2) : NaN);
const sorted = [...ms].sort((x, y) => x - y);
const byRule: Record<string, { n: number; under: number; stole: number; nextUnder3: number }> = {};
for (const x of rezzes) {
  const b = (byRule[x.rule] ??= { n: 0, under: 0, stole: 0, nextUnder3: 0 });
  b.n++;
  if (x.under) b.under++;
  if (x.stole) b.stole++;
  if ((x.nextStart ?? 99) < 3) b.nextUnder3++;
}
console.log(JSON.stringify({
  plan_off: process.env.PLAN_OFF ?? '', games, corpWins, byRule,
  under: rezzes.filter(x => x.under).map(x => `${x.seed} t${x.turn} ${x.rule} ${x.credits}cr floor ${x.floor} next ${x.nextStart ?? '-'}${x.stole ? ' stole' : ''}`),
  decisions: sorted.length, meanMs: mean(sorted), p95Ms: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
}));
if (process.env.FULL) console.log(JSON.stringify({ rezzes, starts }));
