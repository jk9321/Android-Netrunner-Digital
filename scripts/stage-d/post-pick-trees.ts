/**
 * Stage D item 8 (count step; brief /mnt/project-files/netrunner-ai/stage-d/item8-post-pick/brief.md): the trees.
 *
 * A tree is a copy of this checkout's src/ (beta 006e42c; src/ai and src/core as beta 1cfd5a6) with text patches, loaded
 * as its own module graph (as make-room-fire.ts makeTrees). Every tree gets the RECORD patch: in corp/core.ts decideOn,
 * for the deciding Corp only (ctx.counted), the pieces of the click's choice are left in globalThis.__ppRec (the
 * look-ahead's pick, the order's first, the money step's answer, the tag-first override, the held line's step or veto,
 * the final action); in turnPlanner.ts planTurn, the Corp's compared candidates and their playout values in
 * globalThis.__ppPlan. Both only write a global the script reads; play is unchanged (the source games are checked
 * against the batch's record, cr/sc/winner).
 *
 * Arms (each one tree; `ARM` below is written into its corp/core.ts):
 *  - beta, control, source: RECORD only (source plays the source games and is never asked or cleared, found row 71b).
 *  - noM: the money step off (Q6 answers null). noT: tag first off. noV: the spare-click veto off for the deciding Corp
 *    (the playouts' own lineAsk still vetoes, as on beta). A3's whole-game arms.
 *  - moneyBefore: the money step asked before the look-ahead with the order's first pick; the look-ahead is not run
 *    when it answers (it is asked on its pick otherwise, as on beta, after the look-ahead: no second ask).
 *  - vetoList: with a held agenda line on its first turn and only spare clicks left (the veto's case), an entry of the
 *    order after which the line no longer holds (lineHolds, the veto's own test) is not a candidate (a credit and the
 *    turn end stay); the look-ahead chooses among the rest; no veto afterwards for the deciding Corp.
 *  - saveUpMoney: the money step (Q6) also answers "gain a credit" when no econ operation is playable now but one in HQ
 *    becomes playable with this turn's clicks (credits + clicks - 1 >= its cost) and nets credits when played (the
 *    money step's own net, read on a copy of the board given that many more credits). A clause on a counted question.
 *  - saveUpList: the same reach, as a line of the order instead: the credit is placed first in line 4 (so it is in the
 *    look-ahead's K), and the look-ahead decides. A condition on line 7's credit entry.
 *  - holdCand: the look-ahead always also compares "gain a credit" and "end the turn" (Jeff's kept idea, lead 6b/2),
 *    added to its candidates when missing (after its own skip test, so it runs on the same decisions).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'noM', 'noT', 'noV', 'moneyBefore', 'vetoList', 'saveUpMoney', 'saveUpList', 'holdCand'] as const;
export type Arm = (typeof ARMS)[number];

type Patch = [file: string, at: string, to: string];

const CHOOSE_OLD = `    const planned = ctx.lookahead && !turnStart && !decided ? ctx.lookahead(view, ranked) : null;`;
const MONEY_OLD = `    const money = !decided && ctx.counted && !turnStart ? moneyPick(view, planned ?? ranked[0]?.action) : null;
    let chosen = lineFirst ?? money ?? planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0]);`;
const TAG_OLD = `    if (!lineFirst && ctx.synergy && plan().tagFirst && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst) chosen = ranked[0].action;
    return chosen;`;

function corePatches(arm: Arm): Patch[] {
  const A = JSON.stringify(arm);
  return [
    [
      'ai/corp/core.ts',
      CHOOSE_OLD,
      `    const __arm: string = ${A};
    const __G = globalThis as any;
    let __ranked = ranked;
    if (__arm === 'vetoList' && !decided && !lineFirst && ctx.counted) __ranked = __vetoFilter(view, ctx.memory.heldLine, ranked);
    const __money0 = __arm === 'moneyBefore' && !decided && ctx.counted && !turnStart ? moneyPick(view, __ranked[0]?.action) : null;
    const planned = ctx.lookahead && !turnStart && !decided && !__money0 ? ctx.lookahead(view, __ranked) : null;`,
    ],
    [
      'ai/corp/core.ts',
      MONEY_OLD,
      `    const money = __arm === 'noM' ? null : __arm === 'moneyBefore' ? __money0 : !decided && ctx.counted && !turnStart ? moneyPick(view, planned ?? __ranked[0]?.action) : null;
    let chosen = lineFirst ?? money ?? planned ?? (__ranked[0]?.score > -Infinity ? __ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0]);`,
    ],
    [
      'ai/corp/core.ts',
      TAG_OLD,
      `    const __beforeT = chosen;
    const __t = !lineFirst && ctx.synergy && plan().tagFirst && __arm !== 'noT' && __ranked[0]?.action.type === 'TRASH_RESOURCE' && !!__ranked[0].tagFirst;
    if (__t) chosen = __ranked[0].action;
    if (ctx.counted) __G.__ppRec = { decided, lineFirst, planned, r0: ranked[0]?.action ?? null, r0tag: !!ranked[0]?.tagFirst, money, beforeT: __beforeT, tFires: __t, chosen, turnStart, clicks: view.corp.clicks, filtered: ranked.length - __ranked.length, lookahead: !!ctx.lookahead && !turnStart && !decided && !__money0, creditAt: __ranked.findIndex(r => r.action.type === 'GAIN_CREDIT'), creditLine: (__ranked.find(r => r.action.type === 'GAIN_CREDIT') as any)?.line ?? null, creditBehind: (__ranked.find(r => r.action.type === 'GAIN_CREDIT') as any)?.behind ?? null, nRanked: __ranked.length };
    return chosen;`,
    ],
    [
      'ai/corp/core.ts',
      `    return { action: picked, note: true };`,
      `    if (ctx.counted && (globalThis as any).__ppRec) Object.assign((globalThis as any).__ppRec, { score: true, final: picked });
    return { action: picked, note: true };`,
    ],
    [
      'ai/corp/core.ts',
      `  const two = lineAsk(view, ctx.memory.heldLine, (lineFirst, later) => choose(later || !!lineFirst, lineFirst));`,
      `  const two = lineAsk(view, ctx.memory.heldLine, (lineFirst, later) => choose(later || !!lineFirst, lineFirst), ctx.counted && (${A} === 'noV' || ${A} === 'vetoList'));
  if (ctx.counted && (globalThis as any).__ppRec) Object.assign((globalThis as any).__ppRec, { later: two.later, lineStep: two.lineFirst, two: two.action, lineKind: two.held?.line.kind ?? (two.held ? 'agenda' : null), final: two.action });`,
    ],
    [
      'ai/corp/core.ts',
      `export function lineAsk(state: GameState, held: HeldLine | null, choose: (lineFirst: GameAction | null, later: boolean) => GameAction | null) {`,
      `export function lineAsk(state: GameState, held: HeldLine | null, choose: (lineFirst: GameAction | null, later: boolean) => GameAction | null, noVeto = false) {`,
    ],
    [
      'ai/corp/core.ts',
      `  const two = chosen ? scoreInTwoPick(state, chosen, held) : { action: null, held };`,
      `  const __was = (globalThis as any).__ppNoVeto;
  (globalThis as any).__ppNoVeto = noVeto;
  let two: ReturnType<typeof scoreInTwoPick> | { action: null; held: HeldLine | null };
  try {
    two = chosen ? scoreInTwoPick(state, chosen, held) : { action: null, held };
  } finally {
    (globalThis as any).__ppNoVeto = __was;
  }`,
    ],
    [
      'ai/corp/core.ts',
      `import { lineStep, scoreInTwoPick } from './placement';`,
      `import { lineStep, scoreInTwoPick } from './placement';
import { executeAction as __exec } from '../../core';
import { lineHolds as __lineHolds, scoreInTwo as __scoreInTwo, isCorpMain as __isCorpMain } from './lines';

/** vetoList (count arm): the order without the entries after which the held line no longer holds (the veto's test, placement.ts twoTurn). */
function __vetoFilter(state: GameState, held: HeldLine | null, ranked: ScoredAction[]): ScoredAction[] {
  if (!plan().scoreInTwo || !__isCorpMain(state) || state.corp.clicks <= 0) return ranked;
  let h = held && held.game === state.id && held.turn === state.turnNumber && held.line.kind !== 'asset' ? held : null;
  if (!h && !(held && held.game === state.id && held.turn < state.turnNumber)) {
    const line = __scoreInTwo(state);
    h = line && !line.kind ? ({ game: state.id, turn: state.turnNumber, line, server: null, counters: 0 } as HeldLine) : null;
  }
  if (!h) return ranked;
  const id = h.line.agendaId;
  // The veto's case only: the agenda is out of HQ (its steps played) and the line still holds now
  if (state.corp.hq.some(c => c.instanceId === id) || !__lineHolds(state, id)) return ranked;
  if (!ranked.some(r => r.action.type === 'GAIN_CREDIT')) return ranked;
  const out = ranked.filter(r => {
    if (r.action.type === 'GAIN_CREDIT' || r.action.type === 'END_TURN' || r.score === -Infinity) return true;
    if (!isLegalAction(state, r.action)) return true;
    try {
      return __lineHolds(__exec(state, r.action), id);
    } catch {
      return true;
    }
  });
  (globalThis as any).__ppVetoCut = ((globalThis as any).__ppVetoCut ?? 0) + (ranked.length - out.length);
  return out;
}`,
    ],
    [
      'ai/corp/placement.ts',
      `  if (lineHolds(spareAfter(state, pick), h.line.agendaId)) return { action: pick, held: h };`,
      `  if ((globalThis as any).__ppNoVeto) return { action: pick, held: h };
  if (lineHolds(spareAfter(state, pick), h.line.agendaId)) return { action: pick, held: h };`,
    ],
    [
      'ai/turnPlanner.ts',
      `  if (candidates.length <= 1 || clicksOf(state, side) <= 0) return null;`,
      `  if (candidates.length <= 1 || clicksOf(state, side) <= 0) return null;
  const __added: string[] = [];
  if (side === 'corp' && ${A} === 'holdCand')
    for (const t of ['GAIN_CREDIT', 'END_TURN']) {
      const r = ranked.find(x => x.action.type === t && x.score > -Infinity);
      if (r && !candidates.some(c => c.action.type === t)) {
        candidates.push(r);
        __added.push(t);
      }
    }`,
    ],
    [
      'ai/turnPlanner.ts',
      `    if (!best || best.value === -Infinity) return null;`,
      `    if (side === 'corp') (globalThis as any).__ppPlan = { cands: candidates.map(c => c.action), values, best: best?.action ?? null, added: __added, lines: scored.map(x => x.line.map(l => l.action)) };
    if (!best || best.value === -Infinity) return null;`,
    ],
  ];
}

const SAVE_HELPER = `
/**
 * saveUp (count arm, found row 35): an econ operation in HQ that is not playable now but becomes playable with this turn's
 * clicks (one click kept to play it: credits + clicks - 1 >= its cost), and nets credits when played (options' own net,
 * read on a copy of the board given the missing credits). Returns the best such net, or 0.
 */
export function saveUpNet(state: GameState): number {
  if (state.activePlayer !== 'corp' || activePrompt(state) || state.activeRun || state.corp.clicks <= 1) return 0;
  const legal = getLegalActions(state, 'corp');
  const now = new Set(legal.filter(a => a.type === 'PLAY_OPERATION_OR_EVENT').map(a => (a as { cardInstanceId: string }).cardInstanceId));
  const reach = state.corp.clicks - 1;
  let best = 0;
  for (const card of state.corp.hq) {
    if (now.has(card.instanceId) || cardDef(card).type_code !== 'operation' || !((cardSynergy(cardDef(card)).gives?.econ ?? 0) > 0)) continue;
    const cost = cardDef(card).cost ?? 0;
    if (cost <= state.corp.credits || cost > state.corp.credits + reach) continue;
    const rich: GameState = { ...state, corp: { ...state.corp, credits: cost } };
    const op = options(rich, getLegalActions(rich, 'corp')).find(o => (o.action as { cardInstanceId: string }).cardInstanceId === card.instanceId);
    if (op && op.net > best) best = op.net;
  }
  return best;
}
`;

function armPatches(arm: Arm): Patch[] {
  if (arm === 'saveUpMoney')
    return [
      ['ai/incomeLine.ts', `/** The action installs an agenda`, `${SAVE_HELPER}\n/** The action installs an agenda`],
      [
        'ai/incomeLine.ts',
        `  const ops = options(state, getLegalActions(state, 'corp'));
  if (!ops.length) return null;`,
        `  const ops = options(state, getLegalActions(state, 'corp'));
  if (!ops.length) {
    const credit = getLegalActions(state, 'corp').find(a => a.type === 'GAIN_CREDIT');
    if (credit && saveUpNet(state) > 0) {
      (globalThis as any).__ppSave = ((globalThis as any).__ppSave ?? 0) + 1;
      return credit;
    }
    return null;
  }`,
      ],
    ];
  if (arm === 'saveUpList')
    return [
      ['ai/incomeLine.ts', `/** The action installs an agenda`, `${SAVE_HELPER}\n/** The action installs an agenda`],
      [
        'ai/corp/candidates.ts',
        `  for (const a of legal) if (a.type === 'DRAW_CARD' || a.type === 'GAIN_CREDIT') add({ action: a, line: 7, behind: false, keys: [draw === (a.type === 'DRAW_CARD') ? 0 : 1], card: undefined });`,
        `  const __save = !opts.free && legal.some(a => a.type === 'GAIN_CREDIT') ? __saveUpNet(state) : 0;
  for (const a of legal)
    if (a.type === 'GAIN_CREDIT' && __save > 0) add({ action: a, line: 4, behind: false, keys: [-1e9, 0], card: undefined });
    else if (a.type === 'DRAW_CARD' || a.type === 'GAIN_CREDIT') add({ action: a, line: 7, behind: false, keys: [draw === (a.type === 'DRAW_CARD') ? 0 : 1], card: undefined });`,
      ],
      ['ai/corp/candidates.ts', `import { placedCounterWorth } from '../effectValues';`, `import { placedCounterWorth } from '../effectValues';\nimport { saveUpNet as __saveUpNet } from '../incomeLine';`],
    ];
  return [];
}

export function makeTrees(root: string, arms: readonly Arm[]): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of [...corePatches(arm), ...armPatches(arm)]) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${arm}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(path, text.replace(at, () => to));
    }
    dirs[arm] = dir;
  }
  return dirs;
}

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  syn: any;
  lines: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/synergyTags.ts', 'ai/corp/lines.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, syn, lines] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    syn,
    lines,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
