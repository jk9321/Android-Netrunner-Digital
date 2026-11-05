/**
 * Replays a player's game from a bug report and shows, at each of the player's own decisions,
 * what the AI would have done there instead (Jeff, 2026-11-05: "I play some sample games, you
 * look at what I did, then play through the same game with the AI and see where it differs").
 *
 *   node scripts/bug-report-state.mjs comment.txt > game.json
 *   npx vite-node scripts/replay-report.ts -- game.json [normal|hard] [--all]
 *
 * The report's snapshot carries the seed, both decks and every move of the game (reports sent
 * from 2026-11-05 on). Main-phase actions and rez decisions are compared; prompt answers and
 * passes only with --all. Each line: the player's move, then the AI's pick and, for main-phase
 * actions, the AI's own score for both (how far apart it thinks they are).
 */
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, HeuristicRunnerAI, createAgent } from '../src/ai';
import { rezCandidates } from '../src/ai/playout';
import type { GameConfig } from '../src/ui/savedGame';

const [file, level = 'normal', ...flags] = process.argv.slice(2).filter(a => a !== '--');
if (!file) {
  console.error('Usage: npx vite-node scripts/replay-report.ts -- game.json [normal|hard] [--all]');
  process.exit(1);
}
const all = flags.includes('--all');
const report = JSON.parse(readFileSync(file, 'utf8'));
const { config, moves, startStops } = report as { config: GameConfig; moves?: GameAction[]; startStops?: GameState['stops'] };
if (!moves?.length) {
  console.error('This report has no moves (sent before move recording, 2026-11-05).');
  process.exit(1);
}
const human = config.ai === 'corp' ? 'runner' : config.ai === 'runner' ? 'corp' : null;

let state: GameState = createInitialGameState(deckGameSetup(config.seed, config.corpDeck, config.runnerDeck));
if (startStops) state = { ...state, stops: startStops };

const title = (s: GameState, id?: string) => {
  const c: CardInstance | undefined = id ? findCardAnywhere(s, id) : undefined;
  return c ? cardDef(c).title : '?';
};
const server = (s: GameState, id?: string) => (!id ? '?' : id === 'hq' ? 'HQ' : id === 'rd' ? 'R&D' : id === 'archives' ? 'Archives' : s.corp.servers[id]?.name ?? id);

function describe(s: GameState, a: GameAction): string {
  const any = a as { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean; hostInstanceId?: string; choice?: unknown };
  switch (a.type) {
    case 'GAIN_CREDIT': return 'click for a credit';
    case 'DRAW_CARD': return 'draw';
    case 'INSTALL_CARD': return `install ${title(s, any.cardInstanceId)}${any.asNewRemote ? ' in a new remote' : any.targetServerId ? ` on ${server(s, any.targetServerId)}` : ''}${any.hostInstanceId ? ` on ${title(s, any.hostInstanceId)}` : ''}`;
    case 'PLAY_OPERATION_OR_EVENT': return `play ${title(s, any.cardInstanceId)}`;
    case 'ADVANCE_CARD': return `advance ${title(s, any.cardInstanceId)}`;
    case 'SCORE_AGENDA': return `score ${title(s, any.cardInstanceId)}`;
    case 'REZ_CARD': return `rez ${title(s, any.cardInstanceId)}`;
    case 'USE_ABILITY': return `use ${title(s, any.cardInstanceId)}`;
    case 'TRASH_RESOURCE': return `trash ${title(s, any.cardInstanceId)}`;
    case 'INITIATE_RUN': return `run ${server(s, any.targetServerId)}`;
    case 'PASS': return s.activeRun ? 'pass (no rez)' : 'pass';
    case 'END_TURN': return 'end turn';
    case 'RESOLVE_PROMPT': return `answer ${s.pendingPrompts[0]?.kind ?? 'prompt'} ${JSON.stringify(any.choice).slice(0, 80)}`;
    default: return a.type.toLowerCase().replace(/_/g, ' ');
  }
}

const same = (a: GameAction, b: GameAction) => JSON.stringify({ ...a, player: 0 }) === JSON.stringify({ ...b, player: 0 });
const mainPhase = (s: GameState) => !s.activeRun && s.pendingPrompts.length === 0 && !(s.priority && s.priority.holder !== s.activePlayer);

let agrees = 0;
let compared = 0;
let lastTurn = '';
for (const move of moves) {
  const side = move.player;
  if (side === human && move.type !== 'SET_STOPS' && actingSide(state) === side) {
    const window = state.priority && state.pendingPrompts.length === 0 && state.priority.holder !== state.activePlayer ? state.priority : null;
    const rezWindow = side === 'corp' && window && (window.step === 'approach_ice' || window.step === 'approach_server');
    const main = mainPhase(state) && state.activePlayer === side;
    if (main || rezWindow || all) {
      let ai: GameAction | null;
      if (rezWindow) ai = new HeuristicCorpAI({ synergy: level !== 'easy' }).chooseRez(state, rezCandidates(state, window!.step as 'approach_ice' | 'approach_server')) ?? { type: 'PASS', player: 'corp' };
      else ai = createAgent(side, level as 'normal' | 'hard').chooseAction(state);
      const turn = `T${state.turnNumber} ${state.activePlayer}`;
      if (turn !== lastTurn) {
        const p = side === 'corp' ? state.corp : state.runner;
        console.log(`\n${turn} — ${p.credits} credits, ${p.clicks} clicks, score ${state.corp.score}-${state.runner.score}${side === 'corp' ? `, HQ: ${state.corp.hq.map(c => cardDef(c).title).join(', ')}` : `, grip: ${state.runner.grip.map(c => cardDef(c).title).join(', ')}`}`);
        lastTurn = turn;
      }
      compared++;
      if (same(move, ai)) {
        agrees++;
        console.log(`  ✓ ${describe(state, move)}`);
      } else {
        let scores = '';
        if (main) {
          const ranked = side === 'corp' ? new HeuristicCorpAI({ synergy: true, planner: false }).rankMainActions(state) : new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(state);
          const score = (a: GameAction) => ranked.find(r => same(r.action, a))?.score;
          const yours = score(move);
          const its = score(ai);
          scores = ` (AI scores: yours ${yours?.toFixed(1) ?? '?'}, its ${its?.toFixed(1) ?? '?'})`;
        }
        console.log(`  ✗ you: ${describe(state, move)} | AI: ${describe(state, ai)}${scores}`);
      }
    }
  }
  try {
    state = executeAction(state, move);
  } catch (err) {
    console.error(`\nReplay broke at ${describe(state, move)} (${(err as Error).message}); the moves no longer fit this build.`);
    break;
  }
}
console.log(`\nThe AI agreed with ${agrees} of ${compared} decisions compared. Game ${state.winner ? `won by the ${state.winner}` : 'unfinished'}, ${state.corp.score}-${state.runner.score}.`);
