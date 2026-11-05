/**
 * The payoff report (Jeff, 2026-11-05, thread "Find why AI card valuation misses cards"): what each Runner card
 * installed in self-play actually got, next to what the value model forecast when it went in. The card-usage report
 * showed the Runner never plays most cheap permanents (Pennyshaver, Docklands Pass, Leech); the install scores showed
 * the board worth forecast as the reason. This checks the forecast's inputs against the games:
 *   - turns: turnsLeft at the install vs the Runner turns it then stayed installed;
 *   - successful runs a turn while installed (any server, HQ, R&D) vs PACE.runs x the success odds the model used;
 *   - credits it gave (credits taken off it, and credits its abilities gained);
 *   - its forecast board worth (2 x runnerCardValue, as runnerRigValue counts it).
 * Each install is one copy; a card the AI never installs has no row (see the card-usage report for those).
 *
 *   SHARD=i/n npx vite-node scripts/card-payoff.ts -- [games per pairing] > out.json
 *   node scripts/card-payoff-sum.mjs out*.json
 * On GitHub Actions: AI batch, script card-payoff. Decks and PLAN_OFF as in scripts/card-usage.ts.
 */
import { createInitialGameState, GameState, CardInstance } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { IDENTITY_TEST_DECKS } from '../src/data/testDecks/identityDecks';
import { NRDB_TEST_DECKS } from './nrdb-test-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { asSide, tuning } from '../src/ai/synergy';
import { turnsLeft } from '../src/ai/cardProfiles';
import { PACE, anySuccess, runSuccess } from '../src/ai/effectValues';
import { runnerCardValue } from '../src/ai/cardValues';
import { RATES } from '../src/ai/valueModel';

for (const key of (process.env.PLAN_OFF ?? '').split(',').filter(Boolean)) {
  const [name, side] = key.split('.');
  const plan = tuning.plan as Record<string, unknown>;
  if (side) plan[name] = { ...(plan[name] as object), [side]: false };
  else plan[name] = false;
}
const games = Number(process.argv.slice(2).filter(a => a !== '--')[0] ?? 1);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const prefixes = (process.env.DECKS ?? '').split(',').filter(Boolean);
const seen = new Set<string>();
const pool = [...ALL_DECKS, ...IDENTITY_TEST_DECKS, ...NRDB_TEST_DECKS].filter(d => !seen.has(d.id) && seen.add(d.id) && (prefixes.length === 0 || prefixes.some(p => d.id.startsWith(p))));

/** Per card code, summed over installs: [installs, forecast turns, actual turns, forecast successful runs, actual, forecast HQ, actual HQ, forecast R&D, actual R&D, credits given, forecast board worth]. */
const payoff: Record<string, number[]> = {};
interface Live { code: string; id: string; f: number[]; turns: number; runs: number; hq: number; rd: number; credits: number }

const rig = (s: GameState): CardInstance[] => [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
let played = 0, crashed = 0, seed = 9000, deal = 0;
for (const c of pool.filter(d => d.side === 'corp')) for (const r of pool.filter(d => d.side === 'runner')) for (let g = 0; g < games; g++) {
  seed++;
  if (deal++ % shards !== shard) continue;
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const live = new Map<string, Live>();
  const done: Live[] = [];
  try {
    for (let steps = 0; steps < 4000 && gr.state.turnNumber <= 80; steps++) {
      const before = gr.state;
      if (!gr.step()) break;
      const after = gr.state;
      const last = gr.last;
      // A Runner install: the forecast as the model made it
      if (last?.type === 'INSTALL_CARD' && before.activePlayer === 'runner' && 'cardInstanceId' in last) {
        const card = rig(after).find(x => x.instanceId === last.cardInstanceId);
        if (card && !live.has(card.instanceId)) {
          const per = asSide('runner', () => [turnsLeft(after), PACE.runs * anySuccess(after), PACE.runs * PACE.hqShare * runSuccess(after, 'hq'), PACE.runs * PACE.rdShare * runSuccess(after, 'rd'), RATES.rigCardScale * runnerCardValue(card.cardCode, after, card)]);
          const t = per[0];
          live.set(card.instanceId, { code: card.cardCode, id: card.instanceId, f: [t, per[1] * t, per[2] * t, per[3] * t, per[4]], turns: 0, runs: 0, hq: 0, rd: 0, credits: 0 });
        }
      }
      // Credits it gave: taken off it, or gained by one of its abilities
      for (const l of live.values()) {
        const was = rig(before).find(x => x.instanceId === l.id), now = rig(after).find(x => x.instanceId === l.id);
        if (was && now) l.credits += Math.max(0, (was.tokens.credit ?? 0) - (now.tokens.credit ?? 0));
        if (!now) { done.push(l); live.delete(l.id); }
      }
      if (last?.type === 'USE_ABILITY' && 'cardInstanceId' in last && live.has(last.cardInstanceId as string) && before.activePlayer === 'runner') {
        const l = live.get(last.cardInstanceId as string)!;
        const gained = after.runner.credits - before.runner.credits;
        const fromCard = Math.max(0, (rig(before).find(x => x.instanceId === l.id)?.tokens.credit ?? 0) - (rig(after).find(x => x.instanceId === l.id)?.tokens.credit ?? 0));
        if (gained > fromCard) l.credits += gained - fromCard;
      }
      // Runs: from the run log as the turn passes (state.runsThisTurn; a run can start and end in one step)
      if (after.runsThisTurn.length < before.runsThisTurn.length)
        for (const run of before.runsThisTurn) if (run.successful) for (const l of live.values()) { l.runs++; if (run.server === 'hq') l.hq++; if (run.server === 'rd') l.rd++; }
      // A Runner turn ends: each card installed through it counts the turn
      if (before.activePlayer === 'runner' && after.activePlayer !== 'runner') for (const l of live.values()) l.turns++;
    }
  } catch (err) {
    crashed++;
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  played++;
  for (const l of [...done, ...live.values()]) {
    const p = (payoff[l.code] ??= Array(11).fill(0));
    const row = [1, l.f[0], l.turns, l.f[1], l.runs, l.f[2], l.hq, l.f[3], l.rd, l.credits, l.f[4]];
    row.forEach((x, i) => (p[i] += x));
  }
}
console.log(JSON.stringify({ games: played, crashed, payoff }));
