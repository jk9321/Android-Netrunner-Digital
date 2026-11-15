/**
 * Step 4 Stage C3: the planner's view, side by side (stage-c/c3-planner-view.md). At each recorded Corp main-phase
 * decision a fresh Normal Corp of each core decides on a copy of the state; the candidate set its planner plays out
 * (diagnostics onCandidates) is compared: a move missing from the new set, a move only in the new set, same set in a
 * different order, the same card at a different server; and the distinct lines among each set (lines by the new order).
 *   SHARD=0/4 npx vite-node scripts/stage-c/planner-view.ts > view-0.json
 */
import { GameAction, GameState, cardDef, findCardAnywhere, getLegalActions } from '../../src/core';
import { createAgent } from '../../src/ai';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { newDiagnostics } from '../../src/ai/diagnostics';
import { decisionContext } from '../../src/ai/handValues';
import { corpCandidates } from '../../src/ai/corp/candidates';
import { isCorpMain } from '../../src/ai/corp/lines';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

type Tally = Record<string, number>;
const out = {
  decisions: 0,
  planned: 0,
  kinds: {} as Tally,
  missingBy: {} as Tally,
  onlyBy: {} as Tally,
  linesOld: {} as Tally,
  linesNew: {} as Tally,
  sizeOld: {} as Tally,
  sizeNew: {} as Tally,
  slots: {} as Tally,
  examples: [] as string[],
};
const inc = (t: Tally, k: string, n = 1) => (t[k] = (t[k] ?? 0) + n);
const key = (a: GameAction) => JSON.stringify(Object.fromEntries(Object.entries(a).sort()));
const cardKey = (a: GameAction) => ('cardInstanceId' in a ? `${a.type}:${a.cardInstanceId}` : a.type);
const cardOf = (s: GameState, a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  return id ? findCardAnywhere(s, id) : undefined;
};
const label = (s: GameState, a: GameAction) => {
  const c = cardOf(s, a);
  const at = 'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : 'asNewRemote' in a && a.asNewRemote ? '@new' : '';
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${at}`;
};
const kindOf = (s: GameState, a: GameAction) => {
  const c = cardOf(s, a);
  return `${a.type}${c ? ':' + cardDef(c).type_code : ''}`;
};

function planned(s: GameState, core: boolean): { actions: GameAction[] | null; slots: Record<string, number> } {
  const diag = newDiagnostics();
  let seen: GameAction[] | null = null;
  diag.onCandidates = (side, _values, actions) => {
    if (side === 'corp' && !seen) seen = actions;
  };
  const p = { ...plan(), corpCore: core, rolloutLines: core };
  withPricing({ plan: p, diagnostics: diag }, () => {
    clearCaches();
    createAgent('corp', 'normal').chooseAction(structuredClone(s));
  });
  const { agendaSlot, agendaSlotWins, buildSlot, buildSlotWins } = diag.planner;
  return { actions: seen, slots: { agendaSlot, agendaSlotWins, buildSlot, buildSlotWins } };
}

forEachRecorded({
  decision: d => {
    const s = d.state;
    if (d.kind !== 'action' || !isCorpMain(s)) return;
    out.decisions++;
    const old = planned(s, false);
    const neu = planned(s, true);
    for (const [k, v] of Object.entries(neu.slots)) inc(out.slots, k, v);
    if (!old.actions && !neu.actions) return;
    out.planned++;
    const o = old.actions ?? [];
    const n = neu.actions ?? [];
    inc(out.sizeOld, String(o.length));
    inc(out.sizeNew, String(n.length));
    // Lines by the new order (the candidate list on this state)
    const lines = new Map<string, number>();
    withPricing({ plan: { ...plan(), corpCore: true } }, () =>
      asSide('corp', () => {
        decisionContext(s, 'corp');
        for (const c of corpCandidates(s, getLegalActions(s, 'corp'), { held: (d.before?.heldLine ?? null) as never, freeExhausted: false })) lines.set(cardKey(c.action), c.line);
      }),
    );
    const distinct = (xs: GameAction[]) => new Set(xs.map(a => lines.get(cardKey(a)) ?? 0)).size;
    inc(out.linesOld, String(distinct(o)));
    inc(out.linesNew, String(distinct(n)));
    const ok = new Set(o.map(key));
    const nk = new Set(n.map(key));
    const missing = o.filter(a => !nk.has(key(a)));
    const only = n.filter(a => !ok.has(key(a)));
    const moved = missing.filter(a => n.some(b => cardKey(b) === cardKey(a) && !ok.has(key(b))));
    const kinds: string[] = [];
    if (moved.length) kinds.push('same card, other server');
    if (missing.length > moved.length) kinds.push('missing from new');
    if (only.length > moved.length) kinds.push('only in new');
    if (!missing.length && !only.length) kinds.push(o.map(key).join() === n.map(key).join() ? 'same set, same order' : 'same set, other order');
    for (const k of kinds) inc(out.kinds, k);
    for (const a of missing) if (!moved.includes(a)) inc(out.missingBy, kindOf(s, a));
    for (const a of only) if (!moved.some(m => cardKey(m) === cardKey(a))) inc(out.onlyBy, kindOf(s, a));
    if (out.examples.length < 40 && kinds.includes('missing from new'))
      out.examples.push(`${d.src} T${s.turnNumber} c${s.corp.clicks} $${s.corp.credits}: old [${o.map(a => label(s, a)).join('; ')}] new [${n.map(a => label(s, a)).join('; ')}]`);
  },
});
console.log(JSON.stringify(out));
