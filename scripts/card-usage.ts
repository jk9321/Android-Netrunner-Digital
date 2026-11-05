/**
 * The per-card usage report (Jeff, 2026-11-05, thread "Find why AI card valuation misses cards"):
 * self-play games over every deck, counting for each card how often it started a turn playable
 * (in hand and legal to play or install, or installed and legal to rez for the Corp) and was
 * still unplayed when the turn ended, and how often that was on a turn the side clicked for a
 * credit instead. A card the AI holds while clicking for credits is one its valuation misses:
 * Sure Gamble, Transfer of Wealth, S-Dobrado and Maintenance Access were all found that way.
 * Static checks can't see this (tests/valueAudit.test.ts, tests/useAudit.test.ts); this can.
 *
 *   SHARD=i/n npx vite-node scripts/card-usage.ts -- [games per pairing] [normal|hard] > out.json
 *   node scripts/card-usage-sum.mjs out*.json
 * On GitHub Actions: AI batch, script card-usage (games 1 is about 1,300 games).
 * Decks: the sample and starter decks, the beta picker's one deck per identity and the test-only
 * NetrunnerDB decks (every set). DECKS=<prefixes> narrows them; PLAN_OFF as in corp-losses.ts.
 */
import { createInitialGameState, cardDef, getLegalActions, GameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { IDENTITY_TEST_DECKS } from '../src/data/testDecks/identityDecks';
import { NRDB_TEST_DECKS } from './nrdb-test-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { tuning } from '../src/ai/synergy';

for (const key of (process.env.PLAN_OFF ?? '').split(',').filter(Boolean)) {
  const [name, side] = key.split('.');
  const plan = tuning.plan as Record<string, unknown>;
  if (side) plan[name] = { ...(plan[name] as object), [side]: false };
  else plan[name] = false;
}
const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const prefixes = (process.env.DECKS ?? '').split(',').filter(Boolean);
const seen = new Set<string>();
const pool = [...ALL_DECKS, ...IDENTITY_TEST_DECKS, ...NRDB_TEST_DECKS].filter(d => !seen.has(d.id) && seen.add(d.id) && (prefixes.length === 0 || prefixes.some(p => d.id.startsWith(p))));

type Side = 'corp' | 'runner';
/** By card code: [turns it started playable, turns it was still unplayed at the end, of those the turns the side clicked for a credit]. */
const held: Record<string, [number, number, number]> = {};
let played = 0, corpWins = 0, crashed = 0;

const PLAYS = new Set(['PLAY_OPERATION_OR_EVENT', 'INSTALL_CARD', 'REZ_CARD']);
const playableIds = (s: GameState, side: Side) =>
  new Set(getLegalActions(s, side).filter(a => PLAYS.has(a.type)).map(a => (a as { cardInstanceId: string }).cardInstanceId));
/** Cards a side could play this turn: the Runner's grip; the Corp's operations, and its unrezzed installed cards (not agendas). */
const candidates = (s: GameState, side: Side) =>
  side === 'runner'
    ? s.runner.grip
    : [...s.corp.hq.filter(c => cardDef(c).type_code === 'operation'), ...Object.values(s.corp.servers).flatMap(sv => sv.root).filter(c => !c.isRezzed)];
const stillUnplayed = (s: GameState, side: Side, id: string) =>
  side === 'runner' ? s.runner.grip.some(c => c.instanceId === id) : s.corp.hq.some(c => c.instanceId === id) || Object.values(s.corp.servers).some(sv => sv.root.some(c => c.instanceId === id && !c.isRezzed));

let seed = 9000, deal = 0;
for (const c of pool.filter(d => d.side === 'corp')) for (const r of pool.filter(d => d.side === 'runner')) for (let g = 0; g < games; g++) {
  seed++;
  if (deal++ % shards !== shard) continue;
  const agent = (side: Side) => createAgent(side, level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {});
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') });
  let start: Map<string, string> | null = null;
  let side: Side = 'corp';
  let creditClick = false;
  try {
    for (let steps = 0; steps < 4000 && gr.state.turnNumber <= 80; steps++) {
      const before = gr.state;
      const active = before.activePlayer as Side;
      // A turn's first quiet moment with most clicks left: what it could play now
      if (!start && !before.activeRun && before.pendingPrompts.length === 0 && before[active].clicks >= 3) {
        side = active;
        const ok = playableIds(before, active);
        start = new Map(candidates(before, active).filter(x => ok.has(x.instanceId) && cardDef(x).type_code !== 'agenda').map(x => [x.instanceId, x.cardCode]));
      }
      if (!gr.step()) break;
      const after = gr.state;
      if (before.activePlayer === side && !before.activeRun && after[side].credits - before[side].credits === 1 && before[side].clicks - after[side].clicks === 1) creditClick = true;
      if (start && before.activePlayer === side && after.activePlayer !== side) {
        for (const [id, code] of start) {
          const h = (held[code] ??= [0, 0, 0]);
          h[0]++;
          if (stillUnplayed(after, side, id)) {
            h[1]++;
            if (creditClick) h[2]++;
          }
        }
        start = null;
        creditClick = false;
      }
    }
  } catch (err) {
    crashed++;
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  played++;
  if (gr.state.winner === 'corp') corpWins++;
}
console.log(JSON.stringify({ games: played, corpWins, crashed, held }));
