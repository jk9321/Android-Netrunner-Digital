/**
 * Behaviour diagnostics: plays self-play games and counts how each side spends
 * clicks, hoards credits, overdraws, discards, runs, and which cards it plays
 * or leaves in hand. Copied into scripts/ of a tree and run with vite-node.
 *   SHARD=i/n npx vite-node scripts/behaviour.ts -- [games per pairing] [normal|hard]
 */
import { createInitialGameState, GameState, cardDef } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import type { Agent } from '../src/ai/agent';
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

type Side = 'corp' | 'runner';
const side0 = () => ({
  turns: 0, clicks: {} as Record<string, number>, richCreditClicks: 0, overDraws: 0, discards: 0,
  endCredits: 0, end15: 0, end25: 0, wastedClicks: 0, decisions: 0, ms: 0, maxMs: 0,
  noRunTurns: 0, richNoRunTurns: 0, endTags: 0, taggedTurns: 0,
});
const stats = { games: 0, corpWins: 0, corp: side0(), runner: side0(),
  played: {} as Record<string, number>, stuck: {} as Record<string, number>, seen: {} as Record<string, number>,
  byDeck: {} as Record<string, { n: number; w: number }> };

const hand = (s: GameState, side: Side) => side === 'corp' ? s.corp.hq : s.runner.grip;
const credits = (s: GameState, side: Side) => s[side].credits;
const titleOf = (code: string) => { try { return cardDef({ cardCode: code } as never).title; } catch { return code; } };

function timed(a: Agent, side: Side): Agent {
  const st = stats[side];
  return {
    side: a.side,
    chooseAction(s) { const t = performance.now(); const r = a.chooseAction(s); const d = performance.now() - t; st.decisions++; st.ms += d; st.maxMs = Math.max(st.maxMs, d); return r; },
    chooseRez: a.chooseRez ? (s, c) => a.chooseRez!(s, c) : undefined,
  };
}

let seed = 1000, deal = 0;
for (const c of DECKS.filter(d => d.side === 'corp')) for (const r of DECKS.filter(d => d.side === 'runner')) for (let g = 0; g < games; g++) {
  seed++;
  if (deal++ % shards !== shard) continue;
  const agent = (side: Side) => timed(createAgent(side, level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {}), side);
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') });
  const playedHere = new Set<string>();
  let runsThisTurn = 0;
  try {
    for (let steps = 0; steps < 4000 && gr.state.turnNumber <= 80; steps++) {
      const before = gr.state;
      const actor = before.activePlayer as Side;
      // Peek at the action the runner will take by wrapping step: compare states instead
      if (!gr.step()) break;
      const after = gr.state;
      for (const sd of ['corp', 'runner'] as Side[]) {
        const used = before[sd].clicks - after[sd].clicks;
        if (used > 0 && before.activePlayer === sd && !before.activeRun) {
          // classify the click by what changed
          let kind = 'other';
          if (!before.activeRun && after.activeRun) kind = 'run';
          else if (hand(after, sd).length > hand(before, sd).length && credits(after, sd) === credits(before, sd)) kind = 'draw';
          else if (credits(after, sd) - credits(before, sd) === 1 && hand(after, sd).length === hand(before, sd).length) kind = 'credit';
          else if (hand(after, sd).length < hand(before, sd).length) kind = 'play/install';
          else if (sd === 'runner' && after.runner.tags < before.runner.tags) kind = 'remove tag';
          else if (sd === 'corp' && JSON.stringify(Object.values(after.corp.servers).map(s => s.root.map(x => x.advancementCounters ?? 0))) !== JSON.stringify(Object.values(before.corp.servers).map(s => s.root.map(x => x.advancementCounters ?? 0)))) kind = 'advance';
          else kind = 'ability/other';
          stats[sd].clicks[kind] = (stats[sd].clicks[kind] ?? 0) + used;
          if (kind === 'credit' && credits(before, sd) >= 12) stats[sd].richCreditClicks++;
          if (kind === 'draw' && hand(before, sd).length >= before[sd].handSizeLimit) stats[sd].overDraws++;
          if (kind === 'run') runsThisTurn++;
        }
        // cards leaving hand by play/install
        if (before.activePlayer === sd) {
          const now = new Set(hand(after, sd).map(x => x.instanceId));
          for (const x of hand(before, sd)) if (!now.has(x.instanceId)) {
            const inHeap = sd === 'runner' ? after.runner.heap.some(h => h.instanceId === x.instanceId) : after.corp.archives.faceUp.concat(after.corp.archives.faceDown).some(h => h.instanceId === x.instanceId);
            const isOp = ['operation', 'event'].includes(cardDef(x).type_code);
            if (!inHeap || isOp) { stats.played[x.cardCode] = (stats.played[x.cardCode] ?? 0) + 1; playedHere.add(x.instanceId); }
          }
        }
      }
      // end of a side's turn
      if (before.activePlayer !== after.activePlayer && !before.activeRun) {
        const sd = actor;
        const st = stats[sd];
        st.turns++;
        st.wastedClicks += Math.max(0, before[sd].clicks);
        st.endCredits += after[sd].credits;
        if (after[sd].credits >= 15) st.end15++;
        if (after[sd].credits >= 25) st.end25++;
        const discarded = Math.max(0, hand(before, sd).length - before[sd].handSizeLimit);
        st.discards += discarded;
        if (sd === 'runner') {
          if (runsThisTurn === 0) { st.noRunTurns++; if (before.runner.credits >= 10) st.richNoRunTurns++; }
          st.endTags += after.runner.tags;
          if (after.runner.tags > 0) st.taggedTurns++;
        }
        runsThisTurn = 0;
      }
    }
  } catch (err) { console.error(`deal ${seed}: ${err}`); continue; }
  const end = gr.state;
  stats.games++;
  if (end.winner === 'corp') stats.corpWins++;
  for (const k of [`corp:${c.name}`, `runner:${r.name}`]) {
    const b = (stats.byDeck[k] ??= { n: 0, w: 0 });
    b.n++;
    if (end.winner === k.split(':')[0]) b.w++;
  }
  for (const x of [...end.corp.hq, ...end.runner.grip]) stats.stuck[x.cardCode] = (stats.stuck[x.cardCode] ?? 0) + 1;
}
console.log(JSON.stringify(stats));
void titleOf;
