/**
 * Money A0: econ assets (an asset whose card entry's profile pays credits, more loaded than its rez cost) in Jeff's
 * Corp games (tests/fixtures/human-games, config.ai 'runner') and in the Corp AI's games on the same decks (same seed
 * plus EXTRA more, Normal v Normal), turns 1-10: Corp turns each sat in HQ (card-turns, by title) and what the Corp's
 * clicks did on those turns; the turn each went down, behind how much ice, and on a bare remote or not; the turns to
 * its rez; trashed by the Runner (rule 3.3.1 assets sit in remote roots; trashing an accessed card, 4.6.3) or not.
 *
 *   [EXTRA=3] [SHARD=0/4] [PLAN_OFF=...] npx vite-node scripts/money-a0.ts > a0.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { profileOf } from '../src/ai/cardProfiles';
import { applyPlanOff } from '../src/ai/synergy';

applyPlanOff(process.env.PLAN_OFF ?? '');
const DIR = 'tests/fixtures/human-games';
const TURNS = 10;
const EXTRA = Number(process.env.EXTRA ?? 3);
const econAsset = (c: CardInstance) => {
  const p = cardDef(c).type_code === 'asset' ? profileOf(c.cardCode) : undefined;
  return !!p && p.pay > 0 && p.load > (cardDef(c).cost ?? 0);
};

interface Asset { title: string; seen: number; installed?: number; ice?: number; rezzed?: number; trashed?: boolean; heldTurns: number }

class Tracker {
  assets = new Map<string, Asset>();
  heldClicks: Record<string, number> = {}; // clicks on turns an econ asset sat in HQ
  private startedTurn = 0;

  observe(s: GameState, a: GameAction, n: GameState) {
    if (s.turnNumber > TURNS) return;
    // Corp turn start: the econ assets in HQ
    if (n.activePlayer === 'corp' && this.startedTurn !== n.turnNumber && n.turnNumber <= TURNS) {
      this.startedTurn = n.turnNumber;
      for (const c of n.corp.hq.filter(econAsset)) {
        const e = this.assets.get(c.instanceId) ?? { title: cardDef(c).title, seen: n.turnNumber, heldTurns: 0 };
        e.heldTurns++;
        this.assets.set(c.instanceId, e);
      }
    }
    const held = s.activePlayer === 'corp' && s.corp.hq.some(econAsset);
    const click = s.activePlayer === 'corp' && a.player === 'corp' && n.corp.clicks < s.corp.clicks;
    if (click && held) {
      const card = 'cardInstanceId' in a && a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined;
      const k = a.type === 'DRAW_CARD' ? 'draw' : a.type === 'GAIN_CREDIT' ? 'credit' : a.type === 'INSTALL_CARD' && card && econAsset(card) ? 'install the asset' : a.type === 'INSTALL_CARD' ? `install ${card ? cardDef(card).type_code : '?'}` : a.type === 'PLAY_OPERATION_OR_EVENT' ? 'operation' : a.type === 'ADVANCE_CARD' ? 'advance' : 'other';
      this.heldClicks[k] = (this.heldClicks[k] ?? 0) + (s.corp.clicks - n.corp.clicks);
    }
    for (const [id, e] of this.assets) {
      const now = findCardAnywhere(n, id);
      const server = Object.values(n.corp.servers).find(v => v.root.some(c => c.instanceId === id));
      if (e.installed === undefined && server) {
        e.installed = n.turnNumber;
        e.ice = server.ice.length;
      }
      if (e.rezzed === undefined && now?.isRezzed) e.rezzed = n.turnNumber;
      const wasIn = Object.values(s.corp.servers).some(v => v.root.some(c => c.instanceId === id));
      if (wasIn && !server && s.activePlayer === 'runner') e.trashed = true;
    }
    // Econ assets installed straight from a draw within the turn are tracked too
    if (click && a.type === 'INSTALL_CARD') {
      const card = findCardAnywhere(s, a.cardInstanceId);
      if (card && econAsset(card) && !this.assets.has(card.instanceId)) {
        const server = Object.values(n.corp.servers).find(v => v.root.some(c => c.instanceId === card.instanceId));
        this.assets.set(card.instanceId, { title: cardDef(card).title, seen: s.turnNumber, heldTurns: 0, installed: s.turnNumber, ice: server?.ice.length ?? 0 });
      }
    }
  }
}

const out = (game: string, who: string, seed: number, t: Tracker) => console.log(JSON.stringify({ game, who, seed, assets: [...t.assets.values()], heldClicks: t.heldClicks }));

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
// SKIP=done.jsonl: rows already written (game, who, seed) are not played again, so a stopped run can resume
const done = new Set((process.env.SKIP ? readFileSync(process.env.SKIP, 'utf8') : '').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.game}|${r.who}|${r.seed}`; }));
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().filter(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')).config.ai === 'runner');
for (const [index, file] of files.entries()) {
  if (index % shards !== shard) continue;
  const report = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const { seed, corpDeck, runnerDeck } = report.config;
  if (!done.has(`${file}|jeff|${seed}`)) {
  let s: GameState = createInitialGameState(deckGameSetup(seed, corpDeck, runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const human = new Tracker();
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
    const ai = new Tracker();
    for (let i = 0; i < 6000 && game.state.turnNumber <= TURNS + 1; i++) {
      const before = game.state;
      if (!game.step()) break;
      ai.observe(before, game.last!, game.state);
    }
    out(file, 'ai', seed + k, ai);
  }
}
