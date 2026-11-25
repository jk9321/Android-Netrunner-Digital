/**
 * F108 count (brief /mnt/project-files/netrunner-ai/tag-owner/brief-count.md rev 0): the trees. Text patches on scratch
 * copies of this checkout's src, never on the repo's src (as scripts/tags-once/trees.ts). Each patch must match exactly
 * once (a stop otherwise).
 *
 * The six arms: the outside readers' tagged risk (perTurn effectValues.ts:115, payoutWait cardProfiles.ts:47)
 * {as is; resources only; off} x tagsWorth's entries in evaluate {two; one}.
 *
 *   source       src unchanged. Plays the source games (GameRunner, its agents' calls only watched); never asked, its
 *                caches never cleared.
 *   base         src with exports only (addRigCard): as is, two entries. Every arm is read against it; it prices the record.
 *   once         base, the Corp strength's tagsWorth line dropped (evaluate.ts:487; tags-once's `once`).
 *   resOnly      base, the tagged risk only when the priced card is a resource (both outside readers). HOW THE TYPE IS
 *                CARRIED (changes no other number): cards/index.ts `join` hands every card entry out with each function
 *                in it (to depth 2: `runner`, `value.*`, `counters.*`, `counterFormulas.*`, ...) wrapped so the call runs
 *                with a global set to that card's code and restored after (try/finally; nested calls set and restore
 *                their own). Data fields (synergy, profile objects) are the same objects. perTurn then reads the
 *                current code's type: tagged risk if 'resource', untagged if another type, AS IS if no code is set (an
 *                unknown call, counted in a global the script reads). payoutWait reads its profile's card (a WeakMap
 *                filled in `join`): the same rule. Untagged, every number is base's (checked on every board, step 0).
 *   resOnlyOnce  resOnly and once.
 *   owner        base, both outside readers at the untagged rate always: a tag's loss read from tagsWorth alone.
 *   ownerOnce    owner and once (= tags-once's onceNoRisk).
 *   noWait       base, payoutWait's tagged risk off. Split only (names the rig's part read by payoutWait).
 *   noPerTurn    base, perTurn's tagged risk off. Split only (names the rig's part read by perTurn).
 *   legs         src unchanged but one engine line: getLegalActions offers REMOVE_TAG only while the global
 *                `__tagOwnerBar` is not set (legalActions.ts:70). Part B's two legs play on this tree; the script sets
 *                the bar only on the keep leg, from the unit's board until the Runner's next turn begins. Unset, it is src.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Patch = [file: string, at: string, to: string];
export const ARMS = ['base', 'once', 'resOnly', 'resOnlyOnce', 'owner', 'ownerOnce'] as const;
export type Arm = (typeof ARMS)[number];
export type TreeName = 'source' | Arm | 'noWait' | 'noPerTurn' | 'legs';

const G = `(globalThis as any)`;
const EXPORTS: Patch[] = [['ai/evaluate.ts', `function addRigCard(state: GameState, card: CardInstance, value: number): number {`, `export function addRigCard(state: GameState, card: CardInstance, value: number): number {`]];
const CORP_LINE: Patch = ['ai/evaluate.ts', `      corpBoardValue(state, viewer) +\n      tagsWorth(state, viewer) +\n`, `      corpBoardValue(state, viewer) +\n`];

const PER_TURN_AT = `const tagRisk = state.runner.tags > 0 && !(plan().ownTrashRisk && actingSide() === 'corp');`;
const WAIT_AT = `(state.runner.tags > 0 ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged)`;
const NO_PERTURN: Patch = ['ai/effectValues.ts', PER_TURN_AT, `const tagRisk = (false as boolean) && state.runner.tags > 0 && !(plan().ownTrashRisk && actingSide() === 'corp');`];
const NO_WAIT: Patch = ['ai/cardProfiles.ts', WAIT_AT, `PAYOUT_RISK.runnerUntagged`];

// resOnly: the priced card's code carried by a wrapper on every card entry's functions (cards/index.ts join)
const TYPED: Patch[] = [
  [
    'ai/cards/index.ts',
    `function join(sets: Record<string, CardAI>[]): Record<string, CardAI> {`,
    `// F108 count, resOnly tree only: each entry's functions run with the global __toCur set to the entry's card code
const __toProf: WeakMap<object, string> = (${G}.__toProf ??= new WeakMap());
const __wrapFn = (code: string, f: (...a: unknown[]) => unknown) =>
  function (this: unknown, ...a: unknown[]) {
    const prev = ${G}.__toCur;
    ${G}.__toCur = code;
    try {
      return f.apply(this, a);
    } finally {
      ${G}.__toCur = prev;
    }
  };
const __typed = (code: string, entry: CardAI): CardAI => {
  if (entry.profile) __toProf.set(entry.profile, code);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v === 'function') out[k] = __wrapFn(code, v as (...a: unknown[]) => unknown);
    else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'synergy' && k !== 'profile' && Object.values(v).some(x => typeof x === 'function')) {
      const o: Record<string, unknown> = {};
      for (const [k2, v2] of Object.entries(v)) o[k2] = typeof v2 === 'function' ? __wrapFn(code, v2 as (...a: unknown[]) => unknown) : v2;
      out[k] = o;
    } else out[k] = v;
  }
  return out as CardAI;
};
function join(sets: Record<string, CardAI>[]): Record<string, CardAI> {`,
  ],
  ['ai/cards/index.ts', `      all[code] = entry;\n`, `      all[code] = __typed(code, entry);\n`],
  // The type test: true for a resource, false for another known type, undefined when no card is known (counted)
  [
    'ai/effectValues.ts',
    `export function perTurn(state: GameState, x: number, owner: 'corp' | 'runner' | number, minTurns = 0, maxTurns = Infinity, wait = 1, lock = 1): number {`,
    `const __toRes = (code: string | undefined): boolean | undefined => {
  if (code === undefined) return undefined;
  try {
    return getCardDefinition(code).type_code === 'resource';
  } catch {
    return undefined;
  }
};
export function perTurn(state: GameState, x: number, owner: 'corp' | 'runner' | number, minTurns = 0, maxTurns = Infinity, wait = 1, lock = 1): number {`,
  ],
  [
    'ai/effectValues.ts',
    PER_TURN_AT,
    `const __res = owner === 'runner' && state.runner.tags > 0 ? __toRes(${G}.__toCur) : true;
  if (__res === undefined) ${G}.__toUnknown = (${G}.__toUnknown ?? 0) + 1;
  const tagRisk = state.runner.tags > 0 && !(plan().ownTrashRisk && actingSide() === 'corp') && __res !== false;`,
  ],
  [
    'ai/cardProfiles.ts',
    WAIT_AT,
    `(state.runner.tags > 0 && __toResP(profile) !== false ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged)`,
  ],
  [
    'ai/cardProfiles.ts',
    `export function payoutWait(`,
    `const __toResP = (profile: CardProfile): boolean | undefined => {
  const code: string | undefined = ${G}.__toProf?.get(profile);
  if (code === undefined) {
    ${G}.__toUnknownWait = (${G}.__toUnknownWait ?? 0) + 1;
    return undefined;
  }
  return getCardDefinition(code).type_code === 'resource';
};
export function payoutWait(`,
  ],
];
const LEGS: Patch = [
  'core/engine/legalActions.ts',
  `if (side === 'runner' && hasClick && state.runner.tags > 0) candidates.push({ type: 'REMOVE_TAG', player: 'runner' });`,
  `if (side === 'runner' && hasClick && state.runner.tags > 0 && !${G}.__tagOwnerBar) candidates.push({ type: 'REMOVE_TAG', player: 'runner' });`,
];

export const PATCHES: Record<TreeName, Patch[]> = {
  source: [],
  base: EXPORTS,
  once: [...EXPORTS, CORP_LINE],
  resOnly: [...EXPORTS, ...TYPED],
  resOnlyOnce: [...EXPORTS, ...TYPED, CORP_LINE],
  owner: [...EXPORTS, NO_PERTURN, NO_WAIT],
  ownerOnce: [...EXPORTS, NO_PERTURN, NO_WAIT, CORP_LINE],
  noWait: [...EXPORTS, NO_WAIT],
  noPerTurn: [...EXPORTS, NO_PERTURN],
  legs: [LEGS],
};

export function makeTrees(root: string, names: TreeName[]): Record<TreeName, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = {} as Record<TreeName, string>;
  for (const name of names) {
    const dir = join(root, name);
    dirs[name] = dir;
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of PATCHES[name]) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`${name} tree: a patch does not match once in ${f}: ${at.slice(0, 90)}`);
      writeFileSync(path, text.replace(at, () => to));
    }
  }
  return dirs;
}
