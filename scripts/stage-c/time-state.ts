/**
 * Stage C time check: one saved Corp decision state (slow-deal.ts SAVE=), decided by the old core and by the new one
 * (planner on), with the time each takes and the move; CORE=old or CORE=new runs only that core (for a profile:
 * node --cpu-prof node_modules/vite-node/vite-node.mjs ...).
 *   STATE=/tmp/slow/slow-2041-t17-c3-90.json npx vite-node scripts/stage-c/time-state.ts
 */
import { readFileSync } from 'node:fs';
import '../../src/ai';
import { GameAction, GameState, cardDef, findCardAnywhere } from '../../src/core';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import { plan, withPricing } from '../../src/ai/pricing';
import { newDiagnostics } from '../../src/ai/diagnostics';
import { clearCaches } from '../stage-a/harness';

const s: GameState = JSON.parse(readFileSync(process.env.STATE ?? '', 'utf8'));
const name = (a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : ''}`;
};
console.log(`T${s.turnNumber} clicks ${s.corp.clicks} credits ${s.corp.credits} HQ ${s.corp.hq.length} servers ${Object.keys(s.corp.servers).length} unrezzed root ${Object.values(s.corp.servers).flatMap(v => v.root).filter(c => !c.isRezzed).length}`);
for (const core of (process.env.CORE ? [process.env.CORE] : ['old', 'new'])) {
  const p = core === 'new' ? { ...plan(), corpCore: true, rolloutLines: true } : plan();
  const diag = newDiagnostics();
  clearCaches();
  const t = performance.now();
  const a = withPricing({ plan: p, diagnostics: diag }, () => new HeuristicCorpAI({ synergy: true }).chooseAction(structuredClone(s)));
  console.log(`${core}: ${(performance.now() - t).toFixed(0)} ms -> ${name(a)}; planner ${JSON.stringify(diag.planner)}`);
}
