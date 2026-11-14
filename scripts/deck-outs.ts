/**
 * Why self-play games end with the Corp decked (Jeff, 2026-11-06: "is some logic bug making both
 * sides stop playing to score?"). Plays the same deals as scripts/corp-losses.ts and prints one
 * line of JSON per game: how both sides spent their clicks, all game and over the last 3 turns
 * each, plus agendas held in HQ, cards left in the Stack and so on. deck-outs-sum.mjs compares the
 * decked games with the rest.
 *
 *   npx vite-node scripts/deck-outs.ts -- [games per pairing] [normal|hard]
 */
import { CardInstance, GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { NRDB_TEST_DECKS } from './nrdb-test-decks';
import { GameRunner, createAgent } from '../src/ai';
import { applyPlanOff } from '../src/ai/synergy';

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
applyPlanOff(process.env.PLAN_OFF ?? '');
const DECKS = [...ALL_DECKS, ...(process.env.NRDB ? NRDB_TEST_DECKS : [])];
const prefixes = (process.env.DECKS ?? '').split(',').filter(Boolean);
const inPool = (id: string) => prefixes.length === 0 || prefixes.some(p => id.startsWith(p));
const corpDecks = DECKS.filter(d => d.side === 'corp' && inPool(d.id));
const runnerDecks = DECKS.filter(d => d.side === 'runner' && inPool(d.id));
const from = Number(process.env.GAME_FROM ?? 0);
const stride = Math.max(10, games);
const onlySeed = Number(process.env.SEED ?? 0);

type Turn = { side: 'corp' | 'runner'; rd: number; credits: number; hqAgendas: number; stack: number; grip: number; clicks: Record<string, number>; runs: number };
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';

function play(state: GameState, seed: number) {
  const g = new GameRunner(state, { corp: createAgent('corp', level, {}), runner: createAgent('runner', level, {}) });
  const turns: Turn[] = [];
  let key = '';
  let cur: Turn | null = null;
  const deckSize = state.corp.rd.length + state.corp.hq.length;
  while (!g.state.winner) {
    const s = g.state;
    if (`${s.turnNumber}${s.activePlayer}` !== key) {
      key = `${s.turnNumber}${s.activePlayer}`;
      cur = {
        side: s.activePlayer, rd: s.corp.rd.length, credits: s[s.activePlayer].credits, hqAgendas: s.corp.hq.filter(isAgenda).length,
        stack: s.runner.stack.length, grip: s.runner.grip.length, clicks: {}, runs: 0,
      };
      turns.push(cur);
    }
    const before = s;
    if (!g.step()) break;
    const a = g.last;
    // Main-phase click actions of the side whose turn it is
    if (cur && a && a.player === before.activePlayer && before.pendingPrompts.length === 0 && !before.activeRun && before[before.activePlayer].clicks > g.state[before.activePlayer].clicks) {
      cur.clicks[a.type] = (cur.clicks[a.type] ?? 0) + 1;
      if (a.type === 'INITIATE_RUN' || (a.type === 'PLAY_OPERATION_OR_EVENT' && g.state.activeRun)) cur.runs++;
    }
  }
  const s = g.state;
  const sum = (ts: Turn[], k: string) => ts.reduce((n, t) => n + (t.clicks[k] ?? 0), 0);
  const corpT = turns.filter(t => t.side === 'corp');
  const runT = turns.filter(t => t.side === 'runner');
  const lastC = corpT.slice(-3);
  const lastR = runT.slice(-3);
  return {
    seed, winner: s.winner, reason: s.winReason, turns: s.turnNumber, deckSize,
    corpScore: s.corp.score, runnerScore: s.runner.score,
    corp: { draws: sum(corpT, 'DRAW_CARD'), credits: sum(corpT, 'GAIN_CREDIT'), clicks: corpT.reduce((n, t) => n + Object.values(t.clicks).reduce((a, b) => a + b, 0), 0), turns: corpT.length,
      // voluntary draws once R&D was down to 10 cards or fewer
      lateDraws: sum(corpT.filter(t => t.rd <= 10), 'DRAW_CARD'),
      last3: { draws: sum(lastC, 'DRAW_CARD'), credits: sum(lastC, 'GAIN_CREDIT'), advance: sum(lastC, 'ADVANCE_CARD'), install: sum(lastC, 'INSTALL_CARD'), ops: sum(lastC, 'PLAY_OPERATION_OR_EVENT'), score: sum(lastC, 'SCORE_AGENDA') },
      // Corp turns started with an agenda in HQ, and the most at once
      agendaTurns: corpT.filter(t => t.hqAgendas > 0).length, maxHqAgendas: Math.max(0, ...corpT.map(t => t.hqAgendas)),
      endCredits: s.corp.credits, endHqAgendas: s.corp.hq.filter(isAgenda).length,
      endInstalledAgendas: Object.values(s.corp.servers).flatMap(v => v.root).filter(isAgenda).length },
    runner: { runs: runT.reduce((n, t) => n + t.runs, 0), turns: runT.length, credits: sum(runT, 'GAIN_CREDIT'), draws: sum(runT, 'DRAW_CARD'),
      last3: { runs: lastR.reduce((n, t) => n + t.runs, 0), credits: sum(lastR, 'GAIN_CREDIT'), draws: sum(lastR, 'DRAW_CARD'), bank: lastR.map(t => t.credits) },
      endStack: s.runner.stack.length, endGrip: s.runner.grip.length, endCredits: s.runner.credits,
      stackOutTurn: (runT.find(t => t.stack === 0) ? runT.findIndex(t => t.stack === 0) : -1) },
  };
}

let pairing = 0;
let deal = 0;
for (const c of corpDecks) {
  for (const r of runnerDecks) {
    pairing++;
    for (let gm = from; gm < games; gm++) {
      const seed = 1000 + (pairing - 1) * stride + gm + 1;
      if (onlySeed && seed !== onlySeed) { deal++; continue; }
      if (deal++ % shards !== shard) continue;
      try {
        console.log(JSON.stringify({ corpDeck: c.name, runnerDeck: r.name, ...play(createInitialGameState(deckGameSetup(seed, c, r)), seed) }));
      } catch (err) {
        console.error(`deal ${seed}: ${err}`);
      }
    }
  }
}
