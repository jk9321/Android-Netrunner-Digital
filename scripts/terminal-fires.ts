/**
 * Audit Step 1 (spec-step1-terminal-price.md, bar audit-fixes/bars/terminal-price.md): one JSON line per deal, played as
 * PLAN_OFF gives (plan.terminalClock on or off). Per top-level Corp planner decision whose Runner reply met a game end in a
 * sample: the samples by winner, the board term next to the settled points (sampledEndWorth), and, with PICKS=1, whether a
 * fresh Corp AI with terminalClock on picks differently from one with it off on the same state. Per game: winner, how it
 * ended (lossLog reasonOf), Runner points by server (lossLog steals).
 *   SEEDS=1001,1041 [PLAN_OFF=terminalClock] [PICKS=1] [SHARD=0/4] npx vite-node scripts/terminal-fires.ts > out.jsonl
 */
import { GameAction, GameState, activePrompt, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff, tuning } from '../src/ai/synergy';
import { replyStats } from '../src/ai/runnerReply';
import { isCorpMain } from '../src/ai/countedScore';
import { playLogged } from './lossLog';

applyPlanOff(process.env.PLAN_OFF ?? '');
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const picks = !!process.env.PICKS;
const same = (a: GameAction, b: GameAction) => JSON.stringify(a) === JSON.stringify(b);
for (const [k, seed] of seeds.entries()) {
  if (k % shards !== shard) continue;
  const p = Math.floor((seed - 1001) / 10);
  const corpDeck = corpDecks[Math.floor(p / runnerDecks.length)];
  const runnerDeck = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  let samples: { winner: string; board: number; settled: number; old: number }[] = [];
  const decisions: { turn: number; corp: number; runner: number; board: number[]; changed?: boolean }[] = [];
  let measuring = false;
  replyStats.onTerminal = e => { if (!measuring) samples.push(e); };
  const corp = createAgent('corp', 'normal');
  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (st: GameState) => {
    samples = [];
    const a = choose(st);
    if (samples.length && isCorpMain(st) && !activePrompt(st)) {
      const d: (typeof decisions)[number] = { turn: st.turnNumber, corp: samples.filter(x => x.winner === 'corp').length, runner: samples.filter(x => x.winner === 'runner').length, board: samples.map(x => Math.round(x.board)) };
      if (picks) {
        measuring = true;
        const was = tuning.plan.terminalClock;
        const pick = (on: boolean) => { tuning.plan.terminalClock = on; valueLoops.clear(); return createAgent('corp', 'normal').chooseAction(structuredClone(st)); };
        try {
          d.changed = !same(pick(true), pick(false));
        } finally {
          tuning.plan.terminalClock = was;
          measuring = false;
        }
      }
      decisions.push(d);
    }
    return a;
  };
  const t0 = performance.now();
  try {
    const rec = playLogged(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDeck)), { corp, runner: createAgent('runner', 'normal') }, { corp: corpDeck.name, runner: runnerDeck.name });
    const stolen: Record<string, number> = {};
    for (const s of rec.steals) stolen[s.from] = (stolen[s.from] ?? 0) + s.points;
    console.log(JSON.stringify({ seed, deck: corpDeck.name, winner: rec.winner, reason: rec.reason, turns: rec.turns, score: [rec.corpScore, rec.runnerScore], stolen, alarms: rec.alarms?.reduce((m: Record<string, number>, a) => ((m[a.kind] = (m[a.kind] ?? 0) + 1), m), {}), lastSteal: rec.steals.at(-1) ? { from: rec.steals.at(-1)!.from, ice: rec.steals.at(-1)!.ice, rezzed: rec.steals.at(-1)!.rezzedIce } : null, ms: Math.round(performance.now() - t0), decisions }));
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
  }
}
