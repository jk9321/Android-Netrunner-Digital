/**
 * Stage D item 6 step 1 (stage-d/item6-install-prompts/brief.md section 2.3): the arm, as text patches of a copy of src/
 * (no source change). Each entry is [file under src/, text that must occur once, replacement].
 *
 *  - probe   (every tree, base included): answerPrompt reports each Corp prompt it answers to the script's probe
 *            (globalThis.__ppProbe: the state, the owners' answer or undefined, and today's answer as a thunk), and each
 *            prompt the run term decides (globalThis.__ppRun).
 *  - owners  every Corp prompt that installs a card or picks a server for one is answered by the owners, after the run
 *            term and before the per-card blocks and the fallback (which stay for every other prompt):
 *              * the card: the order (corpCandidates) over the prompt's installs, each candidate card at each server its
 *                own server question offers, the board after each made by the prompt itself (the engine pays what the
 *                card says: all costs, a discount, none); the first candidate that is not behind; when every one is
 *                behind (or none is offered) the prompt is declined where it may be (min 0, or a non-server option such
 *                as Off the Books' "add it to HQ"), as the main phase's order puts that group after ending the turn;
 *              * the server: place(card, ctx)[0], through the same order over the one card at each offered server;
 *              * an agenda whose install the engine marks known to the Runner (Synapse Global, Off the Books) is not
 *                offered.
 *            What makes the order fit a prompt (FreeInstall now carries the prompt's own board, not "ignoring all costs"):
 *              * place, centralIce, iceRedirect, assetPartner and corpCandidates find the card in the prompt's zone
 *                (HQ, R&D, Archives), not only HQ;
 *              * the paid test of ice (icePaid, the fallback's `paid`) reads what the prompt's board leaves: credits after
 *                the install less the rez still owed (none when the prompt rezzed it), against keep (8.5.11a costs as the
 *                engine charged them). For a prompt that ignores all costs this is today's test.
 *            An install prompt is recognised by the engine, not by a card list: a server question whose first server
 *            option installs the card it names, or a card question whose answer opens that card's server question or
 *            installs it (Brân 1.0, Tatu-Bola).
 *  - no9     as owners, and an agenda into a server that does not hold (line 9) does not beat a decline (only lines 1-8).
 */
type Patch = [string, string, string];

const G = '(globalThis as unknown as Record<string, any>)';

const probeOnly: Patch[] = [
  [
    'ai/prompts.ts',
    '  if (run?.length === 1) return run[0];\n  const today = todayAnswer(state, side, memory, synergy);',
    `  if (run?.length === 1) {\n    ${G}.__ppRun?.(state, run[0]);\n    return run[0];\n  }\n  ${G}.__ppProbe?.(state, side, undefined, null);\n  const today = todayAnswer(state, side, memory, synergy);`,
  ],
];

const ownersAnswer: Patch[] = [
  [
    'ai/prompts.ts',
    '  if (run?.length === 1) return run[0];\n  const today = todayAnswer(state, side, memory, synergy);',
    `  if (run?.length === 1) {\n    ${G}.__ppRun?.(state, run[0]);\n    return run[0];\n  }\n  const owned = side === 'corp' ? (corpPorts as unknown as { installAnswer(s: GameState): GameAction | undefined }).installAnswer(state) : undefined;\n  ${G}.__ppProbe?.(state, side, owned, () => todayAnswer(state, side, memory, synergy));\n  const today = owned ?? todayAnswer(state, side, memory, synergy);`,
  ],
  ['ai/corpAI.ts', "import { asRanked, corpCandidates, freeInstallTarget, plannerIntake } from './corp/candidates';", "import { asRanked, corpCandidates, freeInstallTarget, installAnswer, plannerIntake } from './corp/candidates';"],
  ['ai/corpAI.ts', '  freeInstallTarget,\n  perfectRecallTarget,', '  freeInstallTarget,\n  installAnswer,\n  perfectRecallTarget,'],
  // placement.ts: the card from the prompt's zone; the paid test from the prompt's board
  ['ai/corp/placement.ts', "import { CardInstance, GameAction, GameState, cardDef, executeAction, isLegalAction, rezCostOf } from '../../core';", "import { CardInstance, GameAction, GameState, cardDef, executeAction, findCardAnywhere, isLegalAction, rezCostOf } from '../../core';"],
  [
    'ai/corp/placement.ts',
    '  if (!isInstall(from) || from.cardInstanceId !== card.instanceId || !state.corp.hq.some(c => c.instanceId === card.instanceId)) return [];',
    '  if (!isInstall(from) || from.cardInstanceId !== card.instanceId || (!ctx.free && !state.corp.hq.some(c => c.instanceId === card.instanceId))) return [];',
  ],
  [
    'ai/corp/placement.ts',
    "  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);\n  if (!card || typeOf(card) !== 'ice') return null;\n  const target = ",
    "  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId) ?? (free ? findCardAnywhere(state, a.cardInstanceId ?? '') : undefined);\n  if (!card || typeOf(card) !== 'ice') return null;\n  const target = ",
  ],
  [
    'ai/corp/placement.ts',
    "  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);\n  if (!card || typeOf(card) !== 'ice') return null;\n  if (!a.asNewRemote",
    "  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId) ?? (free ? findCardAnywhere(state, a.cardInstanceId ?? '') : undefined);\n  if (!card || typeOf(card) !== 'ice') return null;\n  if (!a.asNewRemote",
  ],
  [
    'ai/corp/placement.ts',
    '  const card = state.corp.hq.find(c => c.instanceId === pick.cardInstanceId);',
    "  const card = state.corp.hq.find(c => c.instanceId === pick.cardInstanceId) ?? (free ? findCardAnywhere(state, pick.cardInstanceId) : undefined);",
  ],
  [
    'ai/corp/placement.ts',
    '  const paid = (id: string) => icePaidAt(state, card, free ? 0 : state.corp.servers[id].ice.length, keep);',
    "  const paid = (id: string) => (free ? promptPaid(state, card, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: card.instanceId, targetServerId: id } as GameAction, keep, free) : icePaidAt(state, card, state.corp.servers[id].ice.length, keep));",
  ],
  [
    'ai/corp/placement.ts',
    '/**\n * Spec 1.8 ice rule 3 (Stage C1',
    `/** The paid test on a prompt's own board (arm owners): the credits the install leaves, less the rez still owed, against keep. */
export function promptPaid(state: GameState, card: CardInstance, a: GameAction, keep: number, free: FreeInstall): boolean {
  const after = free(a);
  if (!after) return false;
  const placed = Object.values(after.corp.servers).flatMap(v => v.ice).find(c => c.instanceId === card.instanceId);
  if (placed?.isRezzed) return after.corp.credits >= keep;
  return icePaidAt(state, card, state.corp.credits - after.corp.credits, keep);
}

/**
 * Spec 1.8 ice rule 3 (Stage C1`,
  ],
  // candidates.ts
  ['ai/corp/candidates.ts', "import { CardInstance, GameAction, GameState, activePrompt, cardDef, getLegalActions } from '../../core';", "import { CardInstance, GameAction, GameState, activePrompt, cardDef, findCardAnywhere, getLegalActions } from '../../core';"],
  ['ai/corp/candidates.ts', "import { FreeInstall, Placement, iceCount, icePaidAt, place, placedInstall, placementAction } from './placement';", "import { FreeInstall, Placement, iceCount, icePaidAt, place, placedInstall, placementAction, promptPaid } from './placement';"],
  [
    'ai/corp/candidates.ts',
    '    const card = corp.hq.find(c => c.instanceId === id);\n    if (!card) continue;\n    for (const { action } of placedInstalls(',
    '    const card = corp.hq.find(c => c.instanceId === id) ?? (opts.free ? findCardAnywhere(state, id) : undefined);\n    if (!card) continue;\n    for (const { action } of placedInstalls(',
  ],
  [
    'ai/corp/candidates.ts',
    '  const server = a.asNewRemote || !a.targetServerId || free ? null : state.corp.servers[a.targetServerId];\n  return icePaidAt(',
    '  if (free) return promptPaid(state, card, a, keep, free);\n  const server = a.asNewRemote || !a.targetServerId || free ? null : state.corp.servers[a.targetServerId];\n  return icePaidAt(',
  ],
  [
    'ai/corp/candidates.ts',
    'export function freeInstallOrder(state: GameState, options: string[]): Candidate[] {',
    `type PickOpts = { card: CardInstance; options: string[] };
const resolveAs = (p: { id: string }, choice: object) => ({ type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice }) as GameAction;
const serverIdOf = (s: GameState, id: string) => Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id;
const isServerOption = (s: GameState, id: string) => id === 'new' || !!s.corp.servers[id];
const answerMemo = new WeakMap<GameState, GameAction | undefined>();

/** Stage D3 arm (scripts/stage-d/prompt-place-patches.ts): a Corp install prompt answered by the owners; undefined: not an install prompt. */
export function installAnswer(state: GameState): GameAction | undefined {
  if (answerMemo.has(state)) return answerMemo.get(state);
  const r = installAnswerOf(state);
  answerMemo.set(state, r);
  return r;
}
function installAnswerOf(state: GameState): GameAction | undefined {
  const p = activePrompt(state);
  if (!p || p.side !== 'corp') return undefined;
  if (p.kind === 'effect_choice') {
    const id = p.source.data?.cardId;
    const card = id ? findCardAnywhere(state, String(id)) : undefined;
    if (!card) return undefined;
    const options = p.options.map(o => o.id).filter(o => isServerOption(state, o));
    if (!options.length) return undefined;
    const probe = simulate(state, resolveAs(p, { kind: 'effect_choice', optionId: options[0] }));
    if (!probe || !serverIdOf(probe, card.instanceId)) return undefined;
    const order = promptOrder(state, [{ card, options }]);
    const decline = p.options.find(o => !isServerOption(state, o.id));
    const first = decline ? order.find(c => !c.behind) : order[0];
    if (!first) return decline ? resolveAs(p, { kind: 'effect_choice', optionId: decline.id }) : undefined;
    const a = first.action as Install;
    return resolveAs(p, { kind: 'effect_choice', optionId: a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId, ...(a.trashFirst?.length ? { trashFirst: a.trashFirst } : {}) });
  }
  if (p.kind === 'effect_cards' && p.max >= 1 && p.candidateIds.length && p.candidateIds.length <= 40) {
    const picks: PickOpts[] = [];
    for (const id of p.candidateIds) {
      const card = findCardAnywhere(state, id);
      const after = card ? simulate(state, resolveAs(p, { kind: 'effect_cards', cardInstanceIds: [id] })) : null;
      if (!card || !after) continue;
      const next = activePrompt(after);
      if (next?.side === 'corp' && next.kind === 'effect_choice' && String(next.source.data?.cardId) === id) {
        const options = next.options.map(o => o.id).filter(o => isServerOption(after, o));
        if (options.length) picks.push({ card, options });
      } else {
        const at = serverIdOf(after, id);
        if (at && !serverIdOf(state, id)) picks.push({ card, options: [at] });
      }
    }
    if (!picks.length) return undefined;
    const order = promptOrder(state, picks);
    const ok = (c: Candidate) => !c.behind && __PP_LINE_OK__;
    const first = order.find(ok) ?? (p.min > 0 ? order[0] : undefined);
    if (!first) return p.min === 0 ? resolveAs(p, { kind: 'effect_cards', cardInstanceIds: [] }) : undefined;
    return resolveAs(p, { kind: 'effect_cards', cardInstanceIds: [first.card!] });
  }
  return undefined;
}

/** The order over a prompt's installs: each card at each server offered, the board after each made by the prompt itself. */
function promptOrder(state: GameState, picks: PickOpts[]): Candidate[] {
  const memo = new Map<string, GameState | null>();
  const free: FreeInstall = a => {
    const k = JSON.stringify(a);
    if (!memo.has(k)) memo.set(k, promptAfter(state, a as Install));
    return memo.get(k)!;
  };
  const legal = picks.flatMap(({ card, options }) => options.map(o => (o === 'new' ? { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: card.instanceId, asNewRemote: true } : { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: card.instanceId, targetServerId: o }) as GameAction));
  const offered = new Map(picks.map(x => [x.card.instanceId, x.options]));
  const where = (a: Install) => (a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId);
  const order = corpCandidates(state, legal, { held: null, freeExhausted: false, free }).filter(c => {
    if (!isInstall(c.action) || !offered.get(c.action.cardInstanceId)?.includes(where(c.action))) return false;
    const card = findCardAnywhere(state, c.action.cardInstanceId);
    if (card && cardDef(card).type_code === 'agenda') {
      const after = free(c.action);
      if (!after || findInstalled(after, card.instanceId)?.runnerKnows) return false;
    }
    return true;
  });
  // The script's record (prompt-place.ts): each prompt's order, the first time it is computed, by prompt id
  const rec = ${G}.__ppOrders as Map<string, unknown> | undefined;
  const pid = activePrompt(state)?.id;
  if (rec && pid && !rec.has(pid)) rec.set(pid, order.map(c => { const a = c.action as Install; const after = free(a); return { card: c.card, type: cardDef(findCardAnywhere(state, a.cardInstanceId)!).type_code, server: where(a), line: c.line, behind: c.behind, credits: after ? state.corp.credits - after.corp.credits : null }; }));
  return order;
}

/** The board after the prompt installs \`a\`: its card question answered, then its server question (or the card placed by the pick itself). */
function promptAfter(state: GameState, a: Install): GameState | null {
  let s: GameState | null = state;
  const p0 = activePrompt(state);
  if (p0?.kind === 'effect_cards') {
    if (!p0.candidateIds.includes(a.cardInstanceId)) return null;
    s = simulate(state, resolveAs(p0, { kind: 'effect_cards', cardInstanceIds: [a.cardInstanceId] }));
  }
  if (!s) return null;
  const server = a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId;
  const at = activePrompt(s);
  if (at?.kind === 'effect_choice' && String(at.source.data?.cardId) === a.cardInstanceId) {
    if (!at.options.some(o => o.id === server)) return null;
    return simulate(s, resolveAs(at, { kind: 'effect_choice', optionId: server }));
  }
  const placed = serverIdOf(s, a.cardInstanceId);
  return placed && s !== state && placed === server ? s : null;
}

export function freeInstallOrder(state: GameState, options: string[]): Candidate[] {`,
  ],
];

const lineOk = (expr: string): Patch[] => ownersAnswer.map(([f, from, to]) => [f, from, to.replace('__PP_LINE_OK__', expr)] as Patch);

/**
 * chain  the narrower candidate (AI Coordinator, design-answer.md section 2.3): the per-card blocks stay; an install
 *        prompt's server question is answered by place (the owners' server answer above); the fallback scores each
 *        card pick on the board after its server question is answered that way (followChain follows one step: the
 *        picked card's own server question from the same source), decline left in the comparison. Removes the tie and
 *        nothing else.
 */
const chain: Patch[] = [
  ...lineOk('c.line !== 9').filter(([f]) => f !== 'ai/prompts.ts'),
  [
    'ai/prompts.ts',
    '  if (run?.length === 1) return run[0];\n  const today = todayAnswer(state, side, memory, synergy);',
    `  if (run?.length === 1) {\n    ${G}.__ppRun?.(state, run[0]);\n    return run[0];\n  }\n  const p0 = activePrompt(state);\n  const owned = side === 'corp' && p0?.kind === 'effect_choice' ? (corpPorts as unknown as { installAnswer(s: GameState): GameAction | undefined }).installAnswer(state) : undefined;\n  ${G}.__ppProbe?.(state, side, owned, () => todayAnswer(state, side, memory, synergy));\n  const today = owned ?? todayAnswer(state, side, memory, synergy);`,
  ],
  [
    'ai/prompts.ts',
    "  if (!('source' in prompt) || getCardDefinition(prompt.source.cardCode).type_code !== 'identity') return after;",
    `  if (!('source' in prompt) || getCardDefinition(prompt.source.cardCode).type_code !== 'identity') {
    // arm chain: a card pick is scored after its own server question (same source), answered as answerPrompt answers it
    const next = activePrompt(after);
    if (side === 'corp' && prompt.kind === 'effect_cards' && next?.side === 'corp' && next.kind === 'effect_choice' && 'source' in next && next.source.instanceId === prompt.source.instanceId && next.source.data?.cardId) {
      const r = simulate(after, answerPrompt(after, side, memory, synergy));
      return r ?? after;
    }
    return after;
  }`,
  ],
];

/**
 * tie    step 2 (AI Coordinator, design-answer.md section 3, rule (2)): at a Corp card question where every answer the
 *        fallback scores comes out alike (the pick-step tie: the card is still in HQ, so the one-step board does not
 *        change), take the order's first install of an offered card in lines 1 to 6 that is not behind; when there is
 *        none, or the question installs nothing, today's answer. The server question, the per-card blocks and the run
 *        term are untouched (the owners' prompts.ts entry point is not patched in); no agenda the engine marks known to
 *        the Runner after the install (as owners).
 */
const tieFirst = (to: string) =>
  to.replace(
    "const first = order.find(ok) ?? (p.min > 0 ? order[0] : undefined);\n    if (!first) return p.min === 0 ? resolveAs(p, { kind: 'effect_cards', cardInstanceIds: [] }) : undefined;",
    'const first = order.find(ok);\n    if (!first) return undefined;',
  );
const tieArm: Patch[] = [
  ...probeOnly,
  ...lineOk('c.line <= 6').filter(([f]) => f !== 'ai/prompts.ts').map(([f, from, to]) => [f, from, tieFirst(to)] as Patch),
  ['ai/prompts.ts', '  let bestScore = -Infinity;\n  const skip = bypassSkips(', '  let bestScore = -Infinity;\n  let lo = Infinity;\n  let hi = -Infinity;\n  let scored = 0;\n  const skip = bypassSkips('],
  [
    'ai/prompts.ts',
    '    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;\n    if (score > bestScore) {\n      bestScore = score;\n      best = action;\n    }\n  }\n  return best;\n}',
    `    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;\n    lo = Math.min(lo, score);\n    hi = Math.max(hi, score);\n    scored++;\n    if (score > bestScore) {\n      bestScore = score;\n      best = action;\n    }\n  }\n  if (side === 'corp' && prompt.kind === 'effect_cards' && scored > 1 && hi - lo < 1e-9) {\n    const tie = (corpPorts as unknown as { installAnswer(s: GameState): GameAction | undefined }).installAnswer(state);\n    ${G}.__ppTie?.(state, tie);\n    if (tie) return tie;\n  }\n  return best;\n}`,
  ],
];

export const ARM_PATCHES: Record<string, Patch[]> = {
  base: probeOnly,
  owners: lineOk('true'),
  no9: lineOk('c.line !== 9'),
  chain,
  // control: a second tree with base's patches only (base against base, for the time read: JIT warmth of the tree
  // that plays the self-play games)
  same: probeOnly,
  tie: tieArm,
};
