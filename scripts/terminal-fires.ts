/**
 * Audit Step 1 (spec-step1-terminal-price.md, bar audit-fixes/bars/terminal-price.md): one JSON line per deal, played as
 * PLAN_OFF gives (plan.terminalClock on or off). Per top-level Corp planner decision whose Runner reply met a game end in a
 * sample: the samples by winner, each sample's board less the reply root's (the baseline sampledEndWorth prices an end
 * from; `gap`: the non-terminal samples of a reply that also met an end), and, with PICKS=1, whether a
 * fresh Corp AI with terminalClock on picks differently from one with it off on the same state. Per game: winner, how it
 * ended (lossLog reasonOf), Runner points by server (lossLog steals), Corp decisions and their ms. NOHOOK=1 leaves the
 * sample hook off (its extra leaf reads) so ms is the AI's own.
 *   SEEDS=1001,1041 [PLAN_OFF=terminalClock] [PICKS=1] [SHARD=0/4] npx vite-node scripts/terminal-fires.ts > out.jsonl
 * FIX=report.json,... replays Jeff's games instead: at each Corp main-phase decision, the terminal samples and whether the
 * pick changes (fresh Corp AI, switch on vs off).
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, createInitialGameState, executeAction } from '../src/core';
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
if (process.env.FIX) {
  for (const f of process.env.FIX.split(',')) {
    const r = JSON.parse(readFileSync(f, 'utf8'));
    let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
    const out: { move: number; turn: number; corp: number; runner: number; changed: boolean }[] = [];
    let n = 0;
    for (const [i, m] of (r.moves as GameAction[]).entries()) {
      if (m.player === 'corp' && isCorpMain(s) && !activePrompt(s) && m.type !== 'START_TURN') {
        n++;
        const got: { winner: string | null }[] = [];
        replyStats.onSample = e => { if (e.winner) got.push(e); };
        const pick = (on: boolean) => { tuning.plan.terminalClock = on; valueLoops.clear(); return createAgent('corp', 'normal').chooseAction(structuredClone(s)); };
        const a = pick(false);
        const terminal = got.length;
        if (terminal) out.push({ move: i, turn: s.turnNumber, corp: got.filter(x => x.winner === 'corp').length, runner: got.filter(x => x.winner === 'runner').length, changed: !same(a, pick(true)) });
      }
      s = executeAction(s, m);
    }
    console.log(JSON.stringify({ fix: f.split('/').pop(), decisions: n, terminal: out.length, changed: out.filter(x => x.changed).length, detail: out }));
  }
  process.exit(0);
}
for (const [k, seed] of seeds.entries()) {
  if (k % shards !== shard) continue;
  const p = Math.floor((seed - 1001) / 10);
  const corpDeck = corpDecks[Math.floor(p / runnerDecks.length)];
  const runnerDeck = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  let samples: { winner: string; board: number }[] = [];
  const gaps: number[] = [];
  let cur: { winner: string | null; root: number; board: number }[] = [];
  const decisions: { turn: number; corp: number; runner: number; board: number[]; changed?: boolean }[] = [];
  let measuring = false;
  let corpDecisions = 0;
  let corpMs = 0;
  if (!process.env.NOHOOK) {
    replyStats.onSample = e => { if (!measuring) cur.push(e); };
    replyStats.onSamples = () => {
      if (cur.some(x => x.winner)) {
        for (const x of cur) if (x.winner) samples.push({ winner: x.winner, board: x.board - x.root });
        else gaps.push(x.board - x.root);
      }
      cur = [];
    };
  }
  const corp = createAgent('corp', 'normal');
  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (st: GameState) => {
    samples = [];
    const c0 = performance.now();
    const a = choose(st);
    corpDecisions++;
    corpMs += performance.now() - c0;
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
    console.log(JSON.stringify({ seed, deck: corpDeck.name, winner: rec.winner, reason: rec.reason, turns: rec.turns, score: [rec.corpScore, rec.runnerScore], stolen, alarms: rec.alarms?.reduce((m: Record<string, number>, a) => ((m[a.kind] = (m[a.kind] ?? 0) + 1), m), {}), lastSteal: rec.steals.at(-1) ? { from: rec.steals.at(-1)!.from, ice: rec.steals.at(-1)!.ice, rezzed: rec.steals.at(-1)!.rezzedIce } : null, ms: Math.round(performance.now() - t0), corpDecisions, corpMs: Math.round(corpMs), gap: gaps.length ? [gaps.length, Math.round((gaps.reduce((x, y) => x + y, 0) / gaps.length) * 10) / 10] : null, decisions }));
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
  }
}
