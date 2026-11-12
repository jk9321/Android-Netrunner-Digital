/**
 * Asset-rez trace (AI Coordinator 2026-11-12, after the card-usage table: the AI installs econ assets about as often as
 * Jeff but rezzes few of them, Humanoid Resources 3%, Anthill 19%, against his 100%). Measurement only. Every econ asset
 * copy (an asset whose card entry's profile pays credits, more loaded than its rez cost) installed by the Corp, followed:
 *   - every rez chance: a window the engine offers where rezzing it is legal (rules 5.6.1b, 5.6.2a, 5.6.3b, 5.7.1b/e,
 *     5.7.2b; during a run 6.9.1, 6.9.2, 6.9.4: the paid ability windows marked (R)), with the window, the Corp's
 *     credits, the rez cost, whether the Corp was asked (it took the step), and on its own turn (draw or action
 *     window) the rule ranking's score for the rez beside its best action's score; in a run the rez is decideRez's
 *     (corpAI.ts: assets wait for the Corp's own turn);
 *   - the rez (turn and window), or none; the trash (turn, by a run on its server, and whether that run offered a rez
 *     window for it: a drip asset rezzed then has paid already, a click asset has not);
 *   - the counted payback had it been rezzed at its first affordable chance: for a 'turn' profile, its pay at each
 *     Corp turn start after that until the trash or three turns on, capped at its load, less the rez cost.
 * The Normal Corp AI on the decks of Jeff's Corp games (same seed plus EXTRA more) and Jeff's own games replayed (JEFF=1),
 * turns 1-12. Deck-list driven: no card names here. One JSON line per game.
 *
 *   [EXTRA=3] [JEFF=1] [SHARD=0/4] [SKIP=done.jsonl] npx vite-node scripts/asset-rez-trace.ts > rez.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, getLegalActions } from '../src/core';
import { currentStep } from '../src/core/engine/priority';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { profileOf } from '../src/ai/cardProfiles';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

const DIR = 'tests/fixtures/human-games';
const TURNS = 12;
const EXTRA = Number(process.env.EXTRA ?? 3);

const econAsset = (c: CardInstance) => {
  const p = cardDef(c).type_code === 'asset' ? profileOf(c.cardCode) : undefined;
  return !!p && p.pay > 0 && p.load > (cardDef(c).cost ?? 0);
};
const serverOf = (s: GameState, id: string) => Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id));

interface Chance { turn: number; step: string; credits: number; asked: boolean; took?: string; score?: number; best?: number }
interface Copy {
  title: string;
  cost: number;
  every: string;
  pay: number;
  load: number;
  installed: number;
  ice: number;
  chances: Chance[];
  rezzed?: { turn: number; step: string };
  trashed?: { turn: number; byRun: boolean; rezWindowInRun: boolean };
  payback?: number | null;
}

class Trace {
  copies = new Map<string, Copy>();
  private runChance = new Set<string>(); // copies offered a rez window in the current run
  constructor(private corp?: HeuristicCorpAI) {}

  observe(s: GameState, a: GameAction, n: GameState) {
    if (s.turnNumber > TURNS) return;
    // Installed: a new econ asset in a root
    for (const v of Object.values(n.corp.servers)) for (const c of v.root) if (econAsset(c) && !this.copies.has(c.instanceId) && !c.isRezzed) {
      const p = profileOf(c.cardCode)!;
      this.copies.set(c.instanceId, { title: cardDef(c).title, cost: cardDef(c).cost ?? 0, every: p.every, pay: p.pay, load: p.load, installed: s.turnNumber, ice: v.ice.length, chances: [] });
    }
    if (!s.activeRun) this.runChance.clear();
    // Rez chances in s: legal rezzes of tracked unrezzed copies
    const open = [...this.copies.entries()].filter(([id, e]) => !e.rezzed && !e.trashed && serverOf(s, id)?.root.some(c => c.instanceId === id && !c.isRezzed));
    if (open.length) {
      const legal = new Set(getLegalActions(s, 'corp').filter(x => x.type === 'REZ_CARD').map(x => (x as { cardInstanceId: string }).cardInstanceId));
      const step = currentStep(s) ?? 'none';
      for (const [id, e] of open) {
        if (!legal.has(id)) continue;
        const asked = a.player === 'corp';
        const ch: Chance = { turn: s.turnNumber, step, credits: s.corp.credits, asked, took: asked ? (a.type === 'REZ_CARD' && a.cardInstanceId === id ? 'rez' : a.type) : undefined };
        // The rule ranking's view on the Corp's own turn (draw or action window)
        if (asked && this.corp && s.activePlayer === 'corp' && !s.activeRun && (step === 'corp_draw' || step === 'corp_action') && s.pendingPrompts.length === 0) {
          const ranked = asSide('corp', () => {
            decisionContext(s, 'corp');
            return this.corp!.rankMainActions(s);
          });
          const r = ranked.find(x => x.action.type === 'REZ_CARD' && x.action.cardInstanceId === id);
          ch.score = r?.score;
          ch.best = ranked[0]?.score;
        }
        // Collapse repeats of the same window in a row
        const last = e.chances[e.chances.length - 1];
        if (!last || last.turn !== ch.turn || last.step !== ch.step || last.asked !== ch.asked || ch.took === 'rez') e.chances.push(ch);
        if (s.activeRun) this.runChance.add(id);
      }
    }
    // Rezzed / trashed
    for (const [id, e] of this.copies) {
      const now = serverOf(n, id)?.root.find(c => c.instanceId === id);
      if (!e.rezzed && now?.isRezzed) e.rezzed = { turn: s.turnNumber, step: currentStep(s) ?? 'none' };
      if (!e.trashed && serverOf(s, id) && !now && s.activePlayer === 'runner') e.trashed = { turn: s.turnNumber, byRun: !!s.activeRun, rezWindowInRun: this.runChance.has(id) };
    }
  }

  /** The counted payback at the first affordable chance (turn profiles only). */
  finish(end: GameState) {
    for (const e of this.copies.values()) {
      const first = e.chances.find(c => c.credits >= e.cost);
      if (!first || e.every !== 'turn') {
        e.payback = first ? null : undefined;
        continue;
      }
      const until = Math.min(e.trashed?.turn ?? Math.min(end.turnNumber, TURNS), first.turn + 3);
      // Corp turn starts after the rez (turn numbers count rounds: one Corp turn start each)
      const starts = Math.max(0, until - first.turn);
      e.payback = Math.min(e.load, starts * e.pay) - e.cost;
    }
  }
}

const out = (game: string, who: string, seed: number, t: Trace) => console.log(JSON.stringify({ game, who, seed, copies: [...t.copies.values()] }));

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const done = new Set((process.env.SKIP ? readFileSync(process.env.SKIP, 'utf8') : '').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.game}|${r.who}|${r.seed}`; }));
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().filter(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')).config.ai === 'runner');
for (const [index, file] of files.entries()) {
  if (index % shards !== shard) continue;
  const report = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  if (!report.moves?.length) continue;
  const { seed, corpDeck, runnerDeck } = report.config;
  if (process.env.JEFF && !done.has(`${file}|jeff|${seed}`)) {
    let s: GameState = createInitialGameState(deckGameSetup(seed, corpDeck, runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    const t = new Trace();
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
    t.finish(s);
    out(file, 'jeff', seed, t);
  }
  for (let k = 0; k <= EXTRA; k++) {
    if (done.has(`${file}|ai|${seed + k}`)) continue;
    valueLoops.clear();
    const corp = createAgent('corp', 'normal') as HeuristicCorpAI;
    const game = new GameRunner(createInitialGameState(deckGameSetup(seed + k, corpDeck, runnerDeck)), { corp, runner: createAgent('runner', 'normal') });
    const t = new Trace(corp);
    for (let i = 0; i < 8000 && game.state.turnNumber <= TURNS + 1; i++) {
      const before = game.state;
      if (!game.step()) break;
      t.observe(before, game.last!, game.state);
    }
    t.finish(game.state);
    out(file, 'ai', seed + k, t);
  }
}
