/**
 * Money H0 (the human ledger): Jeff's Corp games (tests/fixtures/human-games, config.ai 'runner': he played the Corp
 * against the Normal Runner AI) replayed move by move, and the Normal Corp AI on the same decks against the same Runner
 * AI from the same deal seed (plus EXTRA more seeds per deck pair). For each Corp turn 1-10 the same ledger on both
 * sides: clicks by kind, income by source (every rise in the Corp's credits, rule 1.10; an operation or ability nets
 * its own cost), spending by kind, credits at turn start, ice installed and rezzed, econ cards played and how long they
 * sat in HQ first, econ cards discarded at hand size (rule 1.7.2b), agendas installed and scored. One JSON line per game.
 *
 *   [EXTRA=3] [ONLY=report-18.json] [SHARD=0/4] npx vite-node scripts/money-h0.ts > h0.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { cardSynergy } from '../src/ai/synergyTags';

const DIR = 'tests/fixtures/human-games';
const TURNS = 10;
const EXTRA = Number(process.env.EXTRA ?? 3);

const econ = (c: CardInstance) => (cardSynergy(cardDef(c)).gives?.econ ?? 0) > 0;
const kindOf = (c: CardInstance) => cardDef(c).type_code;

/** What a Corp click bought. */
function clickKind(s: GameState, a: GameAction): string {
  const id = 'cardInstanceId' in a ? (a as { cardInstanceId?: string }).cardInstanceId : undefined;
  const card = id ? findCardAnywhere(s, id) : undefined;
  switch (a.type) {
    case 'GAIN_CREDIT': return 'credit';
    case 'DRAW_CARD': return 'draw';
    case 'ADVANCE_CARD': return card && kindOf(card) === 'agenda' ? 'advance agenda' : 'advance other';
    case 'INSTALL_CARD': return !card ? 'install ?' : kindOf(card) === 'ice' ? 'install ice' : kindOf(card) === 'agenda' ? 'install agenda' : econ(card) ? 'install econ asset' : 'install asset/upgrade';
    case 'PLAY_OPERATION_OR_EVENT': return card && econ(card) ? 'econ op' : 'other op';
    case 'USE_ABILITY': return card && econ(card) ? 'econ ability' : 'ability';
    case 'PURGE_VIRUS_COUNTERS': return 'purge';
    case 'TRASH_RESOURCE': return 'trash resource';
    default: return a.type.toLowerCase();
  }
}

function spendKind(s: GameState, a: GameAction): string {
  const id = 'cardInstanceId' in a ? (a as { cardInstanceId?: string }).cardInstanceId : undefined;
  const card = id ? findCardAnywhere(s, id) : undefined;
  if (a.type === 'REZ_CARD') return card && kindOf(card) === 'ice' ? (s.activeRun ? 'rez ice in a run' : 'rez ice') : 'rez asset/upgrade';
  if (a.type === 'INSTALL_CARD') return card && kindOf(card) === 'ice' ? 'install ice' : 'install other';
  if (a.type === 'ADVANCE_CARD') return 'advance';
  if (a.type === 'PLAY_OPERATION_OR_EVENT') return 'operation';
  if (a.type === 'TRASH_RESOURCE') return 'trash resource';
  return s.activePlayer === 'runner' ? "runner's turn" : 'other';
}

interface Turn {
  start: number;
  clicks: Record<string, number>;
  income: Record<string, number>;
  spend: Record<string, number>;
  ice: number;
  iceRezzed: number;
}

class Ledger {
  turns: Turn[] = [];
  econPlayed: { turn: number; sat: number }[] = [];
  econDiscarded = 0;
  agendasInstalled: number[] = [];
  agendasScored: number[] = [];
  private seen = new Map<string, number>(); // econ card in HQ -> Corp turn first seen there
  private label = 'other'; // the last Corp click, for prompts it opened

  private turn(s: GameState): Turn | null {
    return s.turnNumber <= TURNS ? (this.turns[s.turnNumber - 1] ??= { start: NaN, clicks: {}, income: {}, spend: {}, ice: 0, iceRezzed: 0 }) : null;
  }

  /** The game's first state: the Corp's turn 1 start. */
  begin(s: GameState) {
    const t = this.turn(s)!;
    t.start = s.corp.credits;
  }

  observe(s: GameState, a: GameAction, n: GameState) {
    const t = this.turn(s);
    // Corp turn start: credits, ice
    if (n.activePlayer === 'corp' && (s.activePlayer !== 'corp' || n.turnNumber !== s.turnNumber || a.type === 'START_TURN')) {
      const nt = this.turn(n);
      if (nt && Number.isNaN(nt.start)) {
        nt.start = n.corp.credits;
        const ice = Object.values(n.corp.servers).flatMap(v => v.ice);
        nt.ice = ice.length;
        nt.iceRezzed = ice.filter(i => i.isRezzed).length;
      }
    }
    if (s.activePlayer === 'corp') for (const c of s.corp.hq) if (econ(c) && kindOf(c) === 'operation' && !this.seen.has(c.instanceId)) this.seen.set(c.instanceId, s.turnNumber);
    const click = s.activePlayer === 'corp' && n.corp.clicks < s.corp.clicks && a.player === 'corp';
    if (click) {
      this.label = clickKind(s, a);
      if (t) t.clicks[this.label] = (t.clicks[this.label] ?? 0) + (s.corp.clicks - n.corp.clicks);
      if (a.type === 'PLAY_OPERATION_OR_EVENT') {
        const card = findCardAnywhere(s, a.cardInstanceId);
        if (card && econ(card)) this.econPlayed.push({ turn: s.turnNumber, sat: s.turnNumber - (this.seen.get(card.instanceId) ?? s.turnNumber) });
      }
      if (a.type === 'INSTALL_CARD') {
        const card = findCardAnywhere(s, a.cardInstanceId);
        if (card && kindOf(card) === 'agenda') this.agendasInstalled.push(s.turnNumber);
      }
    } else if (a.type === 'START_TURN' || s.activePlayer !== 'corp') this.label = s.activePlayer === 'corp' ? 'turn start' : "runner's turn";
    else if (a.type !== 'RESOLVE_PROMPT' && a.player === 'corp') this.label = a.type === 'SCORE_AGENDA' ? 'score agenda' : a.type === 'REZ_CARD' ? 'rez' : a.type === 'USE_ABILITY' ? 'free ability' : this.label;
    if (n.corp.score > s.corp.score && s.activePlayer === 'corp') this.agendasScored.push(s.turnNumber);
    const d = n.corp.credits - s.corp.credits;
    if (t && d > 0) t.income[this.label] = (t.income[this.label] ?? 0) + d;
    if (t && d < 0) {
      // An operation or ability that nets credits shows as income above; one that costs more than it gives is spend
      const k = click || a.type !== 'RESOLVE_PROMPT' ? spendKind(s, a) : this.label;
      t.spend[k] = (t.spend[k] ?? 0) - d;
    }
    // Econ operations leaving HQ on the Corp's own turn without being played: discarded (1.7.2b)
    if (s.activePlayer === 'corp' && !(a.type === 'PLAY_OPERATION_OR_EVENT')) {
      const gone = s.corp.hq.filter(c => econ(c) && kindOf(c) === 'operation' && !n.corp.hq.some(x => x.instanceId === c.instanceId));
      for (const c of gone) if ([...n.corp.archives.faceUp, ...n.corp.archives.faceDown].some(x => x.instanceId === c.instanceId)) this.econDiscarded++;
    }
  }
}

const out = (game: string, who: string, seed: number, l: Ledger, end: GameState) =>
  console.log(JSON.stringify({ game, who, seed, winner: end.winner ?? null, turns: end.turnNumber, ledger: l.turns, econPlayed: l.econPlayed, econDiscarded: l.econDiscarded, agendasInstalled: l.agendasInstalled, agendasScored: l.agendasScored }));

// SHARD=k/n: every n-th game from the k-th (k from 0), so several processes split the games
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().filter(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')).config.ai === 'runner');
for (const [index, file] of files.entries()) {
  if (process.env.ONLY && file !== process.env.ONLY) continue;
  if (index % shards !== shard) continue;
  const report = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  if (report.config.ai !== 'runner' || !report.moves?.length) continue;
  const { seed, corpDeck, runnerDeck } = report.config;
  // Jeff's game, replayed
  let s: GameState = createInitialGameState(deckGameSetup(seed, corpDeck, runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const human = new Ledger();
  human.begin(s);
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
  out(file, 'jeff', seed, human, s);
  // The Corp AI on the same decks, same deal and EXTRA more
  for (let k = 0; k <= EXTRA; k++) {
    valueLoops.clear();
    const game = new GameRunner(createInitialGameState(deckGameSetup(seed + k, corpDeck, runnerDeck)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    const ai = new Ledger();
    ai.begin(game.state);
    for (let i = 0; i < 6000 && game.state.turnNumber <= TURNS + 1; i++) {
      const before = game.state;
      if (!game.step()) break;
      ai.observe(before, game.last!, game.state);
    }
    out(file, 'ai', seed + k, ai, game.state);
  }
}
