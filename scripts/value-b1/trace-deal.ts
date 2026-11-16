/**
 * V-B B1 bar: trace a g1 deal that played differently. Plays a batch deal (Normal v Normal, as ai-batch) in this tree and
 * prints one line per action; with AUDIT_AT=<i> it turns the on-hit audits on for action i only and prints what they
 * found (a hit that served another board's value). Run in the base tree and the branch, diff, then audit the base at the
 * first differing action.   SEED=2881 [AUDIT_AT=57] npx vite-node scripts/value-b1/trace-deal.ts
 */
import { GameAction, createInitialGameState } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS } from '../nsg-sample-decks';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { clickAudit, drawAudit } from '../../src/ai/handValues';
import { threatsAudit } from '../../src/ai/effectValues';

const seed = Number(process.env.SEED);
const at = process.env.AUDIT_AT === undefined ? -1 : Number(process.env.AUDIT_AT);
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const p = Math.floor((seed - 1001) / 10);
const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
const audits = { click: clickAudit, draw: drawAudit, threat: threatsAudit };
for (let i = 0; ; i++) {
  if (i === at) for (const a of Object.values(audits)) Object.assign(a, { on: true, checked: 0, mismatches: 0, errors: [] });
  const turn = game.state.turnNumber;
  if (!game.step()) break;
  console.log(`${i} T${turn} ${JSON.stringify(game.last as GameAction | null)}`);
  if (i === at) {
    for (const [k, a] of Object.entries(audits)) console.log(`AUDIT ${k}: checked ${a.checked}, mismatches ${a.mismatches}, largest ${Math.max(0, ...a.errors).toFixed(4)}`);
    for (const a of Object.values(audits)) a.on = false;
  }
}
