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
 * strayed: non-econ assets and upgrades installed on a new remote while a remote with ice and no agenda or asset in its
 * root existed (play test round 2). steals: agenda points the Runner stole, by server (the scoring remote as scoringRemote names it at the steal, other
 * remotes, hq, rd, archives); assets: per econ asset copy, iced at install, trashed by the Runner, credits taken off it
 * (rule 1.10). cover: assetCoverStats, partner: assetPartnerStats (countedScore.ts; any caller, the planner's search included). One JSON line per game.
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
import { CHECK, assetCoverStats, holdCost, iceRedirectStats, isCorpMain, runnerBudget, scoringRemote, assetPartnerStats } from '../src/ai/countedScore';
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
  assetPartnerStats.moved = 0;
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  let noAssetDiff = 0;
  let installs = 0;
  let covered = 0;
  let bare = 0;
  let strayed = 0;
  let unusedTurns = 0;
  const unusedWhy: Record<string, number> = {};
  const lastClick = { n: 0, earlier: 0 };
  let corpTurn = -1;
  let turnActs: string[] = []; // non-econ assets and upgrades put on a new bare remote while an iced remote with an open root waited
  const iceThisTurn = new Map<string, number>(); // server id -> turn of the Corp's last ice install there
  const steals: Record<string, number> = {};
  const assets = new Map<string, { iced: boolean; trashed: boolean; credits: number }>();
  try {
    for (let k = 0; k < 8000; k++) {
      const s = game.state;
      if (s.activePlayer === 'corp' && isCorpMain(s) && s.pendingPrompts.length === 0 && s.corp.hq.some(c => cardDef(c).type_code === 'ice') && scoringWith(s, true) !== scoringWith(s, false)) noAssetDiff++;
      if (s.activePlayer === 'corp' && isCorpMain(s) && s.turnNumber !== corpTurn) {
        corpTurn = s.turnNumber;
        turnActs = [];
        const open = Object.values(s.corp.servers).some(v => v.isRemote && v.ice.length > 0 && !v.root.some(c => ['agenda', 'asset'].includes(cardDef(c).type_code)));
        if (open && s.corp.hq.some(c => cardDef(c).type_code === 'agenda')) {
          unusedTurns++;
          // Why the iced open remote with the most ice does not hold by the count (holdCost): with the Corp's credits at
          // the turn's end, with any credits, with a Runner on no credits, or not even then (the ice)
          const v = Object.values(s.corp.servers).filter(x => x.isRemote && x.ice.length > 0 && !x.root.some(c => ['agenda', 'asset'].includes(cardDef(c).type_code))).sort((a, b) => b.ice.length - a.ice.length)[0];
          const why = asSide('corp', () => {
            if (holdCost(s, v.ice, s.corp.credits + Math.max(0, s.corp.clicks - 1)) !== null) return 'holds';
            if (holdCost(s, v.ice, Infinity) !== null) return 'corpCredits';
            const keep = CHECK.runnerExtra;
            CHECK.runnerExtra = -runnerBudget(s);
            try {
              return holdCost(s, v.ice, Infinity) !== null ? 'runnerBudget' : 'ice';
            } finally {
              CHECK.runnerExtra = keep;
            }
          });
          unusedWhy[why] = (unusedWhy[why] ?? 0) + 1;
        }
      }
      if (!game.step()) break;
      const n = game.state;
      const a = game.last!;
      if (n.runner.scoreArea.length > s.runner.scoreArea.length) {
        const where = s.activeRun?.server ?? 'none';
        const scoring = asSide('corp', () => scoringRemote(s)?.id);
        const key = where === scoring ? 'scoring' : s.corp.servers[where]?.isRemote ? 'remote' : where;
        for (const c of n.runner.scoreArea.filter(x => !s.runner.scoreArea.some(y => y.instanceId === x.instanceId))) steals[key] = (steals[key] ?? 0) + (cardDef(c).agenda_points ?? 0);
      }
      for (const v of Object.values(s.corp.servers)) for (const c of v.root) {
        const e = assets.get(c.instanceId);
        if (!e) continue;
        const after = Object.values(n.corp.servers).flatMap(x => x.root).find(x => x.instanceId === c.instanceId);
        if (after) e.credits += Math.max(0, (c.tokens.credit ?? 0) - (after.tokens.credit ?? 0));
        else if (s.activePlayer === 'runner') e.trashed = true;
      }
      if (a.player === 'corp' && s.activePlayer === 'corp') turnActs.push(a.type);
      if (a.player !== 'corp' || a.type !== 'INSTALL_CARD') continue;
      const card = s.corp.hq.find(c => c.instanceId === a.cardInstanceId);
      if (!card) continue;
      const v = Object.values(n.corp.servers).find(x => x.ice.some(c => c.instanceId === card.instanceId) || x.root.some(c => c.instanceId === card.instanceId));
      if (!v?.isRemote) continue;
      const waited = Object.values(s.corp.servers).some(x => x.isRemote && x.ice.length > 0 && !x.root.some(c => ['agenda', 'asset'].includes(cardDef(c).type_code)));
      const t = cardDef(card).type_code;
      if ((t === 'upgrade' || (t === 'asset' && !econ(card.cardCode, cardDef(card).cost ?? 0))) && !s.corp.servers[v.id] && waited) strayed++;
      if (t === 'ice') iceThisTurn.set(v.id, s.turnNumber);
      else if (cardDef(card).type_code === 'asset' && econ(card.cardCode, cardDef(card).cost ?? 0)) {
        installs++;
        assets.set(card.instanceId, { iced: v.ice.length > 0, trashed: false, credits: 0 });
        if (iceThisTurn.get(v.id) === s.turnNumber) covered++;
        if (!v.ice.length) bare++;
        if (!v.ice.length && s.corp.clicks === 1 && s.corp.hq.some(c => cardDef(c).type_code === 'ice')) {
          lastClick.n++;
          if (turnActs.slice(0, -1).some(t => t === 'DRAW_CARD' || t === 'GAIN_CREDIT')) lastClick.earlier++;
        }
      }
    }
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  console.log(JSON.stringify({ seed, deck: corpDeck.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, noAssetDiff, redirects: iceRedirectStats.fired, installs, covered, bare, strayed, unusedTurns, unusedWhy, lastClick, steals, assets: [...assets.values()], cover: { ...assetCoverStats }, partner: { ...assetPartnerStats } }));
}
