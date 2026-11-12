/**
 * Fire counts for the asset cover arms (AI Coordinator standing rule 2026-11-12: before an arm gets a batch, run it on
 * the re-play deals and report how often it changes a decision). The Normal Corp AI against the Normal Runner on the
 * 221-deal table's deals (SEEDS, mapped as in scripts/corp-card-usage.ts), with PLAN_OFF as given. Per game:
 *   - noAssetDiff: Corp main-phase decisions with ice in HQ where scoringRemote differs with plan.scoringNoAsset on
 *     and off (the input the arm changes; iceRedirect reads it);
 *   - redirects: iceRedirectStats.fired (top-level redirects);
 *   - econ asset installs into a remote, and how many went behind ice installed on that server earlier the same turn
 *     ("covered"), and how many onto a remote with no ice ("bare"). Run once with the arm on and once off on the same
 *     deals: the difference is the arm's fires.
 * cover: assetCoverStats (countedScore.ts; any caller, the planner's search included). One JSON line per game.
 *
 *   SEEDS=1001,1011 [PLAN_OFF=+scoringNoAsset,+assetCover] [SHARD=0/2] npx vite-node scripts/asset-cover-fires.ts > fires.jsonl
 */
import { GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff, tuning } from '../src/ai/synergy';
import { assetCoverStats, iceRedirectStats, isCorpMain, scoringRemote } from '../src/ai/countedScore';
import { profileOf } from '../src/ai/cardProfiles';
import { asSide } from '../src/ai/pricing';

applyPlanOff(process.env.PLAN_OFF ?? '');

const econ = (code: string, cost: number) => {
  const p = profileOf(code);
  return !!p && p.pay > 0 && p.load > cost;
};
const scoringWith = (s: GameState, on: boolean) => {
  const keep = tuning.plan;
  tuning.plan = { ...keep, scoringNoAsset: on };
  try {
    return asSide('corp', () => scoringRemote(s)?.id ?? null);
  } finally {
    tuning.plan = keep;
  }
};

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const [i, seed] of seeds.entries()) {
  if (i % shards !== shard) continue;
  const p = Math.floor((seed - 1001) / 10);
  const corpDeck = corpDecks[Math.floor(p / runnerDecks.length)];
  valueLoops.clear();
  iceRedirectStats.fired = 0;
  for (const k of Object.keys(assetCoverStats) as (keyof typeof assetCoverStats)[]) assetCoverStats[k] = 0;
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  let noAssetDiff = 0;
  let installs = 0;
  let covered = 0;
  let bare = 0;
  const iceThisTurn = new Map<string, number>(); // server id -> turn of the Corp's last ice install there
  try {
    for (let k = 0; k < 8000; k++) {
      const s = game.state;
      if (s.activePlayer === 'corp' && isCorpMain(s) && s.pendingPrompts.length === 0 && s.corp.hq.some(c => cardDef(c).type_code === 'ice') && scoringWith(s, true) !== scoringWith(s, false)) noAssetDiff++;
      if (!game.step()) break;
      const n = game.state;
      const a = game.last!;
      if (a.player !== 'corp' || a.type !== 'INSTALL_CARD') continue;
      const card = s.corp.hq.find(c => c.instanceId === a.cardInstanceId);
      if (!card) continue;
      const v = Object.values(n.corp.servers).find(x => x.ice.some(c => c.instanceId === card.instanceId) || x.root.some(c => c.instanceId === card.instanceId));
      if (!v?.isRemote) continue;
      if (cardDef(card).type_code === 'ice') iceThisTurn.set(v.id, s.turnNumber);
      else if (cardDef(card).type_code === 'asset' && econ(card.cardCode, cardDef(card).cost ?? 0)) {
        installs++;
        if (iceThisTurn.get(v.id) === s.turnNumber) covered++;
        if (!v.ice.length) bare++;
      }
    }
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  console.log(JSON.stringify({ seed, deck: corpDeck.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, noAssetDiff, redirects: iceRedirectStats.fired, installs, covered, bare, cover: { ...assetCoverStats } }));
}
