/**
 * What plan.spareIce's installs cost and buy (AI Coordinator 2026-11-12, after the stack's arm split put most of its
 * -2.4 on spareIce). The Normal Corp AI v Normal Runner on the 221-deal table's deals (SEEDS, mapped as in
 * scripts/corp-card-usage.ts) with PLAN_OFF as given (the stack: +scoringNoAsset,+assetCover,+spareIce). A spare install
 * is a Corp action equal to what spareIce gives for a credit click in the state before it (the arm took over the pick).
 * Per spare remote: turn, the ice and whether an econ asset was in HQ then, the credits spent rezzing ice on it (3.4.3a)
 * and the clicks spent installing ice there (5.6.2), and what its root later held: an econ asset, another asset, an
 * upgrade, an agenda (with the turn), or nothing; and the Corp's credits at its next three turn starts. One JSON line
 * per game.
 *
 *   SEEDS=1001,1041 PLAN_OFF=+scoringNoAsset,+assetCover,+spareIce [SHARD=0/2] npx vite-node scripts/spare-ice-cost.ts > spare.jsonl
 */
import { GameAction, GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { spareIce } from '../src/ai/countedScore';
import { profileOf } from '../src/ai/cardProfiles';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

applyPlanOff(process.env.PLAN_OFF ?? '');

const econ = (code: string, cost: number) => {
  const p = profileOf(code);
  return !!p && p.pay > 0 && p.load > cost;
};
interface Spare { turn: number; ice: string; assetInHq: boolean; server: string; iceClicks: number; rezSpent: number; used: { kind: string; turn: number }[]; credits: number[] }

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const [i, seed] of seeds.entries()) {
  if (i % shards !== shard) continue;
  const p = Math.floor((seed - 1001) / 10);
  const corpDeck = corpDecks[Math.floor(p / runnerDecks.length)];
  valueLoops.clear();
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const spares: Spare[] = [];
  let lastStart = 0;
  try {
    for (let k = 0; k < 8000; k++) {
      const s: GameState = game.state;
      const credit = { type: 'GAIN_CREDIT', player: 'corp' } as GameAction;
      const would = s.activePlayer === 'corp' && s.pendingPrompts.length === 0 && !s.activeRun ? asSide('corp', () => (decisionContext(s, 'corp'), spareIce(s, credit))) : null;
      if (!game.step()) break;
      const n = game.state;
      const a = game.last!;
      // Corp turn starts: credits for the spares' next three
      if (n.activePlayer === 'corp' && n.turnNumber !== lastStart) {
        lastStart = n.turnNumber;
        for (const sp of spares) if (n.turnNumber > sp.turn && sp.credits.length < 3) sp.credits.push(n.corp.credits);
      }
      if (would && a.type === 'INSTALL_CARD' && a.cardInstanceId === (would as { cardInstanceId?: string }).cardInstanceId && (a as { asNewRemote?: boolean }).asNewRemote) {
        const server = Object.values(n.corp.servers).find(v => v.ice.some(c => c.instanceId === a.cardInstanceId))!.id;
        const ice = s.corp.hq.find(c => c.instanceId === a.cardInstanceId)!;
        spares.push({ turn: s.turnNumber, ice: cardDef(ice).title, assetInHq: s.corp.hq.some(c => cardDef(c).type_code === 'asset' && econ(c.cardCode, cardDef(c).cost ?? 0)), server, iceClicks: 1, rezSpent: 0, used: [], credits: [] });
        continue;
      }
      for (const sp of spares) {
        const v = n.corp.servers[sp.server];
        if (!v) continue;
        // More ice installed there by the Corp
        if (a.player === 'corp' && a.type === 'INSTALL_CARD' && v.ice.some(c => c.instanceId === a.cardInstanceId)) sp.iceClicks++;
        // Ice on it rezzed
        for (const c of v.ice) if (c.isRezzed && !s.corp.servers[sp.server]?.ice.find(x => x.instanceId === c.instanceId)?.isRezzed) sp.rezSpent += Math.max(0, s.corp.credits - n.corp.credits);
        // Root cards placed
        for (const c of v.root) if (!s.corp.servers[sp.server]?.root.some(x => x.instanceId === c.instanceId)) {
          const t = cardDef(c).type_code;
          sp.used.push({ kind: t === 'asset' ? (econ(c.cardCode, cardDef(c).cost ?? 0) ? 'econ asset' : 'asset') : t, turn: s.turnNumber });
        }
      }
    }
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  console.log(JSON.stringify({ seed, deck: corpDeck.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, spares }));
}
