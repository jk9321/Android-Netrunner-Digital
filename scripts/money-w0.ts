/**
 * Money W0, the draw-click cut (AI Coordinator 2026-11-12, after turn goals: the AI spends 0.33 clicks a turn drawing
 * against Jeff's 0.16). Jeff's Corp games (tests/fixtures/human-games, config.ai 'runner') replayed, and the Normal
 * Corp AI on the same decks (same seed plus EXTRA more), Corp turns 1-10. Every Corp click is recorded with the
 * position it was taken in: credits, clicks left, what HQ held (agendas, ice, econ cards, other) and what of it was
 * legal to install or play, ice on HQ and R&D, remotes with a card in the root and their ice. For a draw click (rule
 * 5.6.2: the Corp may spend a click to draw a card) the card drawn is followed: its type and the turn it left HQ, and how
 * (installed, played, discarded at hand size 1.7.2b, or still in HQ at T10). The summary, scripts/money-w0-sum.mjs,
 * compares the positions the AI drew in with what Jeff's clicks did in the same kind of position.
 *
 *   [EXTRA=3] [SHARD=0/4] npx vite-node scripts/money-w0.ts > w0.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere, getLegalActions } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { cardSynergy } from '../src/ai/synergyTags';

const DIR = 'tests/fixtures/human-games';
const TURNS = 10;
const EXTRA = Number(process.env.EXTRA ?? 3);

const econ = (c: CardInstance) => (cardSynergy(cardDef(c)).gives?.econ ?? 0) > 0;
const type = (c: CardInstance) => cardDef(c).type_code;
const bucket = (c: CardInstance) => (type(c) === 'agenda' ? 'agenda' : type(c) === 'ice' ? 'ice' : econ(c) ? 'econ' : 'other');

function kind(s: GameState, a: GameAction): string {
  const id = 'cardInstanceId' in a ? (a as { cardInstanceId?: string }).cardInstanceId : undefined;
  const card = id ? findCardAnywhere(s, id) : undefined;
  switch (a.type) {
    case 'GAIN_CREDIT': return 'credit';
    case 'DRAW_CARD': return 'draw';
    case 'ADVANCE_CARD': return card && type(card) === 'agenda' ? 'advance agenda' : 'advance other';
    case 'INSTALL_CARD': return card ? `install ${bucket(card)}` : 'install ?';
    case 'PLAY_OPERATION_OR_EVENT': return card && econ(card) ? 'econ op' : 'other op';
    case 'USE_ABILITY': return card && econ(card) ? 'econ ability' : 'ability';
    default: return a.type.toLowerCase();
  }
}

interface Click {
  turn: number;
  kind: string;
  credits: number;
  clicksLeft: number;
  hq: Record<string, number>;
  /** HQ cards legal to install or play now, by bucket (agendas included) */
  playable: Record<string, number>;
  hqIce: number;
  rdIce: number;
  /** Remotes with a card in the root: their ice counts */
  remotes: number[];
  rd: number;
}

interface Drawn { turn: number; type: string; left?: number; how?: string }

function position(s: GameState, a: GameAction): Click {
  const hq: Record<string, number> = {};
  for (const c of s.corp.hq) hq[bucket(c)] = (hq[bucket(c)] ?? 0) + 1;
  const legal = new Set(getLegalActions(s, 'corp').filter(x => x.type === 'INSTALL_CARD' || x.type === 'PLAY_OPERATION_OR_EVENT').map(x => (x as { cardInstanceId: string }).cardInstanceId));
  const playable: Record<string, number> = {};
  for (const c of s.corp.hq) if (legal.has(c.instanceId)) playable[bucket(c)] = (playable[bucket(c)] ?? 0) + 1;
  const v = s.corp.servers;
  return {
    turn: s.turnNumber,
    kind: kind(s, a),
    credits: s.corp.credits,
    clicksLeft: s.corp.clicks,
    hq,
    playable,
    hqIce: v.hq?.ice.length ?? 0,
    rdIce: v.rd?.ice.length ?? 0,
    remotes: Object.values(v).filter(x => x.isRemote && x.root.length > 0).map(x => x.ice.length),
    rd: s.corp.rd.length,
  };
}

class W0 {
  clicks: Click[] = [];
  drawn = new Map<string, Drawn>();
  observe(s: GameState, a: GameAction, n: GameState) {
    if (s.turnNumber > TURNS) return;
    const click = s.activePlayer === 'corp' && a.player === 'corp' && n.corp.clicks < s.corp.clicks;
    if (click) this.clicks.push(position(s, a));
    if (click && a.type === 'DRAW_CARD') {
      for (const c of n.corp.hq) if (!s.corp.hq.some(x => x.instanceId === c.instanceId)) this.drawn.set(c.instanceId, { turn: s.turnNumber, type: bucket(c) });
    }
    // A drawn card leaving HQ: installed, played, or discarded / other
    for (const [id, d] of this.drawn) {
      if (d.left !== undefined || !s.corp.hq.some(x => x.instanceId === id) || n.corp.hq.some(x => x.instanceId === id)) continue;
      d.left = s.turnNumber;
      const own = 'cardInstanceId' in a && (a as { cardInstanceId?: string }).cardInstanceId === id;
      d.how = own && a.type === 'INSTALL_CARD' ? 'installed' : own && a.type === 'PLAY_OPERATION_OR_EVENT' ? 'played' : [...n.corp.archives.faceUp, ...n.corp.archives.faceDown].some(x => x.instanceId === id) ? (s.activePlayer === 'corp' ? 'discarded' : 'to archives on runner turn') : s.activePlayer === 'runner' ? 'stolen/trashed' : 'other';
    }
  }
}

const out = (game: string, who: string, seed: number, w: W0) => console.log(JSON.stringify({ game, who, seed, clicks: w.clicks, drawn: [...w.drawn.values()] }));

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
// SKIP=done.jsonl: rows already written (game, who, seed) are not played again, so a stopped run can resume
const done = new Set((process.env.SKIP ? readFileSync(process.env.SKIP, 'utf8') : '').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.game}|${r.who}|${r.seed}`; }));
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().filter(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')).config.ai === 'runner');
for (const [index, file] of files.entries()) {
  if (index % shards !== shard) continue;
  const report = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  if (!report.moves?.length) continue;
  const { seed, corpDeck, runnerDeck } = report.config;
  if (!done.has(`${file}|jeff|${seed}`)) {
  let s: GameState = createInitialGameState(deckGameSetup(seed, corpDeck, runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const human = new W0();
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
  }
  for (let k = 0; k <= EXTRA; k++) {
    if (done.has(`${file}|ai|${seed + k}`)) continue;
    valueLoops.clear();
    const game = new GameRunner(createInitialGameState(deckGameSetup(seed + k, corpDeck, runnerDeck)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    const ai = new W0();
    for (let i = 0; i < 6000 && game.state.turnNumber <= TURNS + 1; i++) {
      const before = game.state;
      if (!game.step()) break;
      ai.observe(before, game.last!, game.state);
    }
    out(file, 'ai', seed + k, ai);
  }
}
