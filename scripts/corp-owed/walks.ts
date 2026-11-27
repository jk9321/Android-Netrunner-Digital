/**
 * Owed count 7 (F105, brief /mnt/project-files/netrunner-ai/owed-counts/brief.md item 7): the L9 count's walk-side leads
 * (runner-rework/l9/count-note.md, "What is left" groups 1 to 5) read on boards built for each lead, on beta 9154f02's
 * src as it is (no arm: this script imports src directly). Each board is a Corp end of turn with one server and its ice;
 * three readings of "does the Runner get in this coming turn":
 *   runner  the Runner's "can I get in" (facts-log.ts runnerCanGetIn, with exported readers: each ice's icePrice, runBudget,
 *           approachCost), on the board at the Runner's turn start, the Runner's context;
 *   walk    the hold walk (corp/hold.ts serverHold, when 'restOfTurn', at the Runner's turn start), the Corp's context;
 *   oracle  the engine (scripts/stage-d/hold-oracle.ts oracleGetsIn, 'runnerTurn'): the Runner's turn played in the
 *           engine and searched (gain credits, draw, remove tags, use rig abilities, run, every break and payment), the
 *           Corp rezzing the ice asked.
 * The oracle is the judge (the card text and the rules, played).
 *
 *   npx vite-node scripts/corp-owed/walks.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { GameState, executeAction } from '../../src/core';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { approachCost, bioroidClicks, icePrice, runBudget, runBypasses } from '../../src/ai/runs';
import { serverHold } from '../../src/ai/corp/hold';
import { clearHandCaches } from '../../src/ai/handValues';
import '../../src/ai';
import { oracleGetsIn } from '../stage-d/hold-oracle';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';

const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
function runnerCanGetIn(s: GameState, id: string) {
  return asSide('runner', () => {
    decisionContext(s, 'runner');
    const server = s.corp.servers[id];
    const by = runBypasses(s, id);
    const budget = runBudget(s);
    let known = 0;
    const prices: string[] = [];
    for (const ice of server.ice) {
      if (by.ids.has(ice.instanceId)) continue;
      const p = icePrice(s, ice);
      prices.push(`${p.credits}+${r3(p.value)}`);
      if (p.credits + p.value === Infinity) return { can: false, why: 'block', known: Infinity, budget, prices };
      if (ice.isRezzed) known += p.credits;
    }
    if (known > budget) return { can: false, why: 'credits', known, budget, prices };
    const approach = approachCost(s, id, s.runner.clicks - 1 - bioroidClicks(s, server.ice), budget - known);
    if (!approach) return { can: false, why: 'approach', known, budget, prices };
    return { can: true, why: 'in', known, budget, prices };
  });
}
interface Case {
  lead: string;
  ice: { code: string; rezzed: boolean }[]; // outermost last (installIceForTest pushes)
  rig: string[];
  credits: number[];
  tags?: number;
  corpCredits?: number;
}
const CASES: Case[] = [
  { lead: '1 Whitespace (code gate), no breaker', ice: [{ code: '30074', rezzed: true }], rig: [], credits: [2, 4, 5, 6, 8, 10, 11] },
  { lead: '1 Whitespace, Unity (decoder)', ice: [{ code: '30074', rezzed: true }], rig: ['30026'], credits: [0, 1, 2, 4, 5, 6, 8] },
  { lead: '4 Grubber (barrier, str 5), no breaker', ice: [{ code: '36050', rezzed: true }], rig: [], credits: [0, 1, 2, 3, 4, 5, 6] },
  { lead: '4 Grubber, Cleaver (fracter str 3)', ice: [{ code: '36050', rezzed: true }], rig: ['30006'], credits: [0, 1, 2, 3, 4, 5, 6] },
  { lead: '5 Event Horizon (sentry), no breaker, one program', ice: [{ code: '36058', rezzed: true }], rig: ['30026'], credits: [0, 1, 2, 3, 4, 6] },
  { lead: '5 Event Horizon, Carmen (killer)', ice: [{ code: '36058', rezzed: true }], rig: ['30015'], credits: [0, 1, 2, 3, 4, 6] },
  { lead: '2 Flyswatter (code gate, ETR) rezzed, no breaker', ice: [{ code: '35079', rezzed: true }], rig: [], credits: [2, 5, 10] },
  { lead: '2 Flyswatter rezzed, Unity', ice: [{ code: '35079', rezzed: true }], rig: ['30026'], credits: [0, 1, 2, 5] },
  { lead: '2 Flyswatter unrezzed, no breaker (Corp can rez)', ice: [{ code: '35079', rezzed: false }], rig: [], credits: [2, 5, 10] },
  { lead: '2 Bumi 1.0 > Flyswatter (outer Bumi), Unity', ice: [{ code: '35079', rezzed: true }, { code: '35041', rezzed: true }], rig: ['30026'], credits: [2, 5, 10] },
  { lead: '3 Doomscroll outer, Lamplighter inner, no breaker', ice: [{ code: '35080', rezzed: true }, { code: '35063', rezzed: true }], rig: [], credits: [2, 5, 10] },
  { lead: '3 Doomscroll > Lamplighter, Carmen (killer)', ice: [{ code: '35080', rezzed: true }, { code: '35063', rezzed: true }], rig: ['30015'], credits: [0, 2, 3, 5, 10] },
  { lead: '3 Lamplighter alone, no breaker', ice: [{ code: '35080', rezzed: true }], rig: [], credits: [0, 2, 3, 5] },
];

function board(c: Case, credits: number): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.grip = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.memoryUnitsUsed = 0;
  s.corp.credits = c.corpCredits ?? 10;
  s.turnNumber = 6;
  s.runner.tags = c.tags ?? 0;
  for (const i of c.ice) installIceForTest(s, i.code, 'rd', i.rezzed);
  for (const p of c.rig) installProgramForTest(s, p);
  s.runner.credits = credits;
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.corp.clicks = 0;
  return s;
}

function main() {
  console.log('| lead | Runner credits | runner says | its why (budget; ice prices) | walk says | walk need / budget | oracle |');
  console.log('|---|---:|---|---|---|---|---|');
  for (const c of CASES) {
    for (const cr of c.credits) {
      const s = board(c, cr);
      let t: GameState = executeAction(structuredClone(s), { type: 'END_TURN', player: 'corp' });
      while (t.pendingPrompts.length && t.activePlayer !== 'runner') t = executeAction(t, { type: 'RESOLVE_PROMPT', player: t.pendingPrompts[0].side, promptId: t.pendingPrompts[0].id, choice: { kind: 'discard', cardInstanceIds: [] } } as any);
      clearHandCaches();
      const runner = runnerCanGetIn(structuredClone(t), 'rd');
      clearHandCaches();
      const walk: any = asSide('corp', () => {
        decisionContext(t, 'corp');
        return serverHold(structuredClone(t), 'rd', { when: 'restOfTurn', corpCredits: t.corp.credits });
      });
      const rez = s.corp.servers.rd.ice.map(x => x.instanceId);
      const o = oracleGetsIn(structuredClone(s), 'rd', 'runnerTurn', rez, s.corp.credits, 60000);
      console.log(`| ${c.lead} | ${cr} | ${runner.can ? 'in' : 'out'} | ${runner.why} (${r3(runner.budget)}; ${runner.prices.join(', ')}) | ${walk.holds ? 'holds' : 'in'} | ${r3(walk.need)} / ${r3(walk.budget)} | ${o.answer}${o.skipped ? ' ' + o.skipped : ''} |`);
    }
  }
}
main();
