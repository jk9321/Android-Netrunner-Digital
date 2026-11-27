/**
 * F114 + F110 (brief /mnt/project-files/netrunner-ai/tag-clock-input/brief.md rev 2): scratch trees for phase A and the
 * ruled arm. Every tree is a copy of the merge base's src (`git archive <ARM_BASE> src`, scripts/corp-owed/trees.ts
 * makeTree) with text patches; the repo's src is never written. Tree dirs go through resolve() (scripts/corp-owed/trees.ts
 * loadTree: a relative dir loads second module instances).
 *
 * Each patched tree reads its own switch object, `globalThis.__tci_<tree name>` (one process holds several trees, so a
 * switch set for the pricing tree never reaches the tree that plays). Unset, every patched line does what the merge
 * base's line did:
 *   c1    part C, C1: the trash's cost is clickPrice(state, 'corp', viewer) plus creditsLessCost(state, 'corp', viewer, 2)
 *         (the one new function beside sideCreditValue, valueModel.ts), read in tagLossPerTurn on the board it is given,
 *         before the tag-pricing frame and the copy, and passed to tagLoss as a number. Only when a resource is priced
 *         (a resource past `skip`, and 2 Corp credits: today's gate).
 *   c1in  with c1: the same cost read inside the frame, on tagLoss's copy (phase A 1 f's identity: inside against outside).
 *   p     part P: a punisher is a card with the ifTagged flag AND type operation; the identity's term goes under the same
 *         test (an identity is not an operation, so it is 0).
 *   pCorp with p: P in the Corp's view only; the Runner's view keeps base's test (ruling 1, 2026-11-27 03:08Z).
 *   dbg   a function: called with tagLoss's parts { nets, cost, viewer, skip, held, punish, id } (read-only).
 * Two counters, read by phase A 1 e (only when the global is set): __tciKeep.n counts rezMoney's keep work-outs (the
 * memo's miss in corp/rezMoney.ts), __tciKeep.clock counts tagLoss's own work-outs.
 *
 * PATCH TEXT FOR THE BUILD: the c1 / p lines are written as the build will write them (phase B, bar 2: the branch is the
 * ruled arm, lockstep on every g1 deal), with the switch reads around them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolve } from 'node:path';
import type { Patch } from '../corp-owed/trees';

/** The merge base the brief names (beta 3680b7f, src/ai tree 3fbc3bd6); ARM_BASE overrides it with a full SHA. */
export const MERGE_BASE = process.env.ARM_BASE ?? '3680b7f21c012f4fa1fbec38f4817cdf49bec654';

export const NEW_FUNCTION = `

/**
 * What \`n\` credits less cost \`side\`, as \`viewer\` prices them (F110, brief tag-clock-input rev 2, part C): sideCreditValue's own
 * difference between the credits now and \`n\` fewer, with the need read once. Exact: the need does not read the side's
 * credits (the Corp's keep asks serverHold with corpCredits Infinity, corp/rezMoney.ts; the Runner-view boardNeed and
 * buildTarget read none), so both reads of sideCreditValue would work it out on the same number. The money in reach is
 * read at both credit counts, as the owner does. The credit's owner's own marginal (docs/ai-priced-quantities.md).
 */
export function creditsLessCost(state: GameState, side: SideCode, viewer: SideCode, n: number): number {
  const credits = side === 'corp' ? state.corp.credits : state.runner.credits;
  const need = creditNeed(state, side);
  const broke = side === 'corp' && viewer === 'corp' ? BROKE_SLOPE : 0;
  const worth = (c: number, reach: number) => (reach ? creditSlide(c + reach, need, broke) + Math.min(c, 0) : creditSlide(c, need, broke));
  const own = side === 'corp' && viewer === 'corp';
  const now = worth(credits, own ? moneyReach(state) : 0);
  const less = worth(credits - n, own ? moneyReach({ ...state, corp: { ...state.corp, credits: credits - n } }) : 0);
  return logValue('credit', 'creditsLessCost', state, now - less, side, viewer, n);
}`;

/** The patches of a switched tree named `name` (its switches: globalThis.__tci_<name>). */
export function armPatches(name: string): Patch[] {
  const A = `((globalThis as any).__tci_${name} ?? {})`;
  return [
    // exports only (the scripts price a resource as the clock does)
    ['ai/evaluate.ts', `function addRigCard(state: GameState, card: CardInstance, value: number): number {`, `export function addRigCard(state: GameState, card: CardInstance, value: number): number {`],
    // the new function's import
    ['ai/evaluate.ts', `reachCard, setRunnerAgendaOdds, sideCreditValue } from './valueModel';`, `reachCard, setRunnerAgendaOdds, sideCreditValue, creditsLessCost } from './valueModel';`],
    // C1: read outside the frame, before the copy
    [
      'ai/evaluate.ts',
      `  return withPricing({ pricingTagLoss: true }, () => tagLoss({ ...state }, viewer, skip));\n}`,
      `  const A = ${A};
  // C1: the trash's cost read on the board it is given, before the frame and the copy, only when a resource is priced
  const cost = A.c1 && !A.c1in && state.runner.rig.resources.length > skip && state.corp.credits >= 2 ? trashCost(state, viewer) : undefined;
  return withPricing({ pricingTagLoss: true }, () => tagLoss({ ...state }, viewer, skip, cost));
}

/** The basic trash action's cost to the Corp as \`viewer\` prices it: the click's owner and the credit's owner (rule 5.2.6g). */
function trashCost(state: GameState, viewer: SideCode): number {
  return clickPrice(state, 'corp', viewer) + creditsLessCost(state, 'corp', viewer, 2);
}`,
    ],
    ['ai/evaluate.ts', `function tagLoss(state: GameState, viewer: SideCode, skip: number): number {`, `function tagLoss(state: GameState, viewer: SideCode, skip: number, trashCostRead?: number): number {\n  const A = ${A};\n  if ((globalThis as any).__tciKeep) (globalThis as any).__tciKeep.clock++;`],
    [
      'ai/evaluate.ts',
      `    trash = Math.max(0, nets[skip] ?? 0) - (CLICK + 2);`,
      `    const cost = A.c1 ? trashCostRead ?? trashCost(state, viewer) : CLICK + 2;
    trash = Math.max(0, nets[skip] ?? 0) - cost;
    if (A.dbg) A.dbg({ part: 'trash', nets, cost, viewer, skip });`,
    ],
    [
      'ai/evaluate.ts',
      `  const punishes = (c: CardInstance) => cardSynergy(cardDef(c)).when?.includes('ifTagged') ?? false;`,
      `  const punishes = (c: CardInstance) => (cardSynergy(cardDef(c)).when?.includes('ifTagged') ?? false) && (!A.p || (A.pCorp && viewer !== 'corp') || cardDef(c).type_code === 'operation');`,
    ],
    [
      'ai/evaluate.ts',
      `  return Math.max(trash, 0) + punish + (punishes(corp.identity) ? 1 : 0);`,
      `  if (A.dbg) A.dbg({ part: 'punish', held, punish, id: punishes(corp.identity) ? 1 : 0, viewer, skip });
  return Math.max(trash, 0) + punish + (punishes(corp.identity) ? 1 : 0);`,
    ],
    // the new function, directly beside sideCreditValue
    [
      'ai/valueModel.ts',
      `  return logValue('credit', 'sideCreditValue', state, reach ? creditSlide(credits + reach, need, broke) + Math.min(credits, 0) : creditSlide(credits, need, broke), side, viewer);\n}`,
      `  return logValue('credit', 'sideCreditValue', state, reach ? creditSlide(credits + reach, need, broke) + Math.min(credits, 0) : creditSlide(credits, need, broke), side, viewer);\n}${NEW_FUNCTION}`,
    ],
    // 1 e's counter: a keep work-out (rezMoney's memo missed)
    [
      'ai/corp/rezMoney.ts',
      `const money = memo(state, 'rezMoney', () => countRezMoney(state, holding(state)));`,
      `const money = memo(state, 'rezMoney', () => ((globalThis as any).__tciKeep && (globalThis as any).__tciKeep.n++, countRezMoney(state, holding(state))));`,
    ],
  ];
}

/** The legs' engine line (scripts/corp-owed/tags.ts BAR): REMOVE_TAG offered only while __owBar is unset. */
export const BAR: Patch = [
  'core/engine/legalActions.ts',
  `if (side === 'runner' && hasClick && state.runner.tags > 0) candidates.push({ type: 'REMOVE_TAG', player: 'runner' });`,
  `if (side === 'runner' && hasClick && state.runner.tags > 0 && !(globalThis as any).__owBar) candidates.push({ type: 'REMOVE_TAG', player: 'runner' });`,
];

/** ruled: ruling 1's arm (2026-11-27 03:08Z): C1 in both views, P in the Corp's view only. */
export type Arm = 'base' | 'c1' | 'p' | 'c1p' | 'ruled';
/** The arms phase A read side by side (ruled is step 9's, and the time mode's extra ask). */
export const ARMS: Arm[] = ['base', 'c1', 'p', 'c1p'];
/** The switch object of an arm. */
export const armSwitch = (arm: Arm) => ({ c1: arm === 'c1' || arm === 'c1p' || arm === 'ruled', p: arm === 'p' || arm === 'c1p' || arm === 'ruled', pCorp: arm === 'ruled' });
/** Set a tree's switches (keeps dbg). */
export function setArm(name: string, arm: Arm, extra: Record<string, unknown> = {}) {
  const G = globalThis as any;
  G[`__tci_${name}`] = { ...armSwitch(arm), ...extra };
}
export const treeRoot = (shard: number) => resolve(process.env.TROOT ?? 'node_modules/.cache/tag-clock-input', String(shard));
