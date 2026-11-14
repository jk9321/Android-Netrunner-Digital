/**
 * Turn goals (AI Coordinator 2026-11-12, from Jeff: "a good corp turn works towards several goals at once ... set up
 * econ behind ICE, then ice an empty remote to use later"). Jeff's Corp games (tests/fixtures/human-games, config.ai
 * 'runner') replayed, and the Normal Corp AI on the same decks (same seed plus EXTRA more), Corp turns 1-10: each click
 * labelled by the goal it served, and turns counted by how many distinct goals their clicks served, with the most common
 * pairs. Goals: money (a click for a credit, an econ operation or ability: rule 5.2.6), centrals (ice on HQ, R&D or
 * Archives), remote (ice on a remote with a card in its root), setup (an asset or upgrade installed, or ice on an empty
 * remote: for later), scoring (an agenda installed or advanced, 1.17.3a), draw, other (purge, trash, other operations).
 * AI games also count the decisions where a counted rule (money pick, ice redirect, a score line) took a click while the
 * planner's remembered line held an install plus ice onto that same server: a pair the rule broke.
 *
 *   [EXTRA=3] [SHARD=0/4] npx vite-node scripts/money-goals.ts > goals.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { cardSynergy } from '../src/ai/synergyTags';
import { installDiagnostics } from '../src/ai/diagnostics';
const diag = installDiagnostics();

const DIR = 'tests/fixtures/human-games';
const TURNS = 10;
const EXTRA = Number(process.env.EXTRA ?? 3);

function goal(s: GameState, a: GameAction): string {
  const id = 'cardInstanceId' in a ? (a as { cardInstanceId?: string }).cardInstanceId : undefined;
  const card = id ? findCardAnywhere(s, id) : undefined;
  const type = card ? cardDef(card).type_code : undefined;
  const econ = card ? (cardSynergy(cardDef(card)).gives?.econ ?? 0) > 0 : false;
  switch (a.type) {
    case 'GAIN_CREDIT':
      return 'money';
    case 'DRAW_CARD':
      return 'draw';
    case 'ADVANCE_CARD':
      return type === 'agenda' ? 'scoring' : 'setup';
    case 'PLAY_OPERATION_OR_EVENT':
      return econ ? 'money' : 'other';
    case 'USE_ABILITY':
      return econ ? 'money' : 'other';
    case 'INSTALL_CARD': {
      if (type === 'agenda') return 'scoring';
      if (type !== 'ice') return 'setup';
      const t = (a as { targetServerId?: string }).targetServerId;
      const server = t ? s.corp.servers[t] : undefined;
      if (server && !server.isRemote) return 'centrals';
      return server && server.root.length > 0 ? 'remote' : 'setup';
    }
    default:
      return 'other';
  }
}

interface Turn { goals: Record<string, number> }

class Goals {
  turns: Turn[] = [];
  observe(s: GameState, a: GameAction, n: GameState) {
    if (s.turnNumber > TURNS || s.activePlayer !== 'corp' || a.player !== 'corp' || n.corp.clicks >= s.corp.clicks) return;
    const t = (this.turns[s.turnNumber - 1] ??= { goals: {} });
    const g = goal(s, a);
    t.goals[g] = (t.goals[g] ?? 0) + (s.corp.clicks - n.corp.clicks);
  }
}

type Line = { key: string; action: GameAction }[];
/** The planner's remembered line holds an install of a root card and an ice install onto the same server (an existing one, or the new remote it makes). */
function pairOn(state: GameState, line: Line): Set<string> {
  const roots = new Set<string>();
  const ices = new Set<string>();
  for (const { action } of line) {
    if (action.type !== 'INSTALL_CARD') continue;
    const card = findCardAnywhere(state, action.cardInstanceId);
    const a = action as { targetServerId?: string; asNewRemote?: boolean };
    const where = a.asNewRemote ? 'new' : a.targetServerId && state.corp.servers[a.targetServerId] ? a.targetServerId : 'new';
    if (!card) continue;
    if (cardDef(card).type_code === 'ice') ices.add(where);
    else if (cardDef(card).type_code !== 'operation') roots.add(where);
  }
  return new Set([...roots].filter(r => ices.has(r) && (r === 'new' || r.startsWith('remote'))));
}

const out = (game: string, who: string, seed: number, g: Goals, broke?: object) => console.log(JSON.stringify({ game, who, seed, turns: g.turns, broke }));

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().filter(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')).config.ai === 'runner');
for (const [index, file] of files.entries()) {
  if (index % shards !== shard) continue;
  const report = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const { seed, corpDeck, runnerDeck } = report.config;
  let s: GameState = createInitialGameState(deckGameSetup(seed, corpDeck, runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const human = new Goals();
  for (const move of report.moves as GameAction[]) {
    let n: GameState;
    try {
      n = executeAction(s, move);
    } catch {
      break;
    }
    human.observe(s, move, n);
    s = n;
  }
  out(file, 'jeff', seed, human);
  for (let k = 0; k <= EXTRA; k++) {
    valueLoops.clear();
    const corp = createAgent('corp', 'normal') as HeuristicCorpAI;
    const game = new GameRunner(createInitialGameState(deckGameSetup(seed + k, corpDeck, runnerDeck)), { corp, runner: createAgent('runner', 'normal') });
    const ai = new Goals();
    const broke = { decisions: 0, pairLines: 0, money: 0, redirect: 0, score: 0 };
    // The planner's remembered line (private to the Corp AI; read for this measurement only)
    const memory = () => (corp as unknown as { planMemory: { line: Line } }).planMemory.line;
    for (let i = 0; i < 6000 && game.state.turnNumber <= TURNS + 1; i++) {
      const before = game.state;
      const main = before.activePlayer === 'corp' && !before.activeRun && before.pendingPrompts.length === 0 && before.corp.clicks > 0 && before.turnNumber <= TURNS;
      const m0 = diag.money.ops;
      const s0 = diag.scoreInTwo.steps + diag.scoreInTwo.vetoed;
      const lineBefore = main ? [...memory()] : [];
      if (!game.step()) break;
      ai.observe(before, game.last!, game.state);
      if (!main || game.last?.player !== 'corp' || game.last.type === 'END_TURN') continue;
      broke.decisions++;
      const line = memory().length ? memory() : lineBefore;
      const pairs = pairOn(before, [...lineBefore, ...line]);
      if (!pairs.size) continue;
      broke.pairLines++;
      const a = game.last;
      const planned = lineBefore[0]?.action;
      const agendaMove = (a.type === 'ADVANCE_CARD' || a.type === 'SCORE_AGENDA') && planned && JSON.stringify(planned) !== JSON.stringify(a);
      if (diag.money.ops > m0) broke.money++;
      else if (diag.scoreInTwo.steps + diag.scoreInTwo.vetoed > s0 || agendaMove) broke.score++;
    }
    out(file, 'ai', seed + k, ai, broke);
  }
}
