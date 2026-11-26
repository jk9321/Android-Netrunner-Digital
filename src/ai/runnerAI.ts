import { GameAction, GameState, activePrompt, cardDef, getCardScript, getLegalActions, isLegalAction } from '../core';
import { runnerInstallBlocker } from '../core/engine/actions/install';
import { Agent, FreeActionGuard, ScoredAction } from './agent';
import { digValue, evaluate, rigCoverage } from './evaluate';
import { answerPrompt, runEventOptions, simulate } from './prompts';
import type { HeuristicOptions } from './corpAI';
import { asSide, nudge, tuning } from './synergy';
import { PlanMemory, planTurn, plannerOn, runnerDecisionView } from './turnPlanner';
import { runnerUnknownSlots } from './runnerReply';
import { RunnerMemory, chainReactionBonus, runCreditSpend, needsBiggerHand, runScore, runShortfall, serverValue, spendCost } from './runs';
import { RATES } from './valueModel';
import { inDecision } from './handValues';
import { plan } from './pricing';
import { CARDS } from './cards';
import { RunnerContext, runnerDecide, runnerOffTurn } from './runner/core';
import { RUNNER_TERMS } from './runner/terms';
import { honestPromptAnswer } from './runner/prompt';

// Read when called, not built at load: a list built here once read runs.ts's constants before they were set (this module
// loaded inside runs.ts's import cycle then; ai-trojans-load, tests/trojansLoad.test.ts). It is now in the cycle
// {corpAI, runnerAI, runnerReply, turnPlanner} (tests/codeHealth.test.ts), and a load-time read is still unsafe here.
// The trojans are the entries with runFacts.trojan (Botulus, Tranquilizer; R-A A-move); their host's worth is
// counterValues.ts trojanHostWorth (B3b)
const isTrojan = (code: string) => !!CARDS[code]?.runFacts?.trojan;

/**
 * Rule-based Runner: builds economy, installs icebreakers for the ice
 * subtypes it can't break yet, and runs the server with the best expected
 * value for its cost. It only looks at public information when planning runs.
 */
const WINDOW_OF_OPPORTUNITY = '34077';

export class HeuristicRunnerAI implements Agent {
  readonly side = 'runner' as const;
  private freeActions = new FreeActionGuard(['END_TURN', 'INITIATE_RUN']);
  private memory: RunnerMemory = new Map();
  private digForBreakers = false;
  /** A run worth making that the Runner can't afford yet (deck-aware AI: take money toward it). */
  private savingFor: string | null = null;
  readonly synergy: boolean;
  private debug: boolean;
  private planner: boolean;
  private planMemory: PlanMemory = { line: [] };

  constructor(options: HeuristicOptions = {}) {
    this.synergy = options.synergy ?? true;
    this.debug = options.debug ?? false;
    this.planner = options.planner ?? true;
  }

  chooseAction(state: GameState): GameAction {
    return asSide('runner', () => this.decide(state));
  }

  /**
   * On the Corp's turn: the best paid ability to use now (Madani's install),
   * judged like a free action on the Runner's own turn, or null.
   */
  chooseOffTurn(state: GameState): GameAction | null {
    return asSide('runner', () => runnerOffTurn(state, this.runnerContext()));
  }

  /** The off-turn question's scores, best first (runner/core.ts runnerOffTurn takes the first): not the ranking. */
  private offTurnRank(state: GameState): ScoredAction[] {
    this.freeActions.start(state, state.runner.clicks);
    // ai-honest-runner-view (red team 1): the baseline is scored on the same view as the actions
    const view = this.ownView(state);
    const before = evaluate(view, 'runner');
    return getLegalActions(state, 'runner')
      .filter(a => a.type === 'USE_ABILITY')
      .map(action => ({ action, score: this.scoreMain(state, action, before, view) }))
      .sort((a, b) => b.score - a.score);
  }

  /** The order of the questions (runner/core.ts runnerDecide) over this agent's context. */
  private decide(state: GameState): GameAction {
    return runnerDecide(state, this.runnerContext());
  }

  /** This agent as runner/core.ts reads it: its fields and its methods, built per decision (red team 2026-11-24 finding 11: the fields stay its own). */
  runnerContext(): RunnerContext {
    return {
      view: this.planner ? 'dealt' : 'given',
      memory: this.memory,
      remember: s => this.remember(s),
      prompt: s => this.promptAnswer(s),
      counted: readWriteFullShuffle,
      noteCounted: true,
      rank: (s, legal) => this.rankMainActions(s, legal),
      lookahead: this.planner
        ? (s, ranked) => {
            const planned = plannerOn('runner') ? this.plan(s, ranked) : null;
            return planned && { action: planned, note: true, log: true };
          }
        : undefined,
      offTurnRank: s => this.offTurnRank(s),
      note: a => this.notePlayed(a),
      debug: this.debug,
    };
  }

  /**
   * Root cards it has seen = the engine's marks (rezzed, faceup, `runnerKnows`; core/view.ts), only those: seen on access (rules 7.2.1; not as a candidate, 7.4.1a; not
   * on a replaced breach, 6.9.5b, 10.2.2b), new and unknown after HQ, R&D or facedown Archives (1.12.1, 1.12.3) unless seen going in (7.3.1a), kept through a derez (1.12.5).
   * Entries for cards no longer installed stay as they were (docs/ai-priced-quantities.md, "what the Runner has seen of the Corp's cards"; settled in R-B).
   */
  private remember(state: GameState) {
    for (const server of Object.values(state.corp.servers)) {
      for (const card of server.root) {
        if (card.isRezzed || card.faceUp || card.runnerKnows) this.memory.set(card.instanceId, card.cardCode);
        else this.memory.delete(card.instanceId);
      }
    }
  }

  /** Counts actions in a row that spent no click (loop guard). */
  notePlayed(action: GameAction) {
    this.freeActions.played(action);
  }

  /** The whole-turn planner's pick (plan.turnPlanner), its playouts by a fresh copy of this AI with what it has seen. */
  private plan(state: GameState, ranked: ScoredAction[]): GameAction | null {
    const rollout = new HeuristicRunnerAI({ synergy: this.synergy, planner: false });
    rollout.memory = new Map(this.memory);
    const options = { memory: this.memory, wary: this.synergy && tuning.wary };
    return planTurn(
      state,
      'runner',
      ranked,
      { rank: s => rollout.rankMainActions(s), answer: s => rollout.chooseAction(s), runWorth: (s, id, code) => runScore(s, id, code ? { ...runEventOptions(code, s), ...options } : options), runCredits: (s, id, code) => runCreditSpend(s, id, code ? runEventOptions(code, s) : {}), memory: this.planMemory, known: this.memory },
      this.synergy,
    );
  }

  /** Main-phase actions, best first, with this AI's score for each (the search AI starts from these). */
  rankMainActions(state: GameState, legal = getLegalActions(state, 'runner')): ScoredAction[] {
    // Read in the decision's pricing frame (runner/core.ts runnerDecide); asked on its own, the ranking opens it (inDecision)
    return inDecision(state, 'runner', () => {
      this.freeActions.start(state, state.runner.clicks);
      // ai-honest-runner-view (red team 1; rule 10.2.2a): the baseline, the runs and the actions are all scored on the
      // Runner's own view, so the guess of the Corp's hidden cards is not a constant offset against END_TURN, REMOVE_TAG,
      // runScore and the free-action cut
      const view = this.ownView(state);
      const before = evaluate(view, 'runner');
      // Nowhere worth running and breakers missing: dig for them
      this.digForBreakers =
        rigCoverage(state.runner.rig.programs).covered.size < 3 &&
        !legal.some(a => a.type === 'INITIATE_RUN' && runScore(view, a.targetServerId, { memory: this.memory, wary: this.synergy && tuning.wary }) > 0);
      this.savingFor = this.synergy ? saveUpTarget(state, this.memory) : null;
      return [...legal, ...makeRoomInstalls(state)]
        .map(action => {
          let score = this.scoreMain(state, action, before, view);
          // Deck-aware nudge: small, and only for moves the AI would consider anyway
          if (this.synergy && Number.isFinite(score) && action.type !== 'END_TURN') score += nudge(state, 'runner', action).bonus;
          return { action, score };
        })
        .sort((a, b) => b.score - a.score);
    });
  }

  /** Cards seen so far (for the search AI's guesses about hidden cards). */
  knownCards(): RunnerMemory {
    return this.memory;
  }

  /** Lets the search AI record what the Runner has seen before it ranks actions. */
  observe(state: GameState) {
    this.remember(state);
  }

  /**
   * The position the ranking simulates its actions from (plan.hiddenDraws; Jeff 2026-11-14, "AI runner should not see its
   * own draws"; rule 10.2.2a): for the AI playing the game, its own view of the decision (turnPlanner.ts
   * runnerDecisionView: the stack as its planner deals it), so a draw is scored on a guessed card, not the real top of the
   * stack. A planner's rollout (planner off) already plays on that deal, and the Corp's model of the Runner on the Corp's.
   */
  private ownView(state: GameState): GameState {
    return this.planner ? runnerDecisionView(state, this.memory) : state;
  }

  /**
   * A prompt answered from the Runner's own view (rule 10.2.2a): an answer that draws (LilyPAD, Read-Write Share) is
   * scored on the guessed stack, not the real next cards. B3 commit 2: the deciding Runner answers on the honest view,
   * the dealt view with what the prompt shows kept as it is (runner/prompt.ts: shown by identity, in place, named), never
   * on the real state. With the planner off (the rollout and reply Runners) the state handed in is already a deal.
   */
  private promptAnswer(state: GameState): GameAction {
    const view = this.ownView(state);
    if (view === state) return answerPrompt(state, 'runner', this.memory, this.synergy);
    const ports = { view, slots: (s: GameState) => runnerUnknownSlots(s, this.memory), memory: this.memory, synergy: this.synergy, answer: (s: GameState) => answerPrompt(s, 'runner', this.memory, this.synergy) };
    return honestPromptAnswer(state, ports).action;
  }

  private scoreMain(state: GameState, action: GameAction, before: number, view: GameState = state): number {
    switch (action.type) {
      case 'END_TURN':
        return RUNNER_TERMS.endTurn;
      case 'INITIATE_RUN':
        // Chain Reaction: a run on a central it still needs is worth a share of the play, if it succeeds
        return runScore(view, action.targetServerId, { memory: this.memory, wary: this.synergy && tuning.wary, successBonus: chainReactionBonus(state, action.targetServerId) });
      case 'REMOVE_TAG':
        return state.runner.rig.resources.length > 0 ? RUNNER_TERMS.tagRemovalResource : RUNNER_TERMS.tagRemovalNoResource;
    }
    const after = simulate(view, action);
    if (!after) return -Infinity;
    const spendsClick = after.runner.clicks < state.runner.clicks;
    if (!spendsClick && this.freeActions.exhausted) return -Infinity;

    // Run events and run abilities (Jailbreak, Overclock, Conduit, Red Team)
    const prompt = activePrompt(after);
    const cardCode = 'cardInstanceId' in action ? state.runner.grip.concat(state.runner.rig.resources, state.runner.rig.programs).find(c => c.instanceId === action.cardInstanceId)?.cardCode : undefined;
    const paid = state.runner.credits - after.runner.credits;
    if (prompt?.kind === 'effect_choice' && prompt.side === 'runner' && prompt.options.every(o => after.corp.servers[o.id])) {
      const options = { ...runEventOptions(prompt.source.cardCode, state), memory: this.memory, wary: this.synergy && tuning.wary };
      const best = Math.max(...prompt.options.map(o => runScore(view, o.id, options)));
      // Jailbreak draws a card if successful (its run entry's successDraws, priced here at RATES.drawnCard)
      return best - spendCost(state, paid) + (options.successDraws ? options.successDraws * RATES.drawnCard : 0);
    }
    // Window of Opportunity (plan.bypass): its install first (worth what the board gains, with no click), then its run
    if (cardCode === WINDOW_OF_OPPORTUNITY && plan().bypass && prompt?.side === 'runner' && !state.activeRun) {
      let ready = after;
      for (let i = 0; i < 3; i++) {
        const next = activePrompt(ready);
        if (!next || next.side !== 'runner' || (next.kind === 'effect_choice' && next.options.every(o => ready.corp.servers[o.id]))) break;
        const resolved = simulate(ready, answerPrompt(ready, 'runner', this.memory, this.synergy));
        if (!resolved) break;
        ready = resolved;
      }
      const ask = activePrompt(ready);
      if (ask?.kind === 'effect_choice' && ask.options.every(o => ready.corp.servers[o.id])) {
        const options = { ...runEventOptions(WINDOW_OF_OPPORTUNITY, ready), memory: this.memory, wary: this.synergy && tuning.wary };
        const best = Math.max(...ask.options.map(o => runScore({ ...ready, runner: { ...ready.runner, clicks: state.runner.clicks } }, o.id, options)));
        const install = evaluate(ready, 'runner') - evaluate(after, 'runner');
        return best + install - spendCost(state, paid);
      }
    }
    if (!state.activeRun && after.activeRun) {
      return runScore(view, after.activeRun.server, { ...runEventOptions(cardCode ?? '', state), memory: this.memory, wary: this.synergy && tuning.wary }) - spendCost(state, paid) + RUNNER_TERMS.runCard;
    }

    // Follow our own prompts (Lie Low, Scrounge, Madani) a few steps
    let resolved = after;
    // plan.answerCorpChoice: also the Corp's answer to the card's choice (Wildcat Strike: the Corp picks 6 credits or 4 cards)
    for (let i = 0; i < 3; i++) {
      const side = activePrompt(resolved)?.side;
      if (side !== 'runner' && !(side === 'corp' && this.synergy)) break;
      const next = simulate(resolved, answerPrompt(resolved, side, this.memory, this.synergy));
      if (!next) break;
      resolved = next;
    }
    let score = evaluate(resolved, 'runner') - before;
    // plan.drawCap (code audit, 2026-11-05): a card drawn past the hand size is discarded at the end of the turn
    // (rules 5.7.4), so these bonuses stop at the limit; a bigger hand for a trap run still counts while a click is left to run
    const room = state.runner.grip.length < state.runner.handSizeLimit;
    if (action.type === 'DRAW_CARD' && needsBiggerHand(state, this.memory) && (room || state.runner.clicks >= RUNNER_TERMS.bigHandClicks)) score += RUNNER_TERMS.bigHandDraw;
    if (action.type === 'DRAW_CARD' && this.digForBreakers && state.runner.stack.length > RUNNER_TERMS.digStackFloor && room) score += RUNNER_TERMS.digDraw;
    if (action.type === 'DRAW_CARD' && this.synergy && state.runner.grip.length < state.runner.handSizeLimit) score += digValue(state, 'runner');
    if (action.type === 'INSTALL_CARD' && action.hostInstanceId && cardCode && isTrojan(cardCode)) {
      const host = Object.values(state.corp.servers).flatMap(s => s.ice).find(c => c.instanceId === action.hostInstanceId);
      // B3b (S2): the host's worth is the board's own term (counterValues.ts trojanHostWorth), read through the outcome;
      // a facedown host keeps its named flat here, equal across facedown hosts, so it never picks among them
      if (!host?.isRezzed) score += RUNNER_TERMS.facedownTrojanHost;
    }
    // Saving up for a run: money now beats spending it elsewhere
    if (this.savingFor) {
      const gained = resolved.runner.credits - state.runner.credits;
      if (gained > 0) score += RUNNER_TERMS.savingGain;
      else if (gained < RUNNER_TERMS.savingSpendFloor) score += RUNNER_TERMS.savingSpend;
    }
    if (!spendsClick && score <= RUNNER_TERMS.freeActionCut) return -Infinity; // free actions only when clearly good
    return score;
  }
}

/**
 * Programs only the memory limit keeps out: install them by trashing one
 * or two installed programs first (rules 8.5.6c). Scoring the position afterwards
 * decides whether the swap is worth it.
 */
export function makeRoomInstalls(state: GameState): GameAction[] {
  if (state.activeRun || state.activePlayer !== 'runner' || state.runner.clicks < 1) return [];
  const installs: GameAction[] = [];
  for (const card of state.runner.grip) {
    if (cardDef(card).type_code !== 'program' || getCardScript(card.cardCode)?.installsOnIce) continue;
    // Blocked now, but not with all the memory back: memory is the only thing in the way
    if (!runnerInstallBlocker(state, card) || runnerInstallBlocker(state, card, undefined, 0, Infinity)) continue;
    // One program if that is enough, else two
    const programs = state.runner.rig.programs.map(c => c.instanceId);
    const singles = programs.map(id => [id]);
    const pairs = programs.flatMap((a, i) => programs.slice(i + 1).map(b => [a, b]));
    for (const options of [singles, pairs]) {
      const legal = options
        .map((trashFirst): GameAction => ({ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: card.instanceId, trashFirst }))
        .filter(action => isLegalAction(state, action));
      installs.push(...legal);
      if (legal.length > 0) break;
    }
  }
  return installs;
}

/**
 * The best server worth running (value 4+) that the Runner can't afford to
 * get into yet but could within about two turns of money, if any.
 */
function saveUpTarget(state: GameState, memory: RunnerMemory): string | null {
  let best: string | null = null;
  let bestValue = RUNNER_TERMS.saveUpWorthFloor;
  for (const id of Object.keys(state.corp.servers)) {
    const short = runShortfall(state, id);
    if (short === null || short <= 0 || short > RUNNER_TERMS.saveUpShortfallCap) continue;
    const value = serverValue(state, id, 0, memory, tuning.wary);
    if (value >= bestValue) {
      best = id;
      bestValue = value;
    }
  }
  return best;
}

const READ_WRITE_SHARE = '36022';

/**
 * plan.readWriteFull (Jeff, bug report #8): a Read-Write Share holding its limit of 4 cards can host
 * no more, so it only takes up memory. Trash it to shuffle the 4 back into the stack (a free action).
 */
export function readWriteFullShuffle(state: GameState, legal: GameAction[]): GameAction | undefined {
  const full = state.runner.rig.programs.find(p => p.cardCode === READ_WRITE_SHARE && (p.hostedCards?.length ?? 0) >= 4);
  if (!full) return undefined;
  return legal.find(a => a.type === 'USE_ABILITY' && a.cardInstanceId === full.instanceId);
}
