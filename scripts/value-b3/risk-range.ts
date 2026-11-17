/**
 * V-B B3 (the coordinator's condition on paidOut's floor): on the fire count's boards (the 56 local deals played by this
 * tree's Normal AIs, and Jeff's games replayed; split by SHARD), at every decision: the bare asset risk, how often it
 * passes 0.5 (paidOut's floor binds for a bare asset), and paidOut for each placed Nico Campaign, Otto Campaign and
 * Anthill Excavation Contract. One JSON line per shard; add them up with risk-range-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/value-b3/risk-range.ts
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { bareAssetRisk } from '../../src/ai/cardProfiles';
import { PAYOUT_RISK } from '../../src/ai/payoutRisk';
import { corpEffect } from '../../src/ai/effectValues';
import { asSide } from '../../src/ai/synergy';
import { CARDS } from '../../src/ai/cards';
import { getCardDefinition } from '../../src/core';
import { paidOut } from '../../src/ai/counterValues';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const PAID = new Set(['30037', '35040', '35072']);
/** The 18 asset formulas that pay over time (the ones B3 hands the measured risk): their floor binds before and after. */
const ASSETS = Object.keys(CARDS).filter(code => CARDS[code].corp && getCardDefinition(code).type_code === 'asset' && /perTurn/.test(String(CARDS[code].corp)));
const floors: Record<string, { boards: number; before: number; after: number }> = {};
// Before B3 on the same board: the game record set so that bareAssetRisk is 0.06 (corpBare), which is what every asset
// formula read; everything else on the board as it is
const asBefore = (s: GameState): GameState => ({ ...s, bareAssets: { exposed: 100, trashed: PAYOUT_RISK.corpBare * 103 - 3 * PAYOUT_RISK.moneyBare } });
const out = { boards: 0, riskMin: Infinity, riskMax: -Infinity, riskOverHalf: 0, paid: 0, paidMin: Infinity, paidMax: -Infinity, paidFloored: 0, paidBare: 0 };
const look = (s: GameState) => {
  out.boards++;
  if (process.env.FLOORS !== '0') {
    const before = asBefore(s);
    for (const code of ASSETS) {
      const f = (floors[getCardDefinition(code).title] ??= { boards: 0, before: 0, after: 0 });
      f.boards++;
      if ((asSide('corp', () => corpEffect(s, code)?.keep) ?? NaN) <= 0.3 + 1e-9) f.after++;
      if ((asSide('corp', () => corpEffect(before, code)?.keep) ?? NaN) <= 0.3 + 1e-9) f.before++;
    }
  }
  const r = bareAssetRisk(s);
  out.riskMin = Math.min(out.riskMin, r);
  out.riskMax = Math.max(out.riskMax, r);
  if (r > 0.5) out.riskOverHalf++;
  for (const server of Object.values(s.corp.servers))
    for (const c of server.root)
      if (PAID.has(c.cardCode)) {
        const v = paidOut(s, c);
        out.paid++;
        if (!server.ice.length) out.paidBare++;
        out.paidMin = Math.min(out.paidMin, v);
        out.paidMax = Math.max(out.paidMax, v);
        if (v === 0) out.paidFloored++;
      }
};
const sources: (() => void)[] = [
  ...deals().map(seed => () => {
    const watch = (inner: Agent): Agent => new Proxy(inner, { get: (t, p, r) => (p === 'chooseAction' ? (st: GameState) => (look(st), t.chooseAction(st)) : Reflect.get(t, p, r)) });
    const game = new GameRunner(dealState(seed), { corp: watch(createAgent('corp', 'normal')), runner: watch(createAgent('runner', 'normal')) });
    for (let k = 0; k < 4000 && game.step(); k++);
  }),
  ...humanFiles().map(file => () => {
    const report = JSON.parse(readFileSync(file, 'utf8'));
    if (!report.moves?.length) return;
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    for (const move of report.moves as GameAction[]) {
      if (actingSide(s) === move.player) look(s);
      try {
        s = executeAction(s, move);
      } catch {
        break;
      }
    }
  }),
];
sources.forEach((run, k) => k % shards === shard && run());
console.log(JSON.stringify({ riskRange: out, floors }));
