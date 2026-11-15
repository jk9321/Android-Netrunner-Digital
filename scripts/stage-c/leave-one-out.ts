/**
 * Step 4 Stage C7: leave-one-out on recorded decisions (spec section 5). At each recorded Corp main-phase decision
 * (local deals and human games, split by SHARD), a fresh Normal Corp of the new core (corpCore, rolloutLines) decides
 * with nothing left out, recording which carried-over rules applied anywhere in the decision (look-ahead included:
 * corp/candidates.ts `leaveOut.fired`). Then, for each rule that applied, it decides again with that rule left out. A
 * rule that did not apply cannot change the decision (the decision is deterministic), so it is not re-run.
 * One JSON line per decision; sum with leave-one-out-sum.mjs. ARGS: a comma list of arms to try (default all).
 *   SHARD=0/64 npx vite-node scripts/stage-c/leave-one-out.ts > loo-0.txt
 */
import { GameAction, GameState, cardDef, findCardAnywhere } from '../../src/core';
import { createAgent } from '../../src/ai';
import { plan, withPricing } from '../../src/ai/pricing';
import { isCorpMain } from '../../src/ai/corp/lines';
import { leaveOut } from '../../src/ai/corp/candidates';
import { HeuristicCorpAI, lethalHqAgenda } from '../../src/ai/corpAI';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

export const ARMS = [
  ...Array.from({ length: 9 }, (_, k) => `line${k + 1}`),
  'isPettyCash', 'tagsBeforeScore', 'overAdvance', 'tagFirst', 'trapAdvanceCap', 'assetAdvance', 'advancesAsIce', 'hqTrashCost', 'pettyCashFirst', 'tagFirstPick',
  // The re-expressed rules of c0-rulings 15:50Z and 16:00Z (fire counts; leave-one-out too)
  'lethalHq', 'hqNoSafer', 'rezWorth', 'archivesR6', 'freeRezPaid',
];
const want = (process.env.ARGS ?? '').split(',').filter(Boolean);
const arms = want.length ? ARMS.filter(a => want.includes(a)) : ARMS;

const name = (s: GameState, a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  const to = 'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : a.type === 'INSTALL_CARD' ? '@new' : '';
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${to}`;
};
const decide = (s: GameState, off: string[]) =>
  withPricing({ plan: { ...plan(), corpCore: true, rolloutLines: true } }, () => {
    leaveOut.off = new Set(off);
    leaveOut.fired = new Set();
    clearCaches();
    const t = performance.now();
    const a = createAgent('corp', 'normal').chooseAction(structuredClone(s));
    const ms = performance.now() - t;
    const fired = [...leaveOut.fired];
    leaveOut.off = new Set();
    return { move: name(s, a), fired, ms: Math.round(ms) };
  });

forEachRecorded({
  decision: d => {
    if (d.kind !== 'action' || !isCorpMain(d.state)) return;
    const s = d.state;
    // The old rules' own fire tests on the same state (the ranking's lethalHqAgenda, and hqNoSafer for any remote while an
    // agenda is in HQ), for the fire count against the re-expressed clauses
    const old = withPricing({ plan: { ...plan(), corpCore: false } }, () =>
      asSide('corp', () => {
        decisionContext(s, 'corp');
        const ai = new HeuristicCorpAI({ synergy: true }) as unknown as { hqNoSafer(st: GameState, server: unknown, credits: number): boolean };
        const agendaInHq = s.corp.hq.some(c => cardDef(c).type_code === 'agenda');
        return {
          lethalHq: lethalHqAgenda(s) && s.corp.hq.some(c => cardDef(c).type_code === 'ice'),
          hqNoSafer: agendaInHq && Object.values(s.corp.servers).some(v => v.isRemote && ai.hqNoSafer(s, v, s.corp.credits)),
        };
      }),
    );
    const base = decide(s, []);
    const changed: Record<string, string> = {};
    for (const arm of arms.filter(a => base.fired.includes(a))) {
      const r = decide(s, [arm]);
      if (r.move !== base.move) changed[arm] = r.move;
    }
    console.log(JSON.stringify({ src: d.src, i: d.i, T: s.turnNumber, clicks: s.corp.clicks, credits: s.corp.credits, base: base.move, fired: base.fired.filter(a => arms.includes(a)), changed, old: Object.keys(old).filter(k => old[k as keyof typeof old]), ms: base.ms }));
  },
});
