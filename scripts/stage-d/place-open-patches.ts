/**
 * Stage D item 5 step 1 (brief stage-d/item5-placement/brief.md section 3): the arms, as text patches of a copy of src/
 * (no source change). Each entry is [file under src/, text that must occur once, replacement]. `probe` is applied to
 * every tree, base included: it records the layer that made a pick (item 4's probe, globalThis.__geLayer) and, while
 * the script asks the order on one state, each candidate's line and each install's placement reason (__poRec).
 *
 *  - a1  spec 1.8 ice rule 2 as written: where no counted line takes the click (placeRules is reached) and a central does
 *        not hold, the ice goes to the central where stake x (entries before - entries after, + 1 when it comes to hold)
 *        is largest (line 2's own `fall`, iceCount's numbers), when the Corp can install and rez it within keep
 *        (icePaidAt, 8.5.11a). It sits where centralIce sat and centralIce is deleted (its bare case is rule 2's extreme
 *        case); where rule 2 does not apply, the ice redirect, the asset partner and the fallback run as today.
 *  - a2  the same key over every server that does not hold, remotes included (the general form).
 *  - b   as a1 with Jeff's order: HQ first while HQ does not hold and the ice lowers its count, then a1's choice.
 *  - c1  a remote's stake reads the denial owner: `stake(...).loss` adds each asset in its root at
 *        corpCardValue(card, state, 'runner', true) (hosted credits through countersWorth inside it), an access trap
 *        (runs.ts accessTrap) at none. stake's readers in placement (iceCount: lines 2 and 6, the fallback) see it.
 *  - c2  the asset chooses its server: among iced remotes with an open root (3.3.1) a remote a rez set holds
 *        (serverHold 'runnerTurn') whose holding rez costs less than the asset's worth (as c1) is taken first, the
 *        cheapest holding rez first; the reservation for an agenda (reservedForAgenda) gives way to such an asset
 *        when the reserved remote holds for it. Otherwise as today (assetPartner's most-iced remote, assetCover's pair).
 */
type Patch = [string, string, string];

const G = '(globalThis as unknown as Record<string, any>)';
const key = (v: string) => `JSON.stringify(Object.fromEntries(Object.entries(${v}).filter(([k]) => k !== 'player').sort()))`;

export const placeProbe: Patch[] = [
  [
    'ai/corp/candidates.ts',
    '    const entry = { action: clean, placement };',
    `    const entry = { action: clean, placement };\n    if (${G}.__poState === state) ${G}.__poRec.set(${key('clean')}, placement.reason);`,
  ],
  [
    'ai/corp/candidates.ts',
    '  return sortCandidates(out);',
    `  const __sorted = sortCandidates(out);\n  if (${G}.__poState === state) for (const c of __sorted) ${G}.__poLines.set(${key('c.action')}, { line: c.line, behind: c.behind });\n  return __sorted;`,
  ],
];

const rule2 = (mode: 'a1' | 'a2' | 'b'): Patch[] => [
  [
    'ai/corp/placement.ts',
    "  const central = centralIce(state, from, free);\n  if (central && isInstall(central)) return { action: central, reason: 'centralIce' };",
    `  const central = rule2(state, card, from, free);\n  if (central) { ${G}.__poFire = (${G}.__poFire ?? 0) + 1; return { action: central, reason: 'rule2' as PlacementReason }; }`,
  ],
  [
    'ai/corp/placement.ts',
    'export function centralIce(',
    `const rule2Memo = new WeakMap<GameState, Map<string, Install | null>>();
/** Spec 1.8 ice rule 2 (${mode}): the server (${mode === 'a2' ? 'any' : 'HQ or R&D'}) that does not hold where stake x the fall in entries is largest. */
function rule2(state: GameState, card: CardInstance, from: Install, free?: FreeInstall): Install | null {
  if (typeOf(card) !== 'ice' || !mainOr(state, free)) return null;
  if (!from.asNewRemote && !state.corp.servers[from.targetServerId ?? '']?.isRemote) return null;
  const memo = rule2Memo.get(state) ?? rule2Memo.set(state, new Map()).get(state)!;
  if (memo.has(card.instanceId)) return memo.get(card.instanceId)!;
  const keep = rezMoney(state).keep;
  const ids = ${mode === 'a2' ? 'Object.keys(state.corp.servers)' : "['hq', 'rd']"};
  const scored: { id: string; fall: number; a: Install }[] = [];
  for (const id of ids) {
    const v = state.corp.servers[id];
    if (!v || !icePaidAt(state, card, free ? 0 : v.ice.length, keep)) continue;
    const a = shaped(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: id }, free) as Install | undefined;
    if (!a) continue;
    const after = free ? free(a) : executeAction(state, a);
    const c = after ? iceCount(state, a, card, after) : null;
    if (!c || c.was.holds) continue;
    const fall = c.loss * (c.was.entries - c.now.entries + (c.now.holds ? 1 : 0));
    if (fall > 0) scored.push({ id, fall, a });
  }
  scored.sort((x, y) => ${mode === 'b' ? "+(y.id === 'hq') - +(x.id === 'hq') || " : ''}y.fall - x.fall || +(y.id === 'hq') - +(x.id === 'hq'));
  const out = scored[0]?.a ?? null;
  memo.set(card.instanceId, out);
  return out;
}

export function centralIce(`,
  ],
];

const assetWorth: Patch = [
  'ai/corp/pools.ts',
  'export function agendasUnseen(state: GameState): number {\n  return rdAgendas(state).length;\n}',
  `export function agendasUnseen(state: GameState): number {\n  return rdAgendas(state).length;\n}\n\n/** c1/c2: the denial owner's worth of the assets in a remote's root (an access trap at none). */\nexport function assetWorth(state: GameState, server: string): number {\n  const v = state.corp.servers[server];\n  if (!v?.isRemote) return 0;\n  return v.root.filter(c => cardDef(c).type_code === 'asset' && !accessTrap(c.cardCode)).reduce((n, c) => n + Math.max(0, corpCardValue(c, state, 'runner', true)), 0);\n}`,
];
const poolsImports: Patch = [
  'ai/corp/pools.ts',
  "import { pointGain, sideCards } from '../valueModel';",
  "import { pointGain, sideCards } from '../valueModel';\nimport { corpCardValue } from '../evaluate';\nimport { accessTrap } from '../runs';",
];

const c1: Patch[] = [
  poolsImports,
  assetWorth,
  [
    'ai/corp/pools.ts',
    '  return { points: points(view, server, accesses), loss: loss(view, server, accesses) };',
    '  return { points: points(view, server, accesses), loss: loss(view, server, accesses) + assetWorth(view, server) };',
  ],
];

/** c2's chooser, shared by assetPartner and assetCover's waiting remote. */
const c2Chooser = `
/** c2: an iced remote with an open root that a rez set holds for less than the asset's worth, the cheapest holding rez first. */
function holdingFor(state: GameState, asset: CardInstance, reserved: ServerLike | null): ServerLike | null {
  if (typeOf(asset) !== 'asset' || accessTrap(asset.cardCode)) return null;
  const worth = Math.max(0, corpCardValue(asset, state, 'runner', true));
  const open = remotes(state).filter(v => v.ice.length > 0 && !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset'));
  const ok = open
    .map(v => ({ v, h: serverHold(state, v.id, { when: 'runnerTurn' }) }))
    .filter(x => x.h.holds && x.h.rezCost < worth)
    .sort((x, y) => x.h.rezCost - y.h.rezCost || x.v.id.localeCompare(y.v.id));
  const pick = ok[0]?.v ?? null;
  if (pick) ${G}.__poC2 = pick.id === reserved?.id ? 'reserved' : 'holding';
  return pick;
}
`;

const c2: Patch[] = [
  ['ai/corp/placement.ts', "import { isTrap } from '../runs';", "import { accessTrap, isTrap } from '../runs';\nimport { corpCardValue } from '../evaluate';"],
  [
    'ai/corp/placement.ts',
    '  const waiting = remotes(state).find(v => v.ice.length > 0 && !v.root.some(c => isAgenda(c) || typeOf(c) === \'asset\') && v.id !== reserved?.id);',
    '  const waiting = holdingFor(state, asset, reserved) ?? remotes(state).find(v => v.ice.length > 0 && !v.root.some(c => isAgenda(c) || typeOf(c) === \'asset\') && v.id !== reserved?.id);',
  ],
  [
    'ai/corp/placement.ts',
    '  const waiting = remotes(state)\n    .filter(',
    '  const waiting = holdingFor(state, card, reserved) ?? remotes(state)\n    .filter(',
  ],
  ['ai/corp/placement.ts', 'export function assetPartner(', `${c2Chooser}\nexport function assetPartner(`],
];

export const PATCHES: Record<string, Patch[]> = {
  a1: rule2('a1'),
  a2: rule2('a2'),
  b: rule2('b'),
  c1,
  c2,
};
