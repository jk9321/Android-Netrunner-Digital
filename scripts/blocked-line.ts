/**
 * Blocked scoring line, reservation arm (AI Coordinator 2026-11-13, measurement only): at each Corp turn start with an
 * agenda in HQ, whether an iced remote whose root holds an asset WOULD hold by the count if its root were free
 * (holdCost on its ice, with reservedForAgenda's horizon: next turn's credits less afterLineFloor) while no asset-free
 * iced remote holds. Flagged agendas are followed to the end: scored, stolen, still in HQ, or elsewhere.
 *   CANDS=cands.json [PLAN_OFF=...] [SHARD=0/4] npx vite-node scripts/blocked-line.ts > out.jsonl
 */
import { readFileSync } from 'node:fs';
import { GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS as SHIPPED_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { holdCost } from '../src/ai/corp/hold';
import { isCorpMain, knownIncome } from '../src/ai/corp/lines';
import { lineFloor as afterLineFloor } from '../src/ai/corp/rezMoney';

applyPlanOff(process.env.PLAN_OFF ?? '');
const cands: { seed: number; corp: string; runner: string }[] = JSON.parse(readFileSync(process.env.CANDS!, 'utf8'));
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const deck = (side: string, name: string) => SHIPPED_DECKS.find(d => d.side === side && d.name === name)!;
const type = (c: { cardCode: string }) => cardDef(c as never).type_code;
for (const [i, c] of cands.entries()) {
  if (i % shards !== shard) continue;
  valueLoops.clear();
  const game = new GameRunner(createInitialGameState(deckGameSetup(c.seed, deck('corp', c.corp), deck('runner', c.runner))), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  let turn = -1;
  let blockedTurns = 0;
  let assetIcedTurns = 0;
  const flagged = new Set<string>();
  try {
    for (let k = 0; k < 8000; k++) {
      const s: GameState = game.state;
      if (s.activePlayer === 'corp' && isCorpMain(s) && s.turnNumber !== turn) {
        turn = s.turnNumber;
        const agendas = s.corp.hq.filter(x => type(x) === 'agenda');
        if (agendas.length) {
          const floor = Math.min(...agendas.map(x => afterLineFloor(s, x.instanceId)));
          const nextClicks = s.corp.maxClicks + (s.corp.bonusClicksNextTurn ?? 0);
          const horizon = s.corp.credits + Math.max(0, s.corp.clicks - 1) + knownIncome(s) + nextClicks - floor;
          const iced = Object.values(s.corp.servers).filter(v => v.isRemote && v.ice.length > 0);
          const held = iced.filter(v => v.root.some(x => type(x) === 'asset'));
          const free = iced.filter(v => !v.root.some(x => type(x) === 'asset'));
          if (held.length) assetIcedTurns++;
          const freeHolds = free.some(v => holdCost(s, v.ice, horizon) !== null);
          if (!freeHolds && held.some(v => holdCost(s, v.ice, horizon) !== null)) {
            blockedTurns++;
            for (const a of agendas) flagged.add(a.instanceId);
          }
        }
      }
      if (!game.step()) break;
    }
  } catch (err) {
    console.error(`deal ${c.seed}: ${err}`);
    continue;
  }
  const e = game.state;
  const fate = { scored: 0, stolen: 0, hq: 0, other: 0 };
  for (const id of flagged) {
    if (e.corp.scoreArea.some(x => x.instanceId === id)) fate.scored++;
    else if (e.runner.scoreArea.some(x => x.instanceId === id)) fate.stolen++;
    else if (e.corp.hq.some(x => x.instanceId === id)) fate.hq++;
    else fate.other++;
  }
  console.log(JSON.stringify({ seed: c.seed, winner: e.winner, reason: e.winReason, turns: e.turnNumber, blockedTurns, assetIcedTurns, flagged: flagged.size, fate }));
}
