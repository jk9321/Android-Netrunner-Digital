/**
 * Stage D exploit F2 (grip money), "found": the self-play deals played by a plain GameRunner (this tree's Normal AIs,
 * nothing measured), each agenda install and advance listed, to tell which run of grip-money-fire.ts followed the
 * batch's own game (run 44325218648 with PARTS=fire,commits and run 44334229563 with PARTS=commits differ on deals
 * 3041, 2321, 2241, 2201).
 *   DEALS=3041,2321,2201,2241 npx vite-node scripts/stage-d/grip-money-plain.ts
 */
import { CardInstance, cardDef } from '../../src/core';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { dealState } from '../stage-a/harness';

for (const deal of (process.env.DEALS ?? '3041').split(',').map(Number)) {
  const g = new GameRunner(dealState(deal), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const out: string[] = [];
  for (let k = 0; k < 6000; k++) {
    const b = g.state;
    if (!g.step()) break;
    const a = g.last;
    if (a?.player !== 'corp' || (a.type !== 'INSTALL_CARD' && a.type !== 'ADVANCE_CARD')) continue;
    const all: CardInstance[] = [...Object.values(b.corp.servers).flatMap(s => [...s.root, ...s.ice]), ...b.corp.hq];
    const c = all.find(x => x.instanceId === a.cardInstanceId);
    const server = a.type === 'INSTALL_CARD' ? a.targetServerId : a.serverId;
    if (c && cardDef(c).type_code === 'agenda') out.push(`T${b.turnNumber} ${a.type} ${c.instanceId} ${server ?? ''}`);
  }
  console.log(`${deal} winner ${g.state.winner} T${g.state.turnNumber}: ${out.join('; ')}`);
}
