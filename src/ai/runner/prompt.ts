import { CardInstance, GameAction, GameState, activePrompt, findCardAnywhere, getLegalActions, isLegalAction } from '../../core';
import type { RunnerMemory } from '../runs';
import { promptAnswers, promptInPlaceIds, scoreAnswer, shownByPrompt, simulate, withChainWork } from '../prompts';
import { freezeAsked } from '../valueModel';

/**
 * R-B B3 commit 2 (brief runner-rework/briefs/b3-prompt-view.md rev 2): the deciding Normal Runner answers its prompts
 * on its own view (rule 10.2.2a), with what the prompt shows it. The cards a prompt names fall in three classes, read
 * from the engine's rule for the Runner's screen (core/view.ts viewFor: the prompt's cards, each with its face or not):
 *  - shown by identity: a card the screen shows face up (a search's candidates, a card being installed from a hidden
 *    zone, the card being accessed). A Corp card is a pinned identity of the deal itself (B4d (c): runnerReply.ts
 *    guessRunnerView deals the rest around it, so the deal's pool and rules hold); a stack card keeps its identity in
 *    any deal (the deal shuffles the stack's cards, not their codes).
 *  - shown in place: a card the prompt shows by its text whose place the Runner knows (its entry's `promptShows.inPlace`,
 *    MuslihaT's top card): a Corp card pinned as above; a stack card put back where it really is, by a swap with the
 *    card the deal put there.
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
 *    as known failures for R-C1 (the brief, "In a run").
 * R-93's 'fetch' class (rulings 19.6: a prompt that shows by face a card of the Runner's own stack, Mutual Favor) left
 * with F117 (the Corp side's D1 and D2: the shown card is a seen arrival priced by its owner, and the search's install
 * is followed), so those prompts are answered on the honest view and its known leak is closed.
 */
export function todayPathKind(state: GameState): 'host' | null {
  const prompt = activePrompt(state);
  if (!prompt || prompt.side !== 'runner') return null;
  const data = 'source' in prompt ? (prompt.source.data as Record<string, unknown> | undefined) : undefined;
  const hostStep = prompt.kind === 'effect_choice' && typeof data?.cardId === 'string' && Array.isArray(data.trashIds) && typeof data.discount === 'number';
  if (state.activeRun && hostStep) return 'host';
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

/**
 * The ids of the cards the engine shows the Runner face up in its active prompt: prompts.ts shownByPrompt (the screen's
 * face rule, core/view.ts promptCardFaces, on what the Runner's view shows before its prompts), the cards still in the
 * game, without building the whole view (F117, tracker R-96). The active prompt is the first pending one, so no earlier
 * prompt of the view has shown a card first.
 */
export function promptShownIds(state: GameState): ReadonlySet<string> {
  const known = shownByState.get(state);
  if (known) return known;
  const out = new Set<string>();
  shownByState.set(freezeAsked(state), out); // read only once asked (F3's tripwire, B4 brief rev 1d)
  for (const id of shownByPrompt(state, 'runner')) if (findCardAnywhere(state, id)) out.add(id);
  return out;
}
/** promptShownIds per state (worked out once a prompt; a state is never edited once read). */
const shownByState = new WeakMap<GameState, ReadonlySet<string>>();

/** The cards the active prompt shows in place (prompts.ts owns it since F117: D1 (iii) reads it there, and prompts.ts cannot import this file). */
export { promptInPlaceIds };

/**
 * The honest view: `ports.view` with every card the prompt shows by identity or in place kept as it really is (the
 * classes above). B4d (c), red team RT2: a shown Corp card is a pinned identity of the deal itself (runnerReply.ts
 * guessRunnerView: the deal keeps it and deals the rest around it, with its root kinds, holdsOne and the certain counts),
 * so no swap is made here; the swap and its copy of the deal's fit test are gone (one owner of a legal deal). `kept`: the
 * ids already right in the view; `unkept`: a shown Corp card the view handed in does not hold as it is (a view not dealt
 * with the pins), left as dealt and read as unknown.
 */
export function honestPromptView(state: GameState, ports: PromptViewPorts): { view: GameState; kept: Set<string>; unkept: string[] } {
  const shown = promptShownIds(state);
  const inPlace = promptInPlaceIds(state);
  const slots = ports.slots(state);
  const real = new Map([...slots.ice, ...slots.root, ...slots.loose].map(c => [c.instanceId, c.cardCode]));
  const kept = new Set<string>();
  const unkept: string[] = [];
  let view = ports.view;
  // Shown by identity: a Corp card the deal pinned
  const vs = ports.slots(view);
  const dealt = new Map([...vs.ice, ...vs.root, ...vs.loose].map(c => [c.instanceId, c.cardCode]));
  for (const id of [...shown, ...inPlace]) {
    const want = real.get(id);
    if (want === undefined || !dealt.has(id)) continue;
    if (dealt.get(id) === want) kept.add(id);
    else unkept.push(id);
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
  // The view's answer is not one the real prompt allows: the best on the view among those it allows, each scored by
  // prompts.ts's one-answer scorer (its chain and answer frame; F117, the Runner read: no copy of it here)
  const prompt = activePrompt(view)!;
  const best = withChainWork(view, at => {
    let pick: GameAction | undefined;
    let bestScore = -Infinity;
    for (const a of promptAnswers(view, 'runner', ports.synergy)) {
      if (!isLegalAction(state, a)) continue;
      const after = simulate(view, a);
      if (!after) continue;
      const score = scoreAnswer(view, prompt, a, after, 'runner', ports.memory, ports.synergy, at);
      if (score > bestScore) {
        bestScore = score;
        pick = a;
      }
    }
    return pick;
  });
  if (best) return { action: best, path: 'again' };
  const first = getLegalActions(state, 'runner').find(a => a.type === 'RESOLVE_PROMPT');
  return { action: first ?? action, path: 'last' };
}
