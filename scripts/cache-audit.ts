/**
 * Audit Step 2 (AI-CACHE-HIDDEN-STATE): the on-hit audits of the three game-scoped hand-value maps (handValues clickWorth
 * and drawWorth, effectValues damageThreat) over whole batch deals: per deal and map, hits checked, hits that served
 * another board's value, and the size of the error (mean, p90, max of |served - worked out again|; damageThreat by its
 * share, with the count of bursts that differ). Each deal is played in a fresh process state as far as the maps go
 * (they are scoped to the game).
 *
 *   SEEDS=2181,1752 npx vite-node scripts/cache-audit.ts
 *
 * The audit works each hit out again, so a deal takes about twice as long. To see whether a change moves the maps' call
 * counts (Step 3's first check when a deletion is not same-seed identical), compare `checked` on the branch and its base.
 */
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { playLogged } from './lossLog';
import { valueLoops } from '../src/ai/valueModel';
import { clickAudit, drawAudit } from '../src/ai/handValues';
import { threatsAudit } from '../src/ai/effectValues';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const audits = { click: clickAudit, draw: drawAudit, threat: threatsAudit };

const summary = (errors: number[]) => {
  const e = [...errors].sort((a, b) => a - b);
  const q = (p: number) => (e.length ? e[Math.min(e.length - 1, Math.floor(p * e.length))] : 0);
  return { mean: e.length ? +(e.reduce((a, b) => a + b, 0) / e.length).toFixed(4) : 0, p90: +q(0.9).toFixed(4), max: +(e[e.length - 1] ?? 0).toFixed(4) };
};

for (const seed of (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number)) {
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  for (const a of Object.values(audits)) Object.assign(a, { on: true, checked: 0, mismatches: 0, errors: [] }, 'burstErrors' in a ? { burstErrors: 0 } : {});
  playLogged(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') }, { corp: c.name, runner: r.name });
  const row: Record<string, unknown> = { seed };
  for (const [name, a] of Object.entries(audits)) {
    row[name] = { checked: a.checked, wrong: a.mismatches, rate: a.checked ? +(a.mismatches / a.checked).toFixed(4) : 0, ...summary(a.errors), ...('burstErrors' in a ? { burstWrong: a.burstErrors } : {}) };
    a.on = false;
  }
  console.log(JSON.stringify(row));
}
