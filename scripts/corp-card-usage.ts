/**
 * Corp card usage (AI Coordinator 2026-11-12, after money A0; Jeff: "teaching the corp to use its actual cards better").
 * Every Corp card copy in a game, followed from the turn it is first in HQ: Corp turns it sat in HQ while legal to play
 * or install, the turn it was played or installed, for installed cards the ice in front, rezzed or not and the turns to
 * rez, the credits it made (credits gained by its own play or ability, or taken off its own hosted credits: rule 1.10),
 * and for ice the runs it ended (the run ended while the Runner was at it, rezzed) or for any installed card whether the
 * Runner trashed it. Deck-list driven: no card names here. One JSON line per game; scripts/corp-card-usage-sum.mjs
 * joins them by title against the card entry's claim (src/ai/cards profile: credits loaded over the rez cost) and puts
 * Jeff's own use of the same card beside it (JEFF=1 adds his Corp games from tests/fixtures/human-games).
 *
 *   SEEDS=1001,1011 [JEFF=1] [PLAN_OFF=...] npx vite-node scripts/corp-card-usage.ts > usage.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere, getLegalActions } from '../src/core';
import { counters } from '../src/core/engine/cardEffects';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { profileOf } from '../src/ai/cardProfiles';

applyPlanOff(process.env.PLAN_OFF ?? '');

interface Copy {
  code: string;
  title: string;
  type: string;
  seen: number;
  heldPlayable: number;
  used?: number;
  ice?: number;
  rezzed?: number;
  credits: number;
  stops: number;
  trashed?: boolean;
  /** What the card entry claims it pays back: its profile's credits loaded over its rez cost; null without a profile. */
  claim: number | null;
}

const roots = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.root);
const installed = (s: GameState) => Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice]);
const serverOf = (s: GameState, id: string) => Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id));

class Tracker {
  copies = new Map<string, Copy>();
  private turnSeen = 0;

  private copy(c: CardInstance, turn: number): Copy {
    let e = this.copies.get(c.instanceId);
    if (!e) {
      const pr = profileOf(c.cardCode);
      e = { code: c.cardCode, title: cardDef(c).title, type: cardDef(c).type_code, seen: turn, heldPlayable: 0, credits: 0, stops: 0, claim: pr ? pr.load - (cardDef(c).cost ?? 0) : null };
      this.copies.set(c.instanceId, e);
    }
    return e;
  }

  observe(s: GameState, a: GameAction, n: GameState) {
    // A Corp turn's first main-phase moment: what sat in HQ while legal to play or install
    if (s.activePlayer === 'corp' && this.turnSeen !== s.turnNumber && !s.activeRun && s.pendingPrompts.length === 0 && s.corp.clicks >= 3) {
      this.turnSeen = s.turnNumber;
      const legal = new Set(getLegalActions(s, 'corp').filter(x => x.type === 'INSTALL_CARD' || x.type === 'PLAY_OPERATION_OR_EVENT').map(x => (x as { cardInstanceId: string }).cardInstanceId));
      for (const c of s.corp.hq) {
        const e = this.copy(c, s.turnNumber);
        if (legal.has(c.instanceId) && cardDef(c).type_code !== 'agenda') e.heldPlayable++;
      }
    }
    for (const c of n.corp.hq) this.copy(c, n.turnNumber);
    const id = 'cardInstanceId' in a ? (a as { cardInstanceId?: string }).cardInstanceId : undefined;
    // Played or installed
    if (a.player === 'corp' && id && (a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'INSTALL_CARD')) {
      const c = findCardAnywhere(s, id);
      if (c && s.corp.hq.some(x => x.instanceId === id)) {
        const e = this.copy(c, s.turnNumber);
        e.used ??= s.turnNumber;
        const v = serverOf(n, id);
        if (v && a.type === 'INSTALL_CARD') e.ice = cardDef(c).type_code === 'ice' ? v.ice.findIndex(x => x.instanceId === id) : v.ice.length;
      }
    }
    // Rezzed
    for (const c of installed(n)) if (c.isRezzed && !installed(s).some(x => x.instanceId === c.instanceId && x.isRezzed)) {
      const e = this.copies.get(c.instanceId);
      if (e && e.rezzed === undefined) e.rezzed = n.turnNumber;
    }
    // Credits made: by the card's own play or ability, or taken off its own hosted credits
    const gain = n.corp.credits - s.corp.credits;
    if (gain > 0) {
      const own = id && (a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'USE_ABILITY') && a.player === 'corp' ? this.copies.get(id) : undefined;
      if (own) own.credits += gain;
      else {
        let left = gain;
        for (const c of roots(s)) {
          const after = roots(n).find(x => x.instanceId === c.instanceId);
          const took = counters(c, 'credit') - (after ? counters(after, 'credit') : 0);
          const e = this.copies.get(c.instanceId);
          if (e && took > 0 && left > 0) {
            e.credits += Math.min(took, left);
            left -= Math.min(took, left);
          }
        }
      }
    }
    // A run ended while the Runner was at a rezzed ice: that ice ended it
    if (s.activeRun && !n.activeRun && s.activeRun.icePosition !== null && s.activeRun.icePosition !== undefined) {
      const ice = s.corp.servers[s.activeRun.server]?.ice[s.activeRun.icePosition];
      const e = ice?.isRezzed ? this.copies.get(ice.instanceId) : undefined;
      if (e) e.stops++;
    }
    // Trashed by the Runner: an installed card gone on the Runner's turn
    if (s.activePlayer === 'runner') for (const c of installed(s)) if (!installed(n).some(x => x.instanceId === c.instanceId)) {
      const e = this.copies.get(c.instanceId);
      if (e) e.trashed = true;
    }
  }
}

const emit = (who: string, seed: number, deck: string, winner: string | null, t: Tracker) => console.log(JSON.stringify({ who, seed, deck, winner, copies: [...t.copies.values()] }));

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
for (const seed of seeds) {
  const p = Math.floor((seed - 1001) / 10);
  const corp = corpDecks[Math.floor(p / runnerDecks.length)];
  valueLoops.clear();
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corp, runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const t = new Tracker();
  try {
    for (let i = 0; i < 6000; i++) {
      const before = game.state;
      if (!game.step()) break;
      t.observe(before, game.last!, game.state);
    }
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  emit('ai', seed, corp.name, game.state.winner ?? null, t);
}

if (process.env.JEFF) {
  const dir = 'tests/fixtures/human-games';
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (report.config.ai !== 'runner' || !report.moves?.length) continue;
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    const t = new Tracker();
    for (const move of report.moves as GameAction[]) {
      let n: GameState;
      try {
        n = executeAction(s, move);
      } catch {
        break;
      }
      t.observe(s, move, n);
      s = n;
    }
    emit('jeff', report.config.seed, report.config.corpDeck.name, s.winner ?? null, t);
  }
}
