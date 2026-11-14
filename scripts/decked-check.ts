/**
 * Decked games, reservation arm (AI Coordinator 2026-11-13): replays batch deals (seed and deck names, as
 * scripts/corp-losses.ts plays them) as PLAN_OFF gives (written for the plan.assetReserve arm, now folded) and reports, per deal: winner, win
 * reason (4.2.7b: decked), Corp turns, and agendaAssetTurns: agendas in HQ at each Corp turn start while the remote with
 * the most ice holds an asset in its root (3.3.1). Measurement only.
 *   CANDS=cands.json [PLAN_OFF=...] [SHARD=0/4] npx vite-node scripts/decked-check.ts > out.jsonl
 */
import { readFileSync } from 'node:fs';
import { GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS as SHIPPED_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { isCorpMain } from '../src/ai/corp/lines';

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
  let agendaAssetTurns = 0;
  let agendaTurns = 0;
  try {
    for (let k = 0; k < 8000; k++) {
      const s: GameState = game.state;
      if (s.activePlayer === 'corp' && isCorpMain(s) && s.turnNumber !== turn) {
        turn = s.turnNumber;
        const agendas = s.corp.hq.filter(x => type(x) === 'agenda').length;
        agendaTurns += agendas;
        const best = Object.values(s.corp.servers).filter(v => v.isRemote && v.ice.length > 0).sort((a, b) => b.ice.length - a.ice.length)[0];
        if (best?.root.some(x => type(x) === 'asset')) agendaAssetTurns += agendas;
      }
      if (!game.step()) break;
    }
  } catch (err) {
    console.error(`deal ${c.seed}: ${err}`);
    continue;
  }
  const e = game.state;
  console.log(JSON.stringify({ seed: c.seed, winner: e.winner, reason: e.winReason, turns: e.turnNumber, corp: e.corp.score, runner: e.runner.score, agendaTurns, agendaAssetTurns, hqAgendas: e.corp.hq.filter(x => type(x) === 'agenda').map(x => cardDef(x).title), rd: e.corp.rd.length }));
}
