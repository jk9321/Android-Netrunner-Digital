/**
 * Fire counts for spec-match-point-rez.md (bar redesign/bars/match-point-rez.md). The Normal Corp against the Normal
 * Runner on the given deals (mapped as scripts/corp-losses.ts); or Jeff's games replayed move by move
 * (REPORTS=48,49,50,51). At every Corp rez window (the agent's chooseRez):
 *   e1: windows where the match-point rule decides (rezModel matchPoint), whether the Corp rezzed, by server and by the
 *       band of the chance a card that wins the game is among the cards accessed (R&D: by the Corp's list; else known);
 *       each one is printed to stderr;
 *   r4Skip (count only): R&D windows with an agenda in HQ, off match point, with what R4 would answer without its HQ
 *       condition, whether the rez stops the run (rezStops), and the points stolen in that run;
 *   gap (count only): HQ/R&D approach-ice windows off match point where the Corp passed on an affordable ice whose rez
 *       stops the run, and whether the Runner then stole an agenda in that run.
 * Also per game: match-point windows the Corp passed where the Runner then won in that run (lost at match point), and
 * after a match-point rez the Corp's credits and whether the game went on. One JSON line per game. Replayed games list
 * the match-point windows where the recorded move was not the rez.
 *
 *   SEEDS=1001,1041 [SHARD=0/4] npx vite-node scripts/match-point-fires.ts > fires.jsonl
 *   REPORTS=48,49,50,51 npx vite-node scripts/match-point-fires.ts
 */
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, isLegalAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { sideCards, valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { matchPoint, rezStops } from '../src/ai/corp/rez';
import { agendasUnseen } from '../src/ai/corp/pools';

applyPlanOff(process.env.PLAN_OFF ?? '');

type Agent = ReturnType<typeof createAgent>;
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';

/** The chance a game-winning agenda is among the cards this run accesses, by what the Corp knows (R&D: its list). */
function winOdds(s: GameState): number {
  const run = s.activeRun!;
  if (run.server !== 'rd') return 1;
  const need = 7 - s.runner.score;
  const known = new Set([...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => v.root), ...s.corp.scoreArea, ...s.runner.scoreArea, ...s.corp.archives.faceUp, ...s.corp.archives.faceDown].map(c => c.instanceId));
  const pool = sideCards(s, 'corp').filter(c => isAgenda(c) && !known.has(c.instanceId) && (cardDef(c).agenda_points ?? 0) >= need).length;
  const n = s.corp.rd.length;
  const k = Math.min(n, 1 + run.extraAccesses);
  // 1 - C(n - pool, k) / C(n, k): at least one of the k accessed is one of them
  let miss = 1;
  for (let i = 0; i < k; i++) miss *= Math.max(0, n - pool - i) / (n - i);
  return 1 - miss;
}
const band = (p: number) => (p < 0.1 ? 'under10' : p <= 0.2 ? '10to20' : 'over20');

interface Count {
  e1: number;
  e1Rezzed: number;
  e1Bands: Record<string, number>;
  e1Servers: Record<string, number>;
  gapWindows: number;
  gapStolen: number;
  lostAtMatch: number;
  afterRez: { credits: number; gameWent: boolean }[];
  r4Skip: { turn: number; ice: string; r4: string; stops: boolean; rezzed: boolean; corpCredits: number; runnerCredits: number; runnerScore: number; unseen: number; rd: number; stole?: number }[];
}
const fresh = (): Count => ({ e1: 0, e1Rezzed: 0, e1Bands: {}, e1Servers: {}, gapWindows: 0, gapStolen: 0, lostAtMatch: 0, afterRez: [], r4Skip: [] });

/** Wraps the Corp's chooseRez: the decision as played, and what the match-point rule and R4 read at each window. */
function watch(corp: Agent, c: Count, pending: { gap?: string; match?: boolean; rezTurn?: number; r4?: number }) {
  const choose = corp.chooseRez!.bind(corp);
  corp.chooseRez = (s: GameState, cards: CardInstance[]) => {
    const played = choose(s, cards);
    const run = s.activeRun;
    if (!run) return played;
    if (run.phase !== 'approach_ice' || run.icePosition === null) return played;
    const ice = s.corp.servers[run.server]?.ice[run.icePosition];
    if (!ice || ice.isRezzed || !isLegalAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId })) return played;
    const rezzes = (a: GameAction | null) => a?.type === 'REZ_CARD' && (a as { cardInstanceId: string }).cardInstanceId === ice.instanceId;
    const mp = asSide('corp', () => matchPoint(s, ice));
    // R4's skip (count only): an R&D window with an agenda in HQ, where R4 would have answered without that condition
    const hqAgendas = s.corp.hq.filter(isAgenda).length;
    if (run.server === 'rd' && hqAgendas > 0 && !mp) {
      const unseen = agendasUnseen(s);
      const stops = asSide('corp', () => rezStops(s, ice));
      const r4 = unseen > 0 ? 'rez' : 'none';
      c.r4Skip.push({ turn: s.turnNumber, ice: cardDef(ice).title, r4, stops, rezzed: rezzes(played), corpCredits: s.corp.credits, runnerCredits: s.runner.credits, runnerScore: s.runner.score, unseen, rd: s.corp.rd.length });
      pending.r4 = c.r4Skip.length - 1;
    }
    if (mp) {
      c.e1++;
      c.e1Servers[s.corp.servers[run.server].isRemote ? 'remote' : run.server] = (c.e1Servers[s.corp.servers[run.server].isRemote ? 'remote' : run.server] ?? 0) + 1;
      const b = band(winOdds(s));
      c.e1Bands[b] = (c.e1Bands[b] ?? 0) + 1;
      if (rezzes(played)) {
        c.e1Rezzed++;
        console.error(`fire T${s.turnNumber} ${cardDef(ice).title} on ${run.server} pos ${run.icePosition}: Corp ${s.corp.credits} cr, rez ${cardDef(ice).cost}; Runner ${s.runner.score} pts ${s.runner.credits} cr, odds ${winOdds(s).toFixed(2)}`);
      }
      if (!rezzes(played)) pending.match = true;
    } else if ((run.server === 'hq' || run.server === 'rd') && !rezzes(played) && asSide('corp', () => rezStops(s, ice))) {
      c.gapWindows++;
      pending.gap = run.server;
    }
    return played;
  };
}

/** Bookkeeping after each step: steals and wins during a run the Corp let through, credits after a match-point rez. */
function after(s: GameState, n: GameState, a: GameAction | null, c: Count, pending: { gap?: string; match?: boolean; rezTurn?: number; rezCredits?: number; r4?: number }) {
  const stole = n.runner.scoreArea.length > s.runner.scoreArea.length;
  if (pending.gap && stole) {
    c.gapStolen++;
    pending.gap = undefined;
  }
  if (pending.match && n.winner === 'runner') c.lostAtMatch++;
  if (pending.r4 !== undefined && stole) {
    const e = c.r4Skip[pending.r4];
    e.stole = (e.stole ?? 0) + n.runner.scoreArea.filter(x => !s.runner.scoreArea.some(y => y.instanceId === x.instanceId)).reduce((k, x) => k + (cardDef(x).agenda_points ?? 0), 0);
  }
  if (a?.type === 'REZ_CARD' && s.activeRun && asSide('corp', () => {
    const ice = s.corp.servers[s.activeRun!.server]?.ice.find(x => x.instanceId === (a as { cardInstanceId: string }).cardInstanceId);
    return !!ice && matchPoint(s, ice);
  })) {
    pending.rezTurn = n.turnNumber;
    pending.rezCredits = n.corp.credits;
  }
  if (!n.activeRun) {
    pending.r4 = undefined;
    pending.gap = undefined;
    pending.match = false;
  }
  if (pending.rezTurn !== undefined && (n.turnNumber > pending.rezTurn + 1 || n.winner)) {
    c.afterRez.push({ credits: pending.rezCredits ?? 0, gameWent: !n.winner || n.turnNumber > pending.rezTurn + 1 });
    pending.rezTurn = undefined;
  }
}

const reports = (process.env.REPORTS ?? '').split(',').filter(Boolean).map(Number);
if (reports.length) {
  for (const r of reports) {
    const report = JSON.parse(readFileSync(`tests/fixtures/human-games/report-${r}.json`, 'utf8'));
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    valueLoops.clear();
    const c = fresh();
    const pending: { gap?: string; match?: boolean; r4?: number } = {};
    const corp = createAgent('corp', 'normal');
    watch(corp, c, pending);
    const fires: string[] = [];
    for (const [i, m] of (report.moves as GameAction[]).entries()) {
      const run = s.activeRun;
      if (run && m.player === 'corp' && run.phase === 'approach_ice' && run.icePosition !== null) {
        const ice = s.corp.servers[run.server]?.ice[run.icePosition];
        if (ice && !ice.isRezzed) {
          const mp = asSide('corp', () => matchPoint(s, ice));
          const pick = corp.chooseRez!(s, [ice]);
          if (m.type !== 'REZ_CARD' && mp) pending.match = true;
          if (mp && m.type !== 'REZ_CARD') fires.push(`#${i} T${s.turnNumber} ${cardDef(ice).title} on ${run.server}: played ${m.type}, arm ${pick?.type ?? 'pass'}`);
        }
      }
      const n = executeAction(s, m);
      after(s, n, m, c, pending);
      s = n;
    }
    console.log(JSON.stringify({ report: r, winner: s.winner ?? null, ...c, fires }));
  }
} else {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
  for (const [i, seed] of seeds.entries()) {
    if (i % shards !== shard) continue;
    const p = Math.floor((seed - 1001) / 10);
    const corpDeck = corpDecks[Math.floor(p / runnerDecks.length)];
    valueLoops.clear();
    const c = fresh();
    const pending: { gap?: string; match?: boolean; r4?: number } = {};
    const corp = createAgent('corp', 'normal');
    watch(corp, c, pending);
    const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDecks[p % runnerDecks.length])), { corp, runner: createAgent('runner', 'normal') });
    try {
      for (let k = 0; k < 8000; k++) {
        const s = game.state;
        if (!game.step()) break;
        after(s, game.state, game.last ?? null, c, pending);
      }
    } catch (err) {
      console.error(`deal ${seed}: ${err}`);
      continue;
    }
    console.log(JSON.stringify({ seed, deck: corpDeck.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, ...c }));
  }
}
