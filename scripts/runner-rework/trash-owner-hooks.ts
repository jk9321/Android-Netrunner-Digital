/**
 * R-B O1b (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/o1b-trash-owner.md rev 2, step 0 and bar 2; tracker
 * R-14f): the hooks and the planted faults of the trash-owner scripts. Text patches on scratch copies of the BASE src
 * (beta ad25482), never on the repo's src; each must match exactly once (a stop otherwise).
 *
 * OWNER (the base tree only; the control tree carries the same text with the global unset, so it times the base's own
 * work): base trashNet keeps returning its own value (`__old`, the printed cost tested on the pool); beside it, while the
 * measuring script sets `__toNet`, it works out the branch's value exactly as the branch's trashNet does (the engine's
 * trashCost; offerMidAccess's test: cannotStealOrTrash, availableCredits for a trash, the grip for trashGripCost; the
 * entry's trashedByRunner tags at tagCost on the board after the trash is paid, the same memo key) and hands both, with
 * the causes present, to the global. A FIRE is a call where the two differ by more than 0.001. Causes (several may hold):
 *   tag       the entry's trash fact applies (Public Access Plaza, rezzed, threat 2)
 *   cost      the engine's trash cost is not the printed one (Mahkota Langit Grid)
 *   purseOut  outside a run: the engine's purse test (pool + hosted trash payers: Azimat) differs from the pool test
 *   purseRun  during a run: the same, where the bad-publicity fund, the run payers, run-event credits and a locked pool
 *             also count (red team second pass m1)
 *   blocked   cannotStealOrTrash (Ansel 1.0, Perfect Recall)
 *   grip      the grip is short of the card's trashGripCost (Daniela Jorge Inácio)
 * FACT: the Plaza's entry gets the branch's fact (the same line as the branch's elevation.ts), read only by the hook.
 *
 * FAULTS (step 0.4): two planted faults that do not touch trashNet's changed inputs, each on a copy of the BASE tree:
 *   seen001  0.01 added to the seen, unrezzed root card's trash line where it adds anything and no trash fact applies
 *   hq001    0.01 added to HQ's term
 */
import type { Patch } from './core-hooks';

const G = '(globalThis as any)';

export const FACT: Patch[] = [
  [
    'ai/cards/elevation.ts',
    `    synergy: { gives: { econ: 1 }, when: ['threat'] },\n    value: { keep: 3, econ: 2.5 },`,
    `    synergy: { gives: { econ: 1 }, when: ['threat'] },\n    runFacts: { trashedByRunner: { tags: 1, when: { threatAtLeast: 2 }, rezzed: true } },\n    value: { keep: 3, econ: 2.5 },`,
  ],
];

export const OWNER: Patch[] = [
  [
    'ai/runs.ts',
    `import { availableCredits, counters, rezCost, stealthCredits, threatLevel, turnFlag } from '../core/engine/cardEffects';\nimport { stealCost } from '../core/engine/actions/run';`,
    `import { availableCredits, counters, rezCost, stealthCredits, threatLevel, trashCost as __trashCost, turnFlag } from '../core/engine/cardEffects';\nimport { cannotStealOrTrash as __cannotStealOrTrash, stealCost } from '../core/engine/actions/run';`,
  ],
  [
    'ai/runs.ts',
    `function trashNet(state: GameState, card: CardInstance): number {\n  const trash = cardDef(card).trash_cost;\n  return trash != null && trash <= state.runner.credits ? Math.max(0, corpCardValue(card, state, 'runner', true) - creditCost(state, trash)) : 0;\n}`,
    `function trashNet(state: GameState, card: CardInstance): number {
  const trash = cardDef(card).trash_cost;
  const __old = trash != null && trash <= state.runner.credits ? Math.max(0, corpCardValue(card, state, 'runner', true) - creditCost(state, trash)) : 0;
  if (${G}.__toNet) ${G}.__toNet(__old, card.cardCode, __trashOwner(state, card, trash));
  return __old;
}
/** The branch's trashNet, line for line (src/ai/runs.ts on ai-runner-trash-owner), with the causes present. */
function __trashOwner(state: GameState, card: CardInstance, printed: number | null | undefined): { value: number; causes: string[] } {
  const causes: string[] = [];
  const cost = __trashCost(state, card);
  if (cost !== (printed ?? null)) causes.push('cost');
  if (cost == null) return { value: 0, causes };
  if (__cannotStealOrTrash(state, card)) {
    causes.push('blocked');
    return { value: 0, causes };
  }
  const purse = availableCredits(state, 'runner', { kind: 'trash', card });
  if (purse >= cost !== state.runner.credits >= cost) causes.push(state.activeRun && !state.activeRun.accessOnly ? 'purseRun' : 'purseOut');
  const gripShort = state.runner.grip.length < (getCardScript(card.cardCode)?.trashGripCost ?? 0);
  if (gripShort) causes.push('grip');
  if (purse < cost || gripShort) return { value: 0, causes };
  const net = corpCardValue(card, state, 'runner', true) - creditCost(state, cost);
  const hit = runFactsOf(card.cardCode)?.trashedByRunner;
  if (!hit || (hit.rezzed && !card.isRezzed) || !meets(state, hit.when)) return { value: Math.max(0, net), causes };
  causes.push('tag');
  const left = state.runner.credits - Math.max(0, cost - Math.max(0, purse - state.runner.credits));
  const tag = memo(state, \`tagAfterTrash:\${left}\`, () => tagCost({ ...state, runner: { ...state.runner, credits: left } }));
  return { value: Math.max(0, net - hit.tags * tag), causes };
}`,
  ],
];

export const FAULTS: Record<string, Patch[]> = {
  seen001: [
    [
      'ai/runs.ts',
      `      value += trashNet(state, card);\n    } else if (!card.isRezzed) {`,
      `      {\n        const __t = trashNet(state, card);\n        value += __t > 0 && !runFactsOf(card.cardCode)?.trashedByRunner ? __t + 0.01 : __t;\n      }\n    } else if (!card.isRezzed) {`,
    ],
  ],
  hq001: [
    [
      'ai/runs.ts',
      `    value = unchosen === 0 ? 0 : Math.min(accesses, unchosen) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat;`,
      `    value = unchosen === 0 ? 0 : Math.min(accesses, unchosen) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat + 0.01;`,
    ],
  ],
};
