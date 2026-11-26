import { CardInstance, GameAction, GameState, activePrompt, getCardDefinition, getLegalActions, isLegalAction, newViewIds, viewFor } from '../../core';
import type { RunnerMemory } from '../runs';
import { promptAnswers, scoreOutcome, simulate } from '../prompts';
import { CARDS } from '../cards';

/**
 * R-B B3 commit 2 (brief runner-rework/briefs/b3-prompt-view.md rev 2): the deciding Normal Runner answers its prompts
 * on its own view (rule 10.2.2a), with what the prompt shows it. The cards a prompt names fall in three classes, read
 * from the engine's rule for the Runner's screen (core/view.ts viewFor: the prompt's cards, each with its face or not):
 *  - shown by identity: a card the screen shows face up (a search's candidates, a card being installed from a hidden
 *    zone, the card being accessed). A Corp card the deal recoded gets its identity back by a swap with the card the deal
 *    gave that identity, so the deal's pool stays right; a stack card keeps its identity in any deal (the deal shuffles
 *    the stack's cards, not their codes).
 *  - shown in place: a card the prompt shows by its text whose place the Runner knows (its entry's `promptShows.inPlace`,
 *    MuslihaT's top card): put back where it really is, by a swap with the card the deal put there.
 *  - named: a card only an option names, facedown on the screen: read as unknown (the deal's, which the readers treat as
 *    an unseen card), never put back.
 * An unlisted prompt reads its cards by these rules; nothing is answered on the real state. The views are copies: the
 * dealt view (runnerDecisionView's, cached per state) is never edited.
 *
 * The view and the slots come in from the agent (runnerAI.ts HeuristicRunnerAI.promptAnswer: turnPlanner.ts
 * runnerDecisionView, runnerReply.ts runnerUnknownSlots), so this file imports neither (the cycle guard,
 * tests/codeHealth.test.ts). It reads prompts.ts one way.
 */

/** The Corp cards the Runner can't see, as runnerReply.ts runnerUnknownSlots lists them for a state. */
export type UnknownSlots = { ice: CardInstance[]; root: CardInstance[]; loose: CardInstance[] };

export interface PromptViewPorts {
  /** The deciding Runner's dealt view of the state (turnPlanner.ts runnerDecisionView). */
  view: GameState;
  /** runnerReply.ts runnerUnknownSlots with the Runner's memory. */
  slots: (state: GameState) => UnknownSlots;
  memory?: RunnerMemory;
  synergy: boolean;
  /** prompts.ts answerPrompt for the Runner, on a state. */
  answer: (state: GameState) => GameAction;
}

/**
 * How the answer was found: 'view' (the honest view's own answer, legal on the real state), 'again' (it was not: the
 * best on the view among the answers the real prompt allows), 'last' (none of those plays on the view: the real prompt's
 * first allowed answer, which reads only what the screen offers), 'today' (todayPathKind's prompts). Counted by the
 * measurement scripts.
 */
export type PromptPath = 'view' | 'again' | 'last' | 'today';

/**
 * The prompts that keep today's answer path, so the honest view is not built for them:
 *  - 'host': a host step during a run (which ice a program installs on: core/scripts/steps.ts RunnerHostData), pinned
 *    as known failures for R-C1 (the brief, "In a run");
 *  - 'fetch': R-93's class (rulings 19.6), a prompt that shows by face a card of the Runner's own stack other than its
 *    in-place one (a search or reveal that moves it to the grip or an install: Mutual Favor). The outcome's hand term
 *    gives the shown card no worth until R-93 lands (the Corp side's F117), so on the view every answer would tie. A
 *    known leak: today's path answers it on the real state, which reads the stack's order only through rounding.
 */
export function todayPathKind(state: GameState): 'host' | 'fetch' | null {
  const prompt = activePrompt(state);
  if (!prompt || prompt.side !== 'runner') return null;
  const data = 'source' in prompt ? (prompt.source.data as Record<string, unknown> | undefined) : undefined;
  const hostStep = prompt.kind === 'effect_choice' && typeof data?.cardId === 'string' && Array.isArray(data.trashIds) && typeof data.discount === 'number';
  if (state.activeRun && hostStep) return 'host';
  const inPlace = promptInPlaceIds(state);
  const stack = new Set(state.runner.stack.map(c => c.instanceId));
  for (const id of promptShownIds(state)) if (stack.has(id) && !inPlace.has(id)) return 'fetch';
  return null;
}

/**
 * Today's path (before B3 commit 2): on the real state when the prompt names a stack card or a card the deal may have
 * recoded, else the view's answer if the real prompt allows it.
 */
function todaysAnswer(state: GameState, ports: PromptViewPorts): GameAction {
  const named = JSON.stringify(activePrompt(state));
  const { ice, root, loose } = ports.slots(state);
  if ([...state.runner.stack, ...ice, ...root, ...loose].some(c => named.includes(`"${c.instanceId}"`))) return ports.answer(state);
  const answer = ports.answer(ports.view);
  return isLegalAction(state, answer) ? answer : ports.answer(state);
}

/** The ids of the cards the engine shows the Runner face up in its active prompt (core/view.ts, the prompt's cards). */
export function promptShownIds(state: GameState): Set<string> {
  const prompt = activePrompt(state);
  const out = new Set<string>();
  if (!prompt || prompt.side !== 'runner') return out;
  const { view, ids } = viewFor(state, 'runner', newViewIds(), state.id);
  const mine = view.pendingPrompts.find(p => p.id === prompt.id);
  for (const c of mine?.cards ?? []) if (c.cardCode !== undefined && ids.real[c.instanceId]) out.add(ids.real[c.instanceId]);
  return out;
}

/** The cards the active prompt shows in place: its source entry's `promptShows.inPlace` key of the prompt's data. */
export function promptInPlaceIds(state: GameState): Set<string> {
  const prompt = activePrompt(state);
  const out = new Set<string>();
  if (!prompt || prompt.side !== 'runner' || !('source' in prompt)) return out;
  const key = CARDS[prompt.source.cardCode]?.promptShows?.inPlace;
  const id = key ? prompt.source.data?.[key] : undefined;
  if (typeof id === 'string') out.add(id);
  return out;
}

/** A copy of `state` with the Corp card `id` (installed, HQ, R&D or facedown Archives) given `code`, in its place. */
function recoded(state: GameState, id: string, code: string): GameState {
  const fix = (cards: CardInstance[]) => (cards.some(c => c.instanceId === id) ? cards.map(c => (c.instanceId === id ? { ...c, cardCode: code } : c)) : cards);
  const corp = state.corp;
  const servers = Object.fromEntries(Object.entries(corp.servers).map(([k, sv]) => [k, { ...sv, ice: fix(sv.ice), root: fix(sv.root) }]));
  return { ...state, corp: { ...corp, hq: fix(corp.hq), rd: fix(corp.rd), archives: { ...corp.archives, faceDown: fix(corp.archives.faceDown) }, servers } };
}

/**
 * The honest view: `ports.view` with every card the prompt shows by identity or in place kept as it really is (the
 * classes above). `kept`: the ids put back or already right in the view; `unkept`: a shown Corp card no swap could give
 * back (its identity was dealt only to slots its dealt code cannot fill), left as dealt and read as unknown.
 */
export function honestPromptView(state: GameState, ports: PromptViewPorts): { view: GameState; kept: Set<string>; unkept: string[] } {
  const shown = promptShownIds(state);
  const inPlace = promptInPlaceIds(state);
  const slots = ports.slots(state);
  const hidden = new Set([...slots.ice, ...slots.root, ...slots.loose].map(c => c.instanceId));
  const kept = new Set<string>();
  const unkept: string[] = [];
  let view = ports.view;
  // Shown by identity: a Corp card the deal recoded, swapped back
  const real = new Map([...slots.ice, ...slots.root, ...slots.loose].map(c => [c.instanceId, c.cardCode]));
  for (const id of [...shown, ...inPlace]) {
    if (!hidden.has(id)) continue;
    const vs = ports.slots(view);
    const kind = (cid: string) => (vs.ice.some(c => c.instanceId === cid) ? 'ice' : vs.root.some(c => c.instanceId === cid) ? 'root' : 'loose');
    const all = [...vs.ice, ...vs.root, ...vs.loose];
    const mine = all.find(c => c.instanceId === id);
    const want = real.get(id)!;
    if (!mine) continue;
    if (mine.cardCode === want) {
      kept.add(id);
      continue;
    }
    // The other slot dealt the identity, whose own slot takes the code this card was dealt (an ice slot an ice, a root
    // slot a root card; a loose card anything): the same test the deal applies
    const fits = (slot: CardInstance, code: string) => {
      const k = kind(slot.instanceId);
      if (k === 'loose') return true;
      const type = getCardDefinition(code).type_code;
      return k === 'ice' ? type === 'ice' : ['agenda', 'asset', 'upgrade'].includes(type);
    };
    const other = all.find(c => c.instanceId !== id && c.cardCode === want && !kept.has(c.instanceId) && !shown.has(c.instanceId) && fits(c, mine.cardCode));
    if (!other) {
      unkept.push(id);
      continue;
    }
    view = recoded(recoded(view, other.instanceId, mine.cardCode), id, want);
    kept.add(id);
  }
  // Shown in place: a stack card put back at its real place (a swap with the card the deal put there)
  for (const id of inPlace) {
    const at = state.runner.stack.findIndex(c => c.instanceId === id);
    if (at < 0) continue;
    const stack = [...view.runner.stack];
    const j = stack.findIndex(c => c.instanceId === id);
    if (j < 0) continue;
    if (j !== at) [stack[at], stack[j]] = [stack[j], stack[at]];
    view = { ...view, runner: { ...view.runner, stack } };
    kept.add(id);
  }
  // Shown by identity: a stack card keeps its identity in any deal (named here for the classes test)
  for (const id of shown) if (state.runner.stack.some(c => c.instanceId === id)) kept.add(id);
  return { view, kept, unkept };
}

/** The deciding Runner's answer to its prompt on the honest view (todayPathKind's prompts: today's), with its PromptPath. */
export function honestPromptAnswer(state: GameState, ports: PromptViewPorts): { action: GameAction; path: PromptPath } {
  if (todayPathKind(state)) return { action: todaysAnswer(state, ports), path: 'today' };
  const { view } = honestPromptView(state, ports);
  const action = ports.answer(view);
  if (isLegalAction(state, action)) return { action, path: 'view' };
  // The view's answer is not one the real prompt allows: the best on the view among those it allows
  let best: GameAction | undefined;
  let bestScore = -Infinity;
  for (const a of promptAnswers(view, 'runner', ports.synergy)) {
    if (!isLegalAction(state, a)) continue;
    const after = simulate(view, a);
    if (!after) continue;
    const score = scoreOutcome(view, after, 'runner', ports.memory, ports.synergy);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  if (best) return { action: best, path: 'again' };
  const first = getLegalActions(state, 'runner').find(a => a.type === 'RESOLVE_PROMPT');
  return { action: first ?? action, path: 'last' };
}
