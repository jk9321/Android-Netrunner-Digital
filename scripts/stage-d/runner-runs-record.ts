/**
 * Stage D item 2, step 1b (brief section 4): every Runner turn of the recorded games, with what a predictor of that
 * turn's runs could read at its start. One JSON line per Runner turn; runner-runs-counts.mjs scores the predictors.
 *
 * Sources (scripts/stage-a/harness.ts):
 *  - the 36 human games (tests/fixtures/human-games/), replayed move for move: `who` = 'person' when a person played
 *    the Runner (config.ai === 'corp'), 'ai' when the AI did;
 *  - the 56 local deals, played out Normal v Normal on this tree: `who` = 'self'.
 *
 * A Runner turn starts at the first state of the turn where the Runner acts (its clicks spent from there); its runs are
 * the engine's record of that turn (state.runnerLastTurnRuns once it ends, state.runsThisTurn if the game ends in it:
 * src/core/engine/actions/turn.ts). Rules: the Runner announces the server it runs (6.1.2a, 6.9.1a), so every field
 * here is public, except `corpStake` (the Corp's own knowledge, for the readers it would feed) which no predictor reads.
 *
 * Per server at the turn's start: kind (hq, rd, archives, remote), the remote's public facts (root cards, facedown
 * ones, advancement counters, ice, rezzed ice), `odds` (the Runner's own view of an agenda behind it, runs.ts
 * remoteAgendaOdds; HQ and R&D the deck-wide unseen pool, effectValues agendaOdds; Archives its faceup agendas, or the
 * chosen-discard odds of its facedown cards), `points` (the pool's mean agenda points), and `holds` (the hold count:
 * serverHold 'runnerTurn' with the Corp's credits now, src/ai/corp/hold.ts; read, not edited) with its `entries`.
 *
 *   SHARD=0/4 npx vite-node scripts/stage-d/runner-runs-record.ts > rr-0.jsonl
 *   DEALS=none npx vite-node scripts/stage-d/runner-runs-record.ts   (human games only)
 */
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { serverHold, holdCacheStats } from '../../src/ai/corp/hold';
import { remoteAgendaOdds } from '../../src/ai/runs';
import { agendaOdds } from '../../src/ai/effectValues';
import { stake } from '../../src/ai/corp/pools';
import { clearCaches, dealState, deals, humanFiles } from '../stage-a/harness';

type Who = 'person' | 'ai' | 'self';
interface ServerFacts {
  id: string;
  kind: 'hq' | 'rd' | 'archives' | 'remote';
  root: number;
  facedown: number;
  adv: number;
  ice: number;
  rezzedIce: number;
  odds: number;
  points: number;
  holds: boolean | null;
  entries: number | null;
  corpStake: number;
}
interface TurnLine {
  src: string;
  who: Who;
  turn: number;
  runnerScore: number;
  corpScore: number;
  runnerCredits: number;
  corpCredits: number;
  servers: ServerFacts[];
  /** kind: 'chosen' (the Runner's own INITIATE_RUN) or 'offered' (started by any other action: a card's offer, a run event). */
  runs: { server: string; successful: boolean; kind: 'chosen' | 'offered' }[];
  holdMs: number;
}

const ARCHIVES_CHOSEN = 0.05; // runs.ts ARCHIVES_CHOSEN_ODDS (not exported): a facedown Archives card the Corp chose to discard

function facts(state: GameState): { servers: ServerFacts[]; holdMs: number } {
  const t = performance.now();
  clearCaches();
  const runnerView = asSide('runner', () => {
    decisionContext(state, 'runner');
    const pool = agendaOdds(state);
    return Object.values(state.corp.servers).map(v => {
      const hidden = v.root.filter((c: CardInstance) => !c.isRezzed && !c.faceUp && !c.runnerKnows);
      let odds: number;
      if (v.id === 'hq' || v.id === 'rd') odds = pool.odds;
      else if (v.id === 'archives') odds = state.corp.archives.faceUp.some(c => cardDef(c).type_code === 'agenda') ? 1 : state.corp.archives.faceDown.length ? 1 - (1 - ARCHIVES_CHOSEN * pool.odds) ** state.corp.archives.faceDown.length : 0;
      else odds = hidden.length ? Math.max(...hidden.map(c => remoteAgendaOdds(state, v, c, 1 / 3))) : 0;
      return { id: v.id, odds, points: pool.points };
    });
  });
  clearCaches();
  const servers = asSide('corp', () => {
    decisionContext(state, 'corp');
    return Object.values(state.corp.servers).map((v, i): ServerFacts => {
      let holds: boolean | null = null;
      let entries: number | null = null;
      try {
        const h = serverHold(state, v.id, { when: 'runnerTurn', corpCredits: state.corp.credits });
        holds = h.holds;
        entries = h.entries;
      } catch {
        /* a board the count cannot read: left null */
      }
      const kind = v.id === 'hq' || v.id === 'rd' || v.id === 'archives' ? v.id : 'remote';
      return {
        id: v.id,
        kind,
        root: v.root.length,
        facedown: v.root.filter(c => !c.isRezzed && !c.faceUp).length,
        adv: v.root.reduce((n, c) => n + (c.advancementCounters ?? 0), 0),
        ice: v.ice.length,
        rezzedIce: v.ice.filter(c => c.isRezzed).length,
        odds: runnerView[i].odds,
        points: runnerView[i].points,
        holds,
        entries,
        corpStake: stake(state, v.id).loss,
      };
    });
  });
  return { servers, holdMs: Math.round(performance.now() - t) };
}

/** Watches a game state by state; emits a line at the end of each Runner turn. */
function watcher(src: string, who: Who) {
  let open: Omit<TurnLine, 'runs'> | null = null;
  let opened = -1;
  let kinds: ('chosen' | 'offered')[] = [];
  let seen = 0;
  const close = (runs: { server: string; successful: boolean }[]) => {
    if (open) console.log(JSON.stringify({ ...open, runs: runs.map((r, i) => ({ server: r.server, successful: r.successful, kind: kinds[i] ?? 'offered' })) }));
    open = null;
  };
  return {
    /** `move`: the action that led to `s` (its runs started by it get its kind). */
    see(s: GameState, move?: GameAction) {
      if (open && s.activePlayer === 'runner' && s.turnNumber === open.turn && s.runsThisTurn.length > seen) {
        for (let i = seen; i < s.runsThisTurn.length; i++) kinds[i] = move?.type === 'INITIATE_RUN' ? 'chosen' : 'offered';
        seen = s.runsThisTurn.length;
      }
      // The Runner's turn has ended: its runs are the engine's record of it
      if (open && (s.activePlayer === 'corp' || s.turnNumber !== open.turn)) close(s.runnerLastTurnRuns);
      if (!open && opened !== s.turnNumber && s.activePlayer === 'runner' && !s.winner && s.runner.clicks > 0 && !s.activeRun) {
        opened = s.turnNumber;
        kinds = [];
        seen = s.runsThisTurn.length;
        const f = facts(s);
        open = { src, who, turn: s.turnNumber, runnerScore: s.runner.score, corpScore: s.corp.score, runnerCredits: s.runner.credits, corpCredits: s.corp.credits, ...f };
      }
    },
    end(s: GameState) {
      if (open) close(s.runsThisTurn);
    },
  };
}

function replay(file: string) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (!report.moves?.length) return;
  const who: Who = report.config.ai === 'corp' ? 'person' : 'ai';
  valueLoops.clear();
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const w = watcher(`human:${file.split('/').pop()}`, who);
  w.see(s);
  for (const move of report.moves as GameAction[]) {
    try {
      s = executeAction(s, move);
    } catch {
      break; // a fixture recorded on an older engine: read up to here (as the harness)
    }
    w.see(s, move);
  }
  w.end(s);
}

function selfPlay(seed: number) {
  valueLoops.clear();
  const game = new GameRunner(dealState(seed), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const w = watcher(`deal:${seed}`, 'self');
  w.see(game.state);
  for (let n = 0; n < 4000; n++) {
    clearCaches();
    if (!game.step()) break;
    w.see(game.state, game.last ?? undefined);
  }
  w.end(game.state);
}

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const sources: (() => void)[] = [...humanFiles().map(f => () => replay(f)), ...deals().map(seed => () => selfPlay(seed))];
sources.forEach((run, k) => {
  if (k % shards === shard) {
    try {
      run();
    } catch (e) {
      console.error(`source ${k}: ${(e as Error).message}`);
    }
  }
});
console.error(JSON.stringify({ shard, holdAsked: holdCacheStats.asked, holdSearched: holdCacheStats.searched }));
