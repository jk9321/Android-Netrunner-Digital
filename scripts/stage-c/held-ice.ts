/**
 * Stage C (c0-rulings 16:15Z (b)): ice installs the new core makes while a two-turn score line is held. Rule 1 of place
 * (corp/placement.ts) keeps every install that is not the line's own step at its proposal; this asks, at each recorded
 * Corp main-phase decision where a fresh Normal Corp of the new core installs ice and `scoreInTwoPick` holds a line
 * (and the install is not the line's step), where rules 2 to 5 of place (`placePick`) would have put the same install.
 * One JSON line per such decision; sum with held-ice-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/stage-c/held-ice.ts > held-0.txt
 */
import { GameAction, cardDef } from '../../src/core';
import { createAgent } from '../../src/ai';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { isCorpMain } from '../../src/ai/corp/lines';
import { placePick, scoreInTwoPick } from '../../src/ai/corp/placement';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

type Install = GameAction & { type: 'INSTALL_CARD'; cardInstanceId: string; targetServerId?: string; asNewRemote?: boolean };
const where = (a: GameAction) => (a.type === 'INSTALL_CARD' ? ((a as Install).asNewRemote || !(a as Install).targetServerId ? 'new' : (a as Install).targetServerId!) : a.type);
let total = 0;
let ice = 0;
forEachRecorded({
  decision: d => {
    if (d.kind !== 'action' || !isCorpMain(d.state)) return;
    const s = d.state;
    total++;
    withPricing({ plan: { ...plan(), corpCore: true, rolloutLines: true } }, () => {
      clearCaches();
      const a = createAgent('corp', 'normal').chooseAction(structuredClone(s));
      if (a.type !== 'INSTALL_CARD') return;
      const card = s.corp.hq.find(c => c.instanceId === (a as Install).cardInstanceId);
      if (!card || cardDef(card).type_code !== 'ice') return;
      ice++;
      asSide('corp', () => {
        decisionContext(s, 'corp');
        const two = scoreInTwoPick(s, a, null);
        const held = two.held && two.held.game === s.id ? two.held : null;
        if (!held || two.action !== a) return;
        const rules = placePick(s, a);
        console.log(JSON.stringify({ src: d.src, i: d.i, T: s.turnNumber, ice: cardDef(card).title, made: where(a), rules: where(rules), line: `${held.line.agenda}@${held.line.server}`, differs: where(rules) !== where(a) }));
      });
    });
  },
});
console.log(JSON.stringify({ summary: true, decisions: total, iceInstalls: ice }));
