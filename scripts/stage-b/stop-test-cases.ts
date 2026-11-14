/**
 * Stage B2 (review N10): the rez windows where modelRezParts' own stop test (rezModel.ts) and the hold owner
 * (serverHold 'thisRun', the approached ice alone) disagree, with the inputs each read, so each case can be labelled.
 *
 *   DEALS=2761 HUMAN=report-18,report-20,report-23,report-41 npx vite-node scripts/stage-b/stop-test-cases.ts
 */
import { GameState, cardDef, isLegalAction } from '../../src/core';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { modelRezParts } from '../../src/ai/rezModel';
import { serverHold } from '../../src/ai/corp/hold';
import { iceCreditNeed, plannedSubroutines, subroutineCost } from '../../src/ai/runs';
import { simulate } from '../../src/ai/prompts';
import { rezCost } from '../../src/core/engine/cardEffects';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

forEachRecorded({
  decision: d => {
    const s: GameState = d.state;
    const run = s.activeRun;
    if (d.kind !== 'rez' || !run || run.icePosition === null || s.priority?.step !== 'approach_ice') return;
    const ice = s.corp.servers[run.server]?.ice[run.icePosition];
    if (!ice) return;
    asSide('corp', () => {
      decisionContext(s, 'corp');
      const parts = modelRezParts(s, ice, true);
      const h = serverHold(s, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further: false });
      if (!parts || parts.stops === h.holds) return;
      const after = simulate(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId });
      const rezzed = after?.corp.servers[run.server]?.ice.find(c => c.instanceId === ice.instanceId);
      const up = { ...ice, isRezzed: true };
      const view: GameState = { ...s, corp: { ...s.corp, servers: { ...s.corp.servers, [run.server]: { ...s.corp.servers[run.server], ice: s.corp.servers[run.server].ice.map(c => (c.instanceId === ice.instanceId ? up : c)) } } } };
      console.log(JSON.stringify({
        at: `${d.src} #${d.i} T${d.turn}`, server: run.server, ice: cardDef(ice).title, pos: `${run.icePosition}/${s.corp.servers[run.server].ice.length}`,
        modelStops: parts.stops, ownerHolds: h.holds, ownerNeed: h.need, ownerBudget: h.budget,
        runnerCredits: s.runner.credits, runnerCreditsAfterRez: after?.runner.credits, tagsBefore: s.runner.tags, tagsAfter: after?.runner.tags,
        needOnView: iceCreditNeed(view, up), needAfterRez: after && rezzed ? String(iceCreditNeed(after, rezzed)) : `no rezzed card (after ${!!after})`, subsView: plannedSubroutines(view, up).map(x => `${x.label}=${subroutineCost(view, x.label)}`), subsAfter: after && rezzed ? plannedSubroutines(after, rezzed).map(x => `${x.label}=${subroutineCost(after, x.label)}`) : [], rezLegal: isLegalAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId }), needOnViewS: String(iceCreditNeed(view, up)),
        corpCredits: s.corp.credits, rig: [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title).join(', '),
        gripBefore: s.runner.grip.length, gripAfter: after?.runner.grip.length, credBase: s.corp.credits, rezCostEngine: rezCost(s, ice),
        aheadRezzed: s.corp.servers[run.server].ice.slice(0, run.icePosition).filter(c => c.isRezzed).map(c => cardDef(c).title),
      }));
    });
    clearCaches();
  },
});
