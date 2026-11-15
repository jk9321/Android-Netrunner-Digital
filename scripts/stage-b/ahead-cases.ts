/**
 * Stage B2: countedRez's own sum of the rezzed ice further in (corp/rez.ts `ahead`) against the hold owner (serverHold
 * 'thisRun', no rezzes, the approached ice not counted). Prints each rez window where "the ice ahead stops the Runner
 * already" differs, and the count of windows checked.
 *
 *   npx vite-node scripts/stage-b/ahead-cases.ts
 */
import { GameState, cardDef } from '../../src/core';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { serverHold } from '../../src/ai/corp/hold';
import { BLOCK, iceCreditNeed } from '../../src/ai/runs';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

let checked = 0;
let differ = 0;
forEachRecorded({
  decision: d => {
    const s: GameState = d.state;
    const run = s.activeRun;
    if (d.kind !== 'rez' || !run || run.icePosition === null || s.priority?.step !== 'approach_ice') return;
    const server = s.corp.servers[run.server];
    const ice = server?.ice[run.icePosition];
    if (!ice || ice.isRezzed) return;
    asSide('corp', () => {
      decisionContext(s, 'corp');
      const up = { ...ice, isRezzed: true };
      const view: GameState = { ...s, corp: { ...s.corp, servers: { ...s.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? up : c)) } } } };
      const ahead = server.ice.slice(0, run.icePosition!).filter(c => c.isRezzed).reduce((n, c) => n + iceCreditNeed(view, c), 0);
      const own = ahead === BLOCK || ahead > s.runner.credits;
      const h = serverHold(s, run.server, { when: 'thisRun', mustRez: [], further: false });
      checked++;
      if (own === h.holds) return;
      differ++;
      console.log(JSON.stringify({ at: `${d.src} #${d.i} T${d.turn}`, server: run.server, ice: cardDef(ice).title, ahead, own, ownerHolds: h.holds, ownerNeed: h.need, budget: h.budget, further: server.ice.slice(0, run.icePosition!).filter(c => c.isRezzed).map(c => cardDef(c).title) }));
    });
    clearCaches();
  },
});
console.log(`checked ${checked}, differ ${differ}`);
