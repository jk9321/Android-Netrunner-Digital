/**
 * Step 4 Stage C6 (SB-TWO-FLOORS): on the recorded states, the counted line's floor read as rezMoney's keep (one floor,
 * plan.corpCore) against the byServer sum it read before (corp/rezMoney.ts lineFloor), for every agenda a line could
 * take (in HQ or installed). Output: one JSON line of counts and the differing pairs.
 *   SHARD=0/4 npx vite-node scripts/stage-c/floor-log.ts > floor-0.json
 */
import { cardDef } from '../../src/core';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { floorLog, lineFloor } from '../../src/ai/corp/rezMoney';
import { isCorpMain } from '../../src/ai/corp/lines';
import { forEachRecorded } from '../stage-a/harness';

floorLog.on = true;
let states = 0;
const bySrc: Record<string, number> = {};
forEachRecorded({
  decision: d => {
    const s = d.state;
    if (d.kind !== 'action' || !isCorpMain(s)) return;
    const agendas = [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => v.root)].filter(c => cardDef(c).type_code === 'agenda');
    if (!agendas.length) return;
    states++;
    const before = floorLog.differ.length;
    withPricing({ plan: { ...plan(), corpCore: true } }, () =>
      asSide('corp', () => {
        decisionContext(s, 'corp');
        for (const a of agendas) lineFloor(s, a.instanceId);
      }),
    );
    if (floorLog.differ.length > before) bySrc[d.src.split(':')[0]] = (bySrc[d.src.split(':')[0]] ?? 0) + 1;
  },
});
console.log(JSON.stringify({ states, checked: floorLog.checked, differ: floorLog.differ.length, statesDiffering: bySrc, pairs: floorLog.differ.slice(0, 50) }));
