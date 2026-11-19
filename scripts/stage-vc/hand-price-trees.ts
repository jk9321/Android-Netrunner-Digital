/**
 * V-C item 2 (the hand's price), count step: the trees. Brief: /mnt/project-files/netrunner-ai/stage-vc/item2-hand-price/brief.md.
 * A tree is a copy of this checkout's src/ (beta's src, unchanged since 260e6a4) with text patches, loaded as its own
 * module graph (as scripts/stage-d/bait-run-trees.ts). Every tree gets the RECORD patches, which only write globals the
 * script reads, and the helper `__hqSteal` (handValues.ts), which only the G arms and the untimed measuring asks call.
 *
 * RECORD:
 *  - answerPrompt's top-level flag (the deciding Corp's own prompt answer, corp/core.ts Q0; as bait-run-trees.ts);
 *  - reader calls per ask (inside the look-ahead too): `kv` keepValue on a Corp card, `ht` hqTrashCardsLoss with k > 0,
 *    `so` scoreOutcome for the Corp, `kb` keepBonus (and `kbnz` the non-zero ones, with the cards: H3 (d));
 *  - H3 (c): at the deciding Corp's own prompt, every answer scoreOutcome prices where an agenda leaves HQ for R&D, with
 *    the Archives loss its 0.5 x keep charged (`__hpShuffle`);
 *  - the time inside the planner (`__hpPlanMs`, corpAI.ts plan, the deciding Corp's only).
 *
 * The arms (Corp view only; the Runner's grip is priced as today in every tree):
 *  - ownerEverywhere (OE): handAndClicks prices the Corp's own HQ by `ownHandValue` on every Corp-viewer board, as the
 *    leaf does (what plan.handByCard.corp gates); unseen cards by the owner's rule for them.
 *  - keepFromOwner (KO): `keepValue` of a Corp card is `heldWorth` plus the agenda's Archives loss (the non-agenda part
 *    and the agenda's held part read the owner's card input); `hqTrashCardsLoss` reads that (no "- CLICK": heldWorth is
 *    net of its click); scoreOutcome's 0.5 x keep term stays, at the owner's price, and the Archives loss it charges an
 *    agenda that leaves HQ is given back unless the agenda is in Archives on the answer's board (row 76c: not charged
 *    where it goes to R&D; nor where an install prompt puts it in a server).
 *  - ownerOne (O1): OE + KO, scoreOutcome's 0.5 x keep term dropped on the Corp side (the board already prices the card
 *    by the owner and an archived agenda by archivedAgendasValue), and the resource trash's extra term
 *    (candidates.ts TRASH_RESOURCE: flat difference less hqTrashCardsLoss) dropped (the board prices the cards it costs).
 *    This is the arm that leaves one price of a card in HQ; KO alone leaves two (the flat board and the owner's keep).
 *  - flatEverywhere (FE): the Corp's planner leaf reads the flat too (handByCard('corp') false). Report only.
 *  - heldRisk (HR): an agenda in HQ is held at `heldFromPlayed` of agendaWorth(state, 0, cost, points, no server,
 *    no success, inHand, the Corp's clicks and credits, stealChance = __hqSteal(state)) less CLICK, in place of the
 *    best remote's (playedWorth's agenda branch). `__hqSteal`: 0 if HQ holds over the Runner's next turn
 *    (serverHold 'runnerTurn' with the Corp's credits), else 1 - (1 - 1/|HQ|)^entries, `entries` the same answer's
 *    count of runs that get in (at least 1 when it does not hold), one card accessed a run (rule 7.2.? base access of
 *    HQ: the Runner accesses 1 random card) with the HQ size the Corp knows. No new number: the access count is the rule.
 *  - leastBad (LB): at line 9 only (the agenda's server does not hold), the install goes ahead of line 7 (line 6.5, and
 *    plannerIntake's agenda slot takes it as it takes line 9) when the steal chance agendaWorth reads for the remote
 *    `place` gives (oracleSteal ?? stealOdds on the board after the install) is below __hqSteal on the board before.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'ownerEverywhere', 'keepFromOwner', 'ownerOne', 'flatEverywhere', 'heldRisk', 'leastBad'] as const;
export type Arm = (typeof ARMS)[number];
export const H_ARMS: Arm[] = ['ownerEverywhere', 'keepFromOwner', 'ownerOne', 'flatEverywhere'];
export const G_ARMS: Arm[] = ['heldRisk', 'leastBad'];
export const PRICE_ARMS: Arm[] = [...H_ARMS, ...G_ARMS];

type Patch = [file: string, at: string, to: string];

function patches(arm: Arm): Patch[] {
  const OE = arm === 'ownerEverywhere' || arm === 'ownerOne';
  const KO = arm === 'keepFromOwner' || arm === 'ownerOne';
  const O1 = arm === 'ownerOne';
  const FE = arm === 'flatEverywhere';
  const HR = arm === 'heldRisk';
  const LB = arm === 'leastBad';
  return [
    // ---------------------------------------------------------------- RECORD: answerPrompt's top flag
    [
      'ai/prompts.ts',
      `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {`,
      `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {
  const __G = globalThis as any;
  const __top = !!__G.__hpTopNext;
  __G.__hpTopNext = false;
  const __was = __G.__hpPTop;
  __G.__hpPTop = __top;
  try {
    return __answerPrompt(state, side, memory, synergy);
  } finally {
    __G.__hpPTop = __was;
  }
}

function __answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {`,
    ],
    [
      'ai/corp/core.ts',
      `  if (activePrompt(view)) return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false };`,
      `  if (activePrompt(view)) {
    if (ctx.counted) (globalThis as any).__hpTopNext = true;
    return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false };
  }`,
    ],
    // ---------------------------------------------------------------- scoreOutcome's hand term: record, KO, O1
    [
      'ai/prompts.ts',
      `  score += 0.5 * (sumKeep(after, hand(after, side).filter(c => !drawn(c)), synergy) - sumKeep(before, hand(before, side), synergy));`,
      `  const __G = globalThis as any;
  if (side === 'corp' && __G.__hpCalls) __G.__hpCalls.so = (__G.__hpCalls.so ?? 0) + 1;
  // Agendas that left HQ on this answer, and where each went (Archives, R&D, elsewhere)
  const __leftAgendas = side === 'corp' ? before.corp.hq.filter(c => cardDef(c).type_code === 'agenda' && !after.corp.hq.some(b => b.instanceId === c.instanceId)) : [];
  const __inArchives = (c: CardInstance) => [...after.corp.archives.faceUp, ...after.corp.archives.faceDown].some(b => b.instanceId === c.instanceId);
  const __inRd = (c: CardInstance) => after.corp.rd.some(b => b.instanceId === c.instanceId);
  if (side === 'corp' && __G.__hpPTop && __G.__hpArm && before.corp.hq.some(c => __inArchives(c) || __inRd(c))) __G.__hpLeave = true;
  if (__leftAgendas.length && __G.__hpPTop && __G.__hpArm) {
    for (const c of __leftAgendas.filter(__inRd))
      (__G.__hpShuffle ??= []).push({ code: c.cardCode, title: cardDef(c).title, charged: 0.5 * __archivedAgendaLoss(before, cardDef(c).agenda_points ?? 1), prompt: (activePrompt(before) as any)?.source?.cardCode ?? null });
  }
  if (!(${O1} && side === 'corp')) score += 0.5 * (sumKeep(after, hand(after, side).filter(c => !drawn(c)), synergy) - sumKeep(before, hand(before, side), synergy));
  // KO: the Archives loss is charged only where the agenda is in Archives on the answer's board (row 76c)
  if (${KO} && !${O1} && side === 'corp') for (const c of __leftAgendas) if (!__inArchives(c)) score += 0.5 * __archivedAgendaLoss(before, cardDef(c).agenda_points ?? 1);`,
    ],
    ['ai/prompts.ts', `import { evaluate, keepValue, rigCoverage, runnerRigValue } from './evaluate';`, `import { evaluate, keepValue, rigCoverage, runnerRigValue, archivedAgendaLoss as __archivedAgendaLoss } from './evaluate';`],
    // ---------------------------------------------------------------- keepValue: record, KO
    [
      'ai/evaluate.ts',
      `  return logValue('hand', 'keepValue', state, Math.max(HAND_FLOOR, playedWorth(state, card) + CLICK) + loss, card);`,
      `  const __G = globalThis as any;
  const __corp = cardDef(card).side_code === 'corp';
  if (__corp && __G.__hpCalls) __G.__hpCalls.kv = (__G.__hpCalls.kv ?? 0) + 1;
  if (${KO} && __corp) return logValue('hand', 'keepValue', state, heldWorth(state, card, 'corp') + loss, card);
  return logValue('hand', 'keepValue', state, Math.max(HAND_FLOOR, playedWorth(state, card) + CLICK) + loss, card);`,
    ],
    // ---------------------------------------------------------------- hqTrashCardsLoss: record, KO
    [
      'ai/evaluate.ts',
      `  const losses = state.corp.hq.map(c => Math.max(HAND_FLOOR, keepValue(state, c) - CLICK)).sort((a, b) => a - b);`,
      `  const __G = globalThis as any;
  if (__G.__hpCalls) __G.__hpCalls.ht = (__G.__hpCalls.ht ?? 0) + 1;
  const losses = state.corp.hq.map(c => (${KO} ? keepValue(state, c) : Math.max(HAND_FLOOR, keepValue(state, c) - CLICK))).sort((a, b) => a - b);`,
    ],
    // ---------------------------------------------------------------- handAndClicks: OE
    [
      'ai/evaluate.ts',
      `    side === viewer && handByCard(side)
      ? ownHandValue(state, side)`,
      `    side === viewer && (handByCard(side) || (${OE} && side === 'corp'))
      ? ownHandValue(state, side)`,
    ],
    // ---------------------------------------------------------------- handByCard: FE
    [
      'ai/handValues.ts',
      `export const handByCard = (side: SideCode): boolean => leafHandByCard(side) || !!plan().handByCard?.[side];`,
      `export const handByCard = (side: SideCode): boolean => (${FE} && side === 'corp' ? false : leafHandByCard(side)) || !!plan().handByCard?.[side];`,
    ],
    // ---------------------------------------------------------------- heldWorth: HR; and the helper __hqSteal (every tree)
    [
      'ai/handValues.ts',
      `export function heldWorth(state: GameState, card: CardInstance, side: SideCode, freeInstall = false): number {`,
      `export function heldWorth(state: GameState, card: CardInstance, side: SideCode, freeInstall = false): number {
  if (${HR} && side === 'corp' && !pricing().averaging && cardDef(card).type_code === 'agenda' && state.corp.hq.some(c => c.instanceId === card.instanceId)) {
    const def = cardDef(card);
    const held = heldFromPlayed(state, card, side, agendaWorth(state, 0, def.advancement_cost ?? 0, def.agenda_points ?? 1, undefined, undefined, true, state.corp, __hqSteal(state)) - CLICK);
    const G = globalThis as any;
    if (G.__hpFire && Math.abs(held - heldFromPlayed(state, card, side, playedWorth(state, card))) > 1e-9) G.__hpFire.hr = (G.__hpFire.hr ?? 0) + 1;
    return held;
  }
  return __heldWorth(state, card, side, freeInstall);
}

/**
 * HAND-PRICE (count step): the steal chance of one agenda held in HQ over the Runner's next turn, from owners that exist:
 * 0 if HQ holds (serverHold 'runnerTurn', the Corp's credits), else 1 - (1 - 1/|HQ|)^entries (one random card a run).
 */
export function __hqSteal(state: GameState): number {
  const n = state.corp.hq.length;
  if (!n) return 0;
  const h = __serverHold(state, 'hq', { when: 'runnerTurn', corpCredits: state.corp.credits });
  if (h.holds) return 0;
  return 1 - (1 - 1 / n) ** Math.max(1, h.entries);
}

/** HAND-PRICE (count step): the steal chance agendaWorth reads for an agenda in this remote (oracleSteal ?? stealOdds). */
export function __remoteSteal(state: GameState, server: string): number {
  return __oracleSteal(state, server) ?? __stealOdds(state, server);
}

function __heldWorth(state: GameState, card: CardInstance, side: SideCode, freeInstall = false): number {`,
    ],
    ['ai/handValues.ts', `import { corpDrawPool, corpKnowsRd } from './oracle';`, `import { corpDrawPool, corpKnowsRd } from './oracle';\nimport { serverHold as __serverHold } from './corp/hold';\nimport { stealOdds as __stealOdds } from './effectValues';\nimport { oracleSteal as __oracleSteal } from './oracle';`],
    // ---------------------------------------------------------------- keepBonus: record (H3 d)
    [
      'ai/synergy.ts',
      `  return Math.min(1, tuning.keep[side] * v);
}`,
      `  const __kb = Math.min(1, tuning.keep[side] * v);
  const __G = globalThis as any;
  if (__G.__hpCalls) {
    __G.__hpCalls.kb = (__G.__hpCalls.kb ?? 0) + 1;
    if (__kb !== 0) {
      __G.__hpCalls.kbnz = (__G.__hpCalls.kbnz ?? 0) + 1;
      (__G.__hpKbCards ??= {})[card.cardCode] = (__G.__hpKbCards[card.cardCode] ?? 0) + 1;
    }
  }
  return __kb;
}`,
    ],
    // ---------------------------------------------------------------- the resource trash's extra term: O1
    [
      'ai/corp/candidates.ts',
      `        const extra = resource && k > 0 && plan().hqTrashCost ?`,
      `        const extra = !${O1} && resource && k > 0 && plan().hqTrashCost ?`,
    ],
    // ---------------------------------------------------------------- agendaMove: LB
    [
      'ai/corp/candidates.ts',
      `  add({ action: a, line: hold?.holds ? 3 : 9, behind: below,`,
      `  let __line = hold?.holds ? 3 : 9;
  if (${LB} && __line === 9 && server && a.type === 'INSTALL_CARD') {
    const remote = __remoteSteal(after, server);
    const hq = __hqSteal(state);
    if (remote < hq) {
      __line = 6.5;
      const G = globalThis as any;
      if (G.__hpFire) G.__hpFire.lb = (G.__hpFire.lb ?? 0) + 1;
    }
  }
  add({ action: a, line: __line, behind: below,`,
    ],
    [
      'ai/corp/candidates.ts',
      `  const agenda = list.find(c => c.line === 3) ?? list.find(c => c.line === 9);`,
      `  const agenda = list.find(c => c.line === 3) ?? list.find(c => c.line === 9 || c.line === 6.5);`,
    ],
    [
      'ai/corp/candidates.ts',
      `import { placedCounterWorth } from '../effectValues';`,
      `import { placedCounterWorth } from '../effectValues';
import { __hqSteal, __remoteSteal } from '../handValues';`,
    ],
    // ---------------------------------------------------------------- the time inside the planner
    [
      'ai/corpAI.ts',
      `  private plan(state: GameState, ranked: ScoredAction[]): GameAction | null {`,
      `  private plan(state: GameState, ranked: ScoredAction[]): GameAction | null {
    const __at = performance.now();
    try {
      return this.__plan(state, ranked);
    } finally {
      const G = globalThis as any;
      if (G.__hpArm) G.__hpPlanMs = (G.__hpPlanMs ?? 0) + performance.now() - __at;
    }
  }

  private __plan(state: GameState, ranked: ScoredAction[]): GameAction | null {`,
    ],
  ];
}

/** Copies this checkout's src into root/<arm>/src with the arm's patches; each patch must match exactly once. */
export function makeTrees(root: string, arms: readonly Arm[], from = 'src'): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync(from, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of patches(arm)) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${arm}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to),
      );
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
  hv: any;
  ev: any;
  hold: any;
  cand: any;
  pricing: any;
  tp: any;
  basic: any;
  vm: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/evaluate.ts', 'ai/corp/hold.ts', 'ai/corp/candidates.ts', 'ai/pricing.ts', 'ai/turnPlanner.ts', 'core/engine/actions/basic.ts', 'ai/valueModel.ts'])
    mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, evl, hold, cand, pricing, tp, basic] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    hv,
    ev: evl,
    hold,
    cand,
    pricing,
    tp,
    basic,
    vm,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
