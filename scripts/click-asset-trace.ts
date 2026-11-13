/**
 * Click-asset trace (AI Coordinator 2026-11-12, after the asset-rez trace: Regolith pays the AI 6.6 a copy against
 * Jeff's 10.5 while surviving more often). Measurement only. Every copy of a click asset (an asset with a paid ability
 * whose cost starts with [click], rule 1.3.3: "[click]: ..."), installed by the Corp, followed to the end of the game:
 *   - turn installed, turn rezzed, trashed (turn; by the Runner) or still installed at the end;
 *   - uses of its ability: clicks spent on it (the Corp's clicks before less after) and the credits it gave;
 *   - counters left on it when it left play or at the game's end (credit and power: tokens on the card);
 *   - idle clicks: a Corp click spent on the basic draw or credit action (5.6.2: the action phase; DRAW_CARD and
 *     GAIN_CREDIT) while the copy's ability was legal right then, or the copy was unrezzed with a legal rez and the
 *     Corp had its rez cost (rez, then use). Counted per click, with the turn.
 * Jeff's Corp games replayed (JEFF=1), the Normal Corp AI on the same decks (seed plus EXTRA more), and the 221-deal
 * table's deals (SEEDS, mapped as in scripts/corp-card-usage.ts). Deck-list driven: no card names here.
 *
 * PLAN_OFF as given (M1c's fire count: PLAN_OFF=+moneyAbility against none, on the same deals); abilities: moneyStats.abilities,
 * the ability picks moneyPick made in the game (any caller, the planner's search included).
 *
 *   [JEFF=1] [EXTRA=3] [CORP_CARD="Humanoid Resources"] [SEEDS=1721,1921] [SHARD=0/4] [SKIP=done.jsonl] [PLAN_OFF=+moneyAbility] npx vite-node scripts/click-asset-trace.ts > click.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, getLegalActions } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { moneyStats } from '../src/ai/incomeLine';

applyPlanOff(process.env.PLAN_OFF ?? '');

const DIR = 'tests/fixtures/human-games';
const EXTRA = Number(process.env.EXTRA ?? 3);

const clickAsset = (c: CardInstance) => cardDef(c).type_code === 'asset' && /(^|\n)\[click\]/.test(cardDef(c).text ?? '');
const roots = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.root);
const tokens = (c: CardInstance) => (c.tokens.credit ?? 0) + (c.tokens.power ?? 0);

interface Copy {
  title: string;
  cost: number;
  trash: number;
  installed: number;
  rezzed?: number;
  uses: number;
  clicks: number;
  credits: number;
  left?: number;
  trashed?: { turn: number; byRunner: boolean };
  idle: { turn: number; took: string; rezzed: boolean }[];
}

class Trace {
  copies = new Map<string, Copy>();
  observe(s: GameState, a: GameAction, n: GameState) {
    for (const c of roots(n)) if (clickAsset(c) && !this.copies.has(c.instanceId))
      this.copies.set(c.instanceId, { title: cardDef(c).title, cost: cardDef(c).cost ?? 0, trash: cardDef(c).trash_cost ?? 0, installed: s.turnNumber, uses: 0, clicks: 0, credits: 0, idle: [] });
    // Idle clicks: a basic draw or credit action while the copy could have been used
    if (a.player === 'corp' && (a.type === 'DRAW_CARD' || a.type === 'GAIN_CREDIT')) {
      const open = [...this.copies.entries()].filter(([, e]) => !e.trashed && e.left === undefined);
      if (open.length) {
        const legal = getLegalActions(s, 'corp');
        for (const [id, e] of open) {
          const c = roots(s).find(x => x.instanceId === id);
          if (!c) continue;
          const use = legal.some(x => x.type === 'USE_ABILITY' && x.cardInstanceId === id);
          const rezUse = !c.isRezzed && s.corp.credits >= e.cost && legal.some(x => x.type === 'REZ_CARD' && x.cardInstanceId === id);
          if (use || rezUse) e.idle.push({ turn: s.turnNumber, took: a.type, rezzed: c.isRezzed });
        }
      }
    }
    if (a.player === 'corp' && a.type === 'USE_ABILITY') {
      const e = this.copies.get(a.cardInstanceId);
      if (e) {
        e.uses++;
        e.clicks += Math.max(0, s.corp.clicks - n.corp.clicks);
        e.credits += Math.max(0, n.corp.credits - s.corp.credits);
      }
    }
    for (const [id, e] of this.copies) {
      const before = roots(s).find(x => x.instanceId === id);
      const now = roots(n).find(x => x.instanceId === id);
      if (now?.isRezzed && e.rezzed === undefined) e.rezzed = s.turnNumber;
      if (before && !now && !e.trashed && e.left === undefined) {
        e.left = tokens(before);
        e.trashed = { turn: s.turnNumber, byRunner: s.activePlayer === 'runner' };
      }
    }
  }
  finish(end: GameState) {
    for (const [id, e] of this.copies) if (e.left === undefined) {
      const c = roots(end).find(x => x.instanceId === id);
      e.left = c ? tokens(c) : 0;
    }
  }
}

const out = (game: string, who: string, seed: number, end: GameState, t: Trace) =>
  console.log(JSON.stringify({ game, who, seed, turns: end.turnNumber, winner: end.winner ?? null, abilities: moneyStats.abilities, copies: [...t.copies.values()] }));
const play = (s0: GameState) => {
  valueLoops.clear();
  moneyStats.abilities = 0;
  const game = new GameRunner(s0, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const t = new Trace();
  for (let i = 0; i < 8000; i++) {
    const before = game.state;
    if (!game.step()) break;
    t.observe(before, game.last!, game.state);
  }
  t.finish(game.state);
  return { t, end: game.state };
};

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const done = new Set((process.env.SKIP ? readFileSync(process.env.SKIP, 'utf8') : '').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.game}|${r.who}|${r.seed}`; }));
let job = 0;
const mine = () => job++ % shards === shard;

if (process.env.JEFF || process.env.EXTRA) {
  const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().filter(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')).config.ai === 'runner');
  for (const file of files) {
    const report = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    if (!report.moves?.length) continue;
    const { seed, corpDeck, runnerDeck } = report.config;
    // CORP_CARD=<title>: only Jeff's games whose Corp deck holds that card (a one-card arm's fire count)
    if (process.env.CORP_CARD && !JSON.stringify(corpDeck).includes(`"${process.env.CORP_CARD}"`)) continue;
    if (process.env.JEFF && mine() && !done.has(`${file}|jeff|${seed}`)) {
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
      out(file, 'jeff', seed, s, t);
    }
    for (let k = 0; k <= EXTRA; k++) {
      if (!mine() || done.has(`${file}|ai|${seed + k}`)) continue;
      const { t, end } = play(createInitialGameState(deckGameSetup(seed + k, corpDeck, runnerDeck)));
      out(file, 'ai', seed + k, end, t);
    }
  }
}

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
for (const seed of (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number)) {
  if (!mine() || done.has(`deal|ai|${seed}`)) continue;
  const p = Math.floor((seed - 1001) / 10);
  try {
    const { t, end } = play(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])));
    out('deal', 'ai', seed, end, t);
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
  }
}
