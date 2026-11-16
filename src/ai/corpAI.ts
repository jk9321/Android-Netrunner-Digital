import { CardInstance, GameAction, GameState, getLegalActions, isLegalAction } from '../core';
import { Agent, FreeActionGuard, ScoredAction } from './agent';
import { asSide } from './synergy';
import { decisionContext } from './handValues';
import { PlanMemory, corpDecisionView, planTurn, plannerOn, promptCardsInPlace } from './turnPlanner';
import { runnerReply } from './runnerReply';
import { decideRez, perfectRecallTarget } from './corp/rez';
import { holdingRezIds, rezMoney } from './corp/rezMoney';
import { registerCorpPorts } from './corpPorts';
import { plan, withPricing } from './pricing';
import { CorpMemory, corpDecide, countHonest, playoutLine } from './corp/core';
import { asRanked, corpCandidates, freeInstallTarget, plannerIntake } from './corp/candidates';

/**
 * The Corp agent (Step 4 Stage C, spec-step4-corp-core.md 2.1): a shell over the pipeline (corp/core.ts corpDecide), the
 * order of ordinary moves (corp/candidates.ts) and the turn planner as its look-ahead. It holds no rule and no number; the
 * hand-set move ranking that lived here is deleted. It stays outside corp/ because the turn planner and the Runner reply
 * import the agent.
 */

export interface HeuristicOptions {
  /** Deck-aware rules (synergy.ts). Off: the AI as it was before them. */
  synergy?: boolean;
  /** Log each move's synergy reasons to the console. */
  debug?: boolean;
  /** The whole-turn planner while plan.turnPlanner is on (default on; the Hard AI's search turns it off). */
  planner?: boolean;
}

export class HeuristicCorpAI implements Agent {
  readonly side = 'corp' as const;
  private freeActions = new FreeActionGuard(['END_TURN', 'START_TURN']);
  readonly synergy: boolean;
  private debug: boolean;
  private planner: boolean;
  private planMemory: PlanMemory = { line: [] };
  /** What the pipeline carries between decisions (corp/core.ts): the held two-turn score line. */
  private memory: CorpMemory = { heldLine: null };

  constructor(options: HeuristicOptions = {}) {
    this.synergy = options.synergy ?? true;
    this.debug = options.debug ?? false;
    this.planner = options.planner ?? true;
  }

  chooseAction(state: GameState): GameAction {
    return asSide('corp', () => (this.planner && this.synergy && plan().runRecord ? withPricing({ runRecord: this.noteRuns(state) }, () => this.decide(state)) : this.decide(state)));
  }

  /** plan.runRecord: the servers the Runner ran, by its turn, noted as this Corp sees each of its own turns (one game at a time). */
  private runs: { game: string; turns: Map<number, string[]> } = { game: '', turns: new Map() };

  /**
   * plan.runRecord (threatModel.ts recordRun): notes the Runner's last turn's runs (public, rules 6.1.2a, 6.9.1a) on the
   * Corp's turn, and returns the record, most recent turn first. A new game, or a turn already past (a reload), starts
   * it over. Only the deciding Corp keeps one; the planner's rollouts read it from the context.
   */
  noteRuns(state: GameState): string[][] {
    const latest = Math.max(0, ...this.runs.turns.keys());
    if (this.runs.game !== state.id || state.turnNumber - 1 < latest) this.runs = { game: state.id, turns: new Map() };
    if (state.activePlayer === 'corp' && state.turnNumber > 1) this.runs.turns.set(state.turnNumber - 1, state.runnerLastTurnRuns.map(r => r.server));
    return [...this.runs.turns.entries()].sort((a, b) => b[0] - a[0]).map(([, servers]) => servers);
  }

  /** The pipeline (corp/core.ts corpDecide), the order at Q7 and the turn planner over it; the deciding Corp reads its own view for the whole decision (rule 10.2.2a). */
  private decide(state: GameState): GameAction {
    const view = this.planner ? corpDecisionView(state) : state;
    const ctx = { synergy: this.synergy, counted: this.synergy && this.planner, memory: this.memory, debug: this.debug, note: (a: GameAction) => this.notePlayed(a) };
    const snapshot = () => {
      const line = [...this.planMemory.line];
      return () => void (this.planMemory.line = line);
    };
    const lookahead = this.planner ? (s: GameState, ranked: ScoredAction[]) => (plannerOn('corp') ? this.plan(s, ranked) : null) : undefined;
    return corpDecide(state, { ...ctx, rank: (s, legal) => this.rankMainActions(s, legal), lookahead, snapshot }, view, promptCardsInPlace(state, view));
  }

  /** Counts actions in a row that spent no click (loop guard). */
  notePlayed(action: GameAction) {
    this.freeActions.played(action);
  }

  /** The whole-turn planner's pick (plan.turnPlanner), its playouts by a fresh copy of this AI, each on its own copy of this Corp's held line (A1, playoutLine). */
  private plan(state: GameState, ranked: ScoredAction[]): GameAction | null {
    const rollout = new HeuristicCorpAI({ synergy: this.synergy, planner: false });
    const reply = plan().runnerReply ? (s: GameState, leaf: (s: GameState) => number) => runnerReply(s, this.synergy, leaf) : undefined;
    return planTurn(state, 'corp', ranked, { rank: s => rollout.rankMainActions(s), answer: s => rollout.chooseAction(s), reply, memory: this.planMemory, intake: plannerIntake, line: () => playoutLine(structuredClone(this.memory.heldLine), (s, held) => rollout.rankMainActions(s, undefined, held)) }, this.synergy);
  }

  /** Main-phase actions in the order (corp/candidates.ts); the position in it is the only number (asRanked). `held`: the line place reads (a playout's own copy, playoutLine; this Corp's by default). */
  rankMainActions(state: GameState, legal = getLegalActions(state, 'corp'), held: CorpMemory['heldLine'] = this.memory.heldLine): ScoredAction[] {
    const view = this.planner ? corpDecisionView(state) : state; // rule 10.2.2a: the deciding Corp's own deal (a rollout plays on it already); the legal list is the real state's
    decisionContext(view, 'corp');
    this.freeActions.start(state, state.corp.clicks);
    return asRanked(view, corpCandidates(view, legal, { held, freeExhausted: this.freeActions.exhausted }));
  }

  /** The rez window of a run (corp/rez.ts); the deciding Corp's on its own view under its own context, taken again on the real state if not legal there (rule 10.2.2a). */
  chooseRez(state: GameState, cards: CardInstance[]): GameAction | null {
    return asSide('corp', () => {
      const view = this.planner ? corpDecisionView(state) : state;
      if (this.planner) decisionContext(view, 'corp');
      const action = decideRez(view, cards, this.synergy);
      if (view === state || !action || isLegalAction(state, action)) return action;
      countHonest('illegalRez');
      decisionContext(state, 'corp');
      return decideRez(state, cards, this.synergy);
    });
  }
}

// The Corp owners the valuation layer and prompts.ts read (Stage B review R8): one registration, as the Corp agent loads
registerCorpPorts({
  keep: state => rezMoney(state).keep,
  holdingRezIds,
  // Stage C1b: the free install reads the order (corp/candidates.ts)
  freeInstallTarget,
  perfectRecallTarget,
});
