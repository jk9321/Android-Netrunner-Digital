/**
 * Stage D item 3 step 2 (ai-rez-keep; design-answer.md section 2, points 6 and the bar's fire count): the real rez
 * windows of the recorded sample (56 local deals played by this tree, the human games replayed; split by SHARD). At each
 * Corp approach-ice window whose ice is unrezzed: whether countedRez's R3 or R4 toll branch answers it (the run is on HQ
 * with an agenda there, or on R&D with none in HQ and agendas left by the deck list; the rez does not stop the run,
 * rezStops), whether spendsKept passes it (the F1 condition), the Corp's credits, the rez cost, the Runner's credits and
 * clicks, the time of the ask, and the agent's pick. The fire-count script (value-b1/fire-count.ts with
 * rez-keep-fire-patches.json) covers the main-phase and prompt decisions and the simulated windows inside them; this
 * covers the windows the game loop asks through chooseRez. One JSON line per window and per deal end.
 *   SHARD=0/64 npx vite-node scripts/stage-d/rez-keep-windows.ts > w-0.txt; node scripts/stage-d/rez-keep-windows-sum.mjs w-*.txt
 */
import { CardInstance, GameState, cardDef } from '../../src/core';
import { rezCost } from '../../src/core/engine/cardEffects';
import { rezStops, spendsKept } from '../../src/ai/corp/rez';
import { agendasUnseen } from '../../src/ai/corp/pools';
import { forEachRecorded } from '../stage-a/harness';

const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';

function toll(s: GameState, ice: CardInstance): 'R3t' | 'R4t' | null {
  const run = s.activeRun!;
  if (rezStops(s, ice, false)) return null;
  const hq = s.corp.hq.filter(isAgenda).length;
  if (run.server === 'hq' && hq > 0) return 'R3t';
  if (run.server === 'rd' && hq === 0 && agendasUnseen(s) > 0) return 'R4t';
  return null;
}

forEachRecorded({
  decision(d) {
    if (d.kind !== 'rez') return;
    const s = d.state;
    const run = s.activeRun;
    if (!run || run.icePosition === null) return;
    const ice = s.corp.servers[run.server]?.ice[run.icePosition];
    if (!ice || ice.isRezzed || !d.cards?.some(c => c.instanceId === ice.instanceId)) return;
    const rule = toll(s, ice);
    if (!rule) return;
    const t = performance.now();
    const fires = spendsKept(s, ice);
    const ms = performance.now() - t;
    const a = d.action as { type?: string; cardInstanceId?: string } | null;
    const pick = a?.type === 'REZ_CARD' && a.cardInstanceId === ice.instanceId ? 'rez' : 'pass';
    console.log(JSON.stringify({ kind: 'window', src: d.src, T: s.turnNumber, server: run.server, rule, title: cardDef(ice).title, fires, pick, corp: s.corp.credits, cost: rezCost(s, ice), runner: s.runner.credits, clicks: s.runner.clicks, ms: Math.round(ms * 10) / 10, decideMs: Math.round(d.ms) }));
  },
  dealEnd(src, state) {
    console.log(JSON.stringify({ kind: 'end', src, T: state.turnNumber, winner: state.winner ?? null }));
  },
});
