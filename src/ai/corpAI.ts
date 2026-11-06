import { CardInstance, GameAction, GameState, ServerState, activePrompt, cardDef, findCardAnywhere, getCardDefinition, getCardScript, getLegalActions, isLegalAction } from '../core';
import { MYOSHU, plansOn } from './cardPlans';
import { iceScript, iceStrength, iceSubroutines, iceSubtypes, isIcebreaker } from '../core/engine/ice';
import { iceStop, iceWorth, withIceInstalled } from './iceValues';
import { rigCoverage } from './evaluate';
import { counters, rezCost } from '../core/engine/cardEffects';
import { turnKey } from '../core/engine/helpers';
import { stealCost } from '../core/engine/actions/run';
import { Agent, FreeActionGuard, ScoredAction } from './agent';
import { agendaWorth, digValue, evaluate, handValue, hqTrashCardsLoss } from './evaluate';
import { resourceTrashHqCost } from '../core/engine/actions/basic';
import { clickRate, pointGain, pointValue, printedGain } from './valueModel';
import { PACE, STEAL, accessWorth, agendaOdds } from './effectValues';
import { answerPrompt, simulate } from './prompts';
import { asSide, logNudge, nudge, opponentLean, tuning } from './synergy';
import { noteKnownHand } from './handValues';
import { PlanMemory, planTurn, plannerOn } from './turnPlanner';
import { runnerReply } from './runnerReply';
import { modelRezGain } from './rezModel';
import { freeRezCover, freeRezTargets } from './freeRez';
import { PETTY_CASH_REPLAY, iceAdvanceWorth, placedCounterWorth, rezEffectWorth, rezzedWorth, runTimed, topDownWorth } from './effectValues';
import { CARD_PROFILES, ECON_SCALE, PAYOUT_RISK, bareAssetRisk, unrezzedWorth } from './cardProfiles';

import { BLOCK, iceCost, iceCreditNeed, isTrap, subroutineCost, tagCost, weakestIce } from './runs';
import { cardSynergy } from './synergyTags';
import { econValue, upgradeValue } from './cardValues';
import { counterWorth } from './counterValues';


const type = (card: CardInstance) => cardDef(card).type_code;
const hasEndTheRun = (ice: CardInstance) => (iceScript(ice)?.subroutines ?? []).some(s => /end the run/i.test(s.label));
const isAgendaOrAsset = (card: CardInstance) => ['agenda', 'asset'].includes(type(card));

const CLEARINGHOUSE = '30061';

/**
 * plan.oneCurrency: what a free action (a rez, a paid ability) must gain to be taken, in credits; at or under it the
 * free-action loop guard could spin on moves that change nothing (the same floor the old playScore used).
 */
const FREE_ACTION_FLOOR = 0.3;

/**
 * plan.oneCurrency: an advance toward an agenda this turn can finish is worth about 0 (evaluate prices the finish
 * already), so a spare click's credit or draw ties with it; within this many credits of the best play the advance goes
 * first. A timing rule, not a worth: the same turn either way, but a Runner prompt mid-turn or the planner's step cap
 * can't leave the agenda an advance short over the Runner's turn.
 */
const FINISH_TIE = FREE_ACTION_FLOOR;

/** The Corp's main-phase actions that cost a click (basic actions, rule 5.2.6b-h; an operation is played with one, 5.2.6e). */
const CLICK_ACTIONS = new Set<GameAction['type']>(['GAIN_CREDIT', 'DRAW_CARD', 'INSTALL_CARD', 'PLAY_OPERATION_OR_EVENT', 'ADVANCE_CARD', 'PURGE_VIRUS', 'TRASH_RESOURCE']);

/** A Corp asset that pays when the Corp's turn begins, with nothing at the end of the turn before it (plan.turnStartRez). */
export const turnStartOnly = (card: CardInstance): boolean => {
  const triggers = getCardScript(card.cardCode)?.triggers;
  return type(card) === 'asset' && !!triggers?.turn_begins && !triggers.discard_phase_ends;
};

/**
 * Credits a money operation gains, read from its text (step 6: no hand-kept
 * list, so new sets are covered): "Gain N credits" as the card's own effect,
 * not as one option of a choice ("* Gain 3 credits").
 */
export function moneyOpGain(code: string): number | undefined {
  const def = getCardDefinition(code);
  if (def.type_code !== 'operation') return undefined;
  return printedGain(def.stripped_text);
}
/** "Dividends N": agenda counters per advancement counter beyond the requirement (0: none). */
const dividends = (card: CardInstance) => Number(/dividends (\d+)/i.exec(cardDef(card).stripped_text ?? '')?.[1] ?? 0);

export interface HeuristicOptions {
  /** Deck-aware nudges and opponent reading (synergy.ts). Off: the AI as it was before them. */
  synergy?: boolean;
  /** Log each move's synergy reasons to the console. */
  debug?: boolean;
  /** The whole-turn planner while plan.turnPlanner is on (default on; the Hard AI's search turns it off). */
  planner?: boolean;
}

/**
 * Rule-based Corp: builds money, ices its centrals, sets up a remote with
 * ice to score agendas from, and rezzes ice when the Runner comes in.
 */
export class HeuristicCorpAI implements Agent {
  readonly side = 'corp' as const;
  /** Has this Corp made its once-a-game reverse bluff? */
  private reverseBluffed = false;
  private freeActions = new FreeActionGuard(['END_TURN', 'START_TURN']);
  readonly synergy: boolean;
  private debug: boolean;
  private planner: boolean;
  private planMemory: PlanMemory = { line: [] };

  constructor(options: HeuristicOptions = {}) {
    this.synergy = options.synergy ?? true;
    this.debug = options.debug ?? false;
    this.planner = options.planner ?? true;
  }

  /** Round 3: keep rez money for R&D and HQ as well as agenda remotes. */
  private get wideReserve() {
    return this.synergy && tuning.plan.rezMoney;
  }

  private get timing() {
    return this.synergy && tuning.plan.agendaTiming;
  }

  /** plan.oneCurrency: every main-phase action ranked by the evaluate delta (oneCurrencyScore). */
  private get oneCurrency() {
    return this.synergy && tuning.plan.oneCurrency;
  }

  chooseAction(state: GameState): GameAction {
    return asSide('corp', () => this.decide(state));
  }

  private decide(state: GameState): GameAction {
    noteKnownHand(state, 'corp');
    if (activePrompt(state)) return answerPrompt(state, 'corp', undefined, this.synergy);
    const legal = getLegalActions(state, 'corp');
    const ranked = this.rankMainActions(state, legal);
    const planned = this.planner && plannerOn('corp') && state.turnStep?.kind !== 'corp_turn_start' ? this.plan(state, ranked) : null;
    let chosen = planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0]);
    // plan.pettyCashFirst: a click for a credit while Petty Cash can still be played is a click for 2 thrown away (the
    // planner valued Petty Cash held in HQ as the money it will make, though it is playable only as the turn's first action)
    if (chosen.type === 'GAIN_CREDIT' && this.synergy && tuning.plan.pettyCashFirst && !this.oneCurrency) chosen = ranked.find(r => isPettyCash(state, r.action) && r.score > -Infinity)?.action ?? chosen;
    // plan.tagFirst: the planner's leaf counts a tag kept as a trash still to come, but the Runner clears it on its turn
    if (this.synergy && tuning.plan.tagFirst && !this.oneCurrency && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst) chosen = ranked[0].action;
    // The reverse bluff: at most once a game
    if (chosen.type === 'INSTALL_CARD' && chosen.asNewRemote && state.corp.hq.some(c => c.instanceId === chosen.cardInstanceId && type(c) === 'agenda')) {
      const def = cardDef(state.corp.hq.find(c => c.instanceId === chosen.cardInstanceId)!);
      if ((def.advancement_cost ?? 0) > state.corp.clicks - 1) this.reverseBluffed = true;
    }
    this.notePlayed(chosen);
    if (this.debug) logNudge(state, 'corp', chosen);
    return chosen;
  }

  /** Counts actions in a row that spent no click (loop guard). */
  notePlayed(action: GameAction) {
    this.freeActions.played(action);
  }

  /** The whole-turn planner's pick (plan.turnPlanner), its playouts by a fresh copy of this AI. */
  private plan(state: GameState, ranked: ScoredAction[]): GameAction | null {
    const rollout = new HeuristicCorpAI({ synergy: this.synergy, planner: false });
    const reply = tuning.plan.runnerReply ? (s: GameState, leaf: (s: GameState) => number) => runnerReply(s, this.synergy, leaf) : undefined;
    return planTurn(state, 'corp', ranked, { rank: s => rollout.rankMainActions(s), answer: s => rollout.chooseAction(s), reply, memory: this.planMemory }, this.synergy);
  }

  /** Main-phase actions, best first, with this AI's score for each (the search AI starts from these). */
  rankMainActions(state: GameState, legal = getLegalActions(state, 'corp')): ScoredAction[] {
    noteKnownHand(state, 'corp');
    this.freeActions.start(state, state.corp.clicks);
    const before = evaluate(state, 'corp', this.synergy);
    const iceTrash = this.synergy && tuning.plan.iceTrash;
    const ranked = [...legal, ...(iceTrash ? iceTrashInstalls(state) : [])]
      .map(original => {
        // plan.oneCurrency: the action as the engine plays it (an ice install's trashFirst included), by its evaluate delta
        if (this.oneCurrency) return { action: original, score: this.oneCurrencyScore(state, original, before) };
        if (original.type === 'INSTALL_CARD' && original.trashFirst?.length) {
          // Score the plain install with the credits it saves, less what the trashed ice was worth
          const trashed = original.trashFirst;
          const richer = { ...state, corp: { ...state.corp, credits: state.corp.credits + trashed.length } };
          let score = this.score(richer, { ...original, trashFirst: undefined }, before) - trashed.reduce((sum, id) => sum + trashLoss(state, id), 0);
          if (this.synergy && Number.isFinite(score) && score < 40) score += nudge(state, 'corp', original).bonus;
          return { action: original, score };
        }
        const action = iceTrash ? original : withDeadIceTrashed(state, original);
        let score = this.score(state, original, before);
        // Trashing ice first takes it off the install cost
        if (action !== original && Number.isFinite(score)) score += 0.8 * (action as { trashFirst: string[] }).trashFirst.length;
        // Deck-aware nudge: small, and only for moves the AI would consider anyway
        if (this.synergy && Number.isFinite(score) && score < 40 && action.type !== 'END_TURN' && action.type !== 'START_TURN') score += nudge(state, 'corp', action).bonus;
        return { action, score };
      })
      .sort((a, b) => b.score - a.score);
    if (this.oneCurrency) return finishFirst(state, ranked);
    const first = this.synergy && tuning.plan.pettyCashFirst ? pettyCashFirst(state, ranked) : ranked;
    return this.synergy && tuning.plan.tagFirst ? tagFirst(state, first) : first;
  }

  chooseRez(state: GameState, cards: CardInstance[]): GameAction | null {
    return asSide('corp', () => this.decideRez(state, cards));
  }

  private decideRez(state: GameState, cards: CardInstance[]): GameAction | null {
    const run = state.activeRun;
    if (!run) return null;
    const server = state.corp.servers[run.server];
    const importance = serverImportance(state, server, this.synergy && tuning.plan.agendaStakes);
    let best: { card: CardInstance; score: number } | null = null;
    for (const card of cards) {
      const def = cardDef(card);
      const cost = rezCost(state, card);
      if (!isLegalAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId })) continue;
      let score: number;
      if (def.type_code === 'ice' && this.synergy && tuning.plan.modelRez) {
        // plan.modelRez: the rez priced by the value model (rezModel.ts), in credits; rezzed when it gains anything.
        // Lifted onto the old scale's threshold (2) so an upgrade in the same window still compares on its own terms
        const gain = modelRezGain(state, card, this.synergy);
        if (!(gain > 0)) continue;
        score = 2 + gain;
      } else if (def.type_code === 'ice') {
        // Ping tags the Runner when rezzed during a run; ice that ends the run protects best
        const onRez = ECON_SCALE * rezEffectWorth(card, tagCost(state));
        score = importance + (hasEndTheRun(card) ? 1 : 0) + onRez;
        if (state.corp.credits - cost < 2 && importance < 4) score -= 2;
        // (Jeff) money kept to rez an agenda remote's ice isn't spent on ice elsewhere
        if (this.synergy && tuning.plan.agendaMoney && state.corp.credits - cost < agendaRemoteNeed(state, server.id)) score -= 3;
        // plan.rezToll (Jeff, 2026-11-05: the Corp's money goes on ice rezzed in runs): ice the Runner can pay its way
        // through doesn't stop the run, it only takes a toll. Outside a server holding an agenda, paying more to rez it
        // than twice the toll (this run's and about one more) loses money: 27% of the Corp's in-run rez money went there
        if (this.synergy && tuning.plan.rezToll && importance < 7) {
          const rezzed = { ...card, isRezzed: true };
          const need = iceCreditNeed(state, rezzed);
          if (need > 0 && need < BLOCK && need <= state.runner.credits && 2 * iceCost(state, rezzed) < cost) continue;
        }
      } else if (def.type_code === 'upgrade') {
        // Upgrades: by what they do here (model), up to the 2 an upgrade gives up against ice;
        // one that does nothing in a run waits for the Corp's turn, keeping the money for ice
        const [remote, central] = upgradeValue(card.cardCode, state);
        score = !runTimed(card) ? -1 : importance - 2 + Math.min(2, Math.max(0, server.isRemote ? remote : central));
      } else if (tuning.plan.spinDoctorWait && onRezOnly(card)) {
        score = 3; // Spin Doctor (Jeff): the Runner came anyway, so the same 2 cards cost it a run
      } else {
        score = -1; // assets are rezzed on the Corp's own turn
      }
      if (score >= 2 && (!best || score > best.score)) best = { card, score };
    }
    if (best) return { type: 'REZ_CARD', player: 'corp', cardInstanceId: best.card.instanceId };
    return run.phase === 'approach_server' ? this.runStopper(state, importance) : null;
  }

  /** LEO Construction or Proprionegation, when the Runner is about to get into something that matters. */
  private runStopper(state: GameState, importance: number): GameAction | null {
    // (Jeff) LEO: worth it when the run would take more than the bioroid it trashes (plan.leoValue)
    const leo = getLegalActions(state, 'corp').find(a => a.type === 'USE_ABILITY' && findCardAnywhere(state, a.cardInstanceId)?.cardCode === '35035');
    if (leo && tuning.plan.leoValue) return this.leoGain(state, leo) > 0 ? leo : null;
    if (importance < 6) return null;
    const archivesAgenda = state.corp.archives.faceDown.some(c => type(c) === 'agenda');
    for (const action of getLegalActions(state, 'corp')) {
      if (action.type !== 'USE_ABILITY') continue;
      const code = findCardAnywhere(state, action.cardInstanceId)?.cardCode;
      if (code === '35035') return action; // LEO: trash a bioroid, end the run
      if (code === '35048' && !archivesAgenda && state.activeRun?.server !== 'archives') return action; // Proprionegation
      if (code === '36045') return action; // The Red Room: a power counter, end the run
      if (code === '36035' && perfectRecallTarget(state)) return action; // Perfect Recall: protect the agenda the Runner is after
    }
    // Event Horizon: trash it to end the run, only for a run that would take an agenda
    if (importance >= 7) {
      const horizon = getLegalActions(state, 'corp').find(a => a.type === 'USE_ABILITY' && findCardAnywhere(state, a.cardInstanceId)?.cardCode === '36058');
      if (horizon) return horizon;
    }
    return null;
  }

  /**
   * LEO against letting the Runner in: the board after trashing the bioroid the AI would pick and
   * ending the run, against the board after the run takes what it would (agendas in the root
   * stolen; HQ and R&D by the odds, runLoss).
   */
  private leoGain(state: GameState, action: GameAction): number {
    let after = simulate(state, action);
    for (let i = 0; after && i < 3 && activePrompt(after)?.side === 'corp'; i++) after = simulate(after, answerPrompt(after, 'corp', undefined, this.synergy));
    if (!after) return -Infinity;
    // Out of clicks, the Runner can't come back this turn: the Corp moves next (protects or scores the agenda)
    const next = (st: GameState): GameState => (st.runner.clicks > 0 ? st : { ...st, activePlayer: 'corp' });
    const server = state.corp.servers[state.activeRun!.server];
    const agendas = server.root.filter(c => type(c) === 'agenda');
    let letIn: number;
    if (agendas.length > 0) {
      const stolen = structuredClone(state);
      const root = stolen.corp.servers[server.id].root;
      for (const a of agendas) {
        const i = root.findIndex(c => c.instanceId === a.instanceId);
        stolen.runner.scoreArea.push(...root.splice(i, 1));
        stolen.runner.score += cardDef(a).agenda_points ?? 0;
      }
      stolen.activeRun = null;
      letIn = evaluate(next(stolen), 'corp', this.synergy);
    } else letIn = evaluate(state, 'corp', this.synergy) - runLoss(state);
    return evaluate(next(after), 'corp', this.synergy) - letIn;
  }

  /**
   * plan.oneCurrency (structural review item 1, spec "Item 1 spec"): every Corp main-phase action on one scale, the
   * change in evaluate(state, 'corp') in credits once the action and its own prompts resolve (playScore). No install
   * points, tiers or reserve penalties: what those covered by hand is now the value model's (agendaWorth with the
   * server's steal odds, iceWorth only while the Corp can afford the rez, the credit slide against the board's rez need,
   * centralExposure, advanced assets, an agenda this turn can finish priced as scored). What stays are timing rules,
   * which say when, not how much: rez windows (rezTimingBlocked, rules 5.6.1b-d, 5.6.2a), ice rezzed only in runs (the
   * turn's windows rez non-ice cards, 5.6.1b; ice is rezzed as it is approached, 6.9.2b), the free-action loop guard,
   * terminal operations last, and BANGUN's faceup choice (an identity plan).
   */
  private oneCurrencyScore(state: GameState, action: GameAction, before: number): number {
    const corp = state.corp;
    switch (action.type) {
      case 'END_TURN':
      case 'START_TURN':
        return -0.5;
      case 'SCORE_AGENDA':
        // Scoring costs no click and is no action (rule 1.17.3c), in every scoring window of the turn (5.6.2a), and need
        // not be done at once (1.17.3b): taken when legal, except while a Dividends advance or a tag would make it worth
        // more first, when it is scored by its delta (about 0: evaluate prices the finished agenda as scored already)
        if (this.overAdvance(state, action.cardInstanceId) || this.tagFirst(state, action.cardInstanceId)) return this.playScore(state, action, before, true);
        return 100;
      case 'INSTALL_CARD': {
        if (!corp.hq.some(c => c.instanceId === action.cardInstanceId)) return -Infinity;
        if (action.faceUp && !tuning.plan.bangunFaceUp) return -Infinity;
        const server = action.asNewRemote ? null : corp.servers[action.targetServerId ?? ''] ?? null;
        if (action.faceUp && tuning.plan.bangunNoBareBait && !(server?.ice.length) && state.runner.grip.length > 2 && !(tuning.plan.bangunEarlyBait && state.runner.score <= 2)) return -Infinity;
        const faceUp = action.faceUp ? (tuning.plan.identities ? -this.bangunBait(state) : 0.5) : 0;
        return this.playScore(state, action, before) - faceUp;
      }
      case 'REZ_CARD': {
        if (state.activeRun) return -Infinity;
        const card = Object.values(corp.servers).flatMap(s => s.root).find(c => c.instanceId === action.cardInstanceId);
        if (!card) return -Infinity; // ice waits for a run (decideRez)
        if (this.rezTimingBlocked(state, card)) return -Infinity;
        // Agendas can't be rezzed (rule 3.2.3), traps spring on access, run-timed cards wait for the run's window
        if (type(card) === 'agenda' || isTrap(card.cardCode) || runTimed(card)) return -Infinity;
        if (tuning.plan.rezToUse && clickOnly(card)) return this.rezToUse(state, card, before);
        if (state.turnStep?.kind === 'corp_turn_start' && type(card) === 'asset' && getCardScript(card.cardCode)?.triggers?.turn_begins) return this.preTurnRez(state, action);
        return this.playScore(state, action, before);
      }
      case 'TRASH_RESOURCE':
        return this.trashScore(state, action, before);
      case 'DRAW_CARD': {
        // The drawn card is one the Corp hasn't seen, so evaluate prices it at the deck's average (no peeking: the
        // look-ahead draw is pooled with R&D). What it may be is digValue's: the odds it is the missing ice or money,
        // one card past the hand size when HQ is all duds (plan.digPastLimit; rules 4.3.6, 5.5.3: discard at the end of the turn)
        const room = corp.handSizeLimit + (tuning.plan.digPastLimit ? 1 : 0);
        const dig = tuning.plan.dig?.corp && corp.hq.length < room ? digValue(state, 'corp') : 0;
        return this.playScore(state, action, before) + dig;
      }
    }
    return this.playScore(state, action, before);
  }

  private score(state: GameState, action: GameAction, before: number): number {
    const corp = state.corp;
    switch (action.type) {
      case 'END_TURN':
        return -0.5;
      case 'TRASH_RESOURCE':
        return this.trashScore(state, action, before);
      case 'START_TURN':
        // After rezzing what is worth it, so "when your turn begins" cards fire this turn
        return -0.5;
      case 'SCORE_AGENDA':
        // Dividends: put spare clicks into the agenda first (scoring stays possible all turn)
        if (this.synergy && this.overAdvance(state, action.cardInstanceId)) return 5;
        // Orbital Superiority and the like: tag the Runner first if we can this turn
        if (this.synergy && tuning.plan.scoreSetup && this.tagFirst(state, action.cardInstanceId)) return 5;
        return 100;
      case 'PURGE_VIRUS': {
        const viruses = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].reduce(
          (n, c) => n + counters(c, 'virus'),
          0
        );
        // Deck-aware AI: weigh each counter by what it does, against the 3 clicks a purge costs
        if (this.synergy && tuning.plan.purgeValue) return virusThreat(state) - 5;
        // Against a virus deck, purge a little sooner
        return viruses - 3.5 + (this.synergy && tuning.purge ? opponentLean(state, 'corp', 'virus') : 0);
      }
      case 'ADVANCE_CARD': {
        const score = this.advanceScore(state, action.cardInstanceId, action.serverId);
        return score >= 40 ? score : score - reservePenalty(state, corp.credits - 1, this.wideReserve);
      }
      case 'INSTALL_CARD': {
        const card = corp.hq.find(c => c.instanceId === action.cardInstanceId);
        if (!card) return -Infinity;
        const server = action.asNewRemote ? null : corp.servers[action.targetServerId ?? ''] ?? null;
        // BANGUN's faceup agendas hurt the Runner but tell them what is there
        const installCost = type(card) === 'ice' && server ? server.ice.length : 0;
        if (action.faceUp && !tuning.plan.bangunFaceUp) return -Infinity;
        // (Jeff) a faceup agenda with no ice is stolen 98% of the time: only as a flatline threat (plan.bangunNoBareBait)
        // (Jeff) early on, 2 points cost less than 2 cards and a tag: the bait stays while the Runner has 2 points or fewer (plan.bangunEarlyBait)
        if (action.faceUp && tuning.plan.bangunNoBareBait && !(server?.ice.length) && state.runner.grip.length > 2 && !(tuning.plan.bangunEarlyBait && state.runner.score <= 2)) return -Infinity;
        const faceUp = action.faceUp ? (this.synergy && tuning.plan.identities ? -this.bangunBait(state) : 0.5) : 0;
        return this.installScore(state, card, server) - faceUp - reservePenalty(state, corp.credits - installCost, this.wideReserve);
      }
      case 'REZ_CARD': {
        if (state.activeRun) return -Infinity;
        const card = Object.values(corp.servers).flatMap(s => s.root).find(c => c.instanceId === action.cardInstanceId);
        if (!card) return -Infinity; // ice waits for a run
        const value = this.rezValue(state, card);
        // Deck-aware AI: rezzing assets spends the same money as rezzing ice
        return Number.isFinite(value) && this.wideReserve ? value - reservePenalty(state, corp.credits - rezCost(state, card), true) : value;
      }
    }
    return this.playScore(state, action, before);
  }

  private trashScore(state: GameState, action: GameAction & { type: 'TRASH_RESOURCE' }, before: number): number {
    const score = this.playScore(state, action, before);
    const resource = state.runner.rig.resources.find(c => c.instanceId === action.cardInstanceId);
    const k = resource ? resourceTrashHqCost(state, resource) : 0;
    if (!this.synergy || !tuning.plan.hqTrashCost || k === 0 || !resource || !Number.isFinite(score)) return score;
    // plan.hqTrashCost: the board score took the HQ cards off at the flat worth of a card in hand;
    // they are the Corp's least useful cards (Sebastião Souza Pessoa, Manuel Lattes de Moura)
    const size = state.corp.hq.length;
    const flat = handValue(size, state.corp.handSizeLimit, 'corp') - handValue(size - k, state.corp.handSizeLimit, 'corp');
    return score + flat - hqTrashCardsLoss(state, resource);
  }

  /**
   * Deck-aware AI (Jeff): an upgrade in a remote with no agenda can be set up
   * in advance, but rezzing it must not eat the money kept for rezzing ice.
   */
  private idleUpgrade(state: GameState, card: CardInstance): boolean {
    if (!this.synergy || !tuning.plan.idleUpgrades) return false;
    const server = Object.values(state.corp.servers).find(s => s.root.some(c => c.instanceId === card.instanceId));
    if (!server?.isRemote || server.root.some(c => type(c) === 'agenda')) return false;
    return state.corp.credits - rezCost(state, card) < rezReserve(state, this.wideReserve);
  }

  /** Rezzing a click-only asset (plan.rezToUse): worth it only when its ability is then this AI's next play. */
  private rezToUse(state: GameState, card: CardInstance, before?: number): number {
    if (state.turnStep?.kind === 'corp_turn_start' || (rezzingToUse.has(card.instanceId) || (!this.oneCurrency && rezzingToUse.size > 0))) return -Infinity;
    const after = simulate(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId });
    if (!after) return -Infinity;
    rezzingToUse.add(card.instanceId);
    try {
      const best = new HeuristicCorpAI({ synergy: this.synergy, planner: false }).rankMainActions(after)[0];
      if (!best || best.action.type !== 'USE_ABILITY' || best.action.cardInstanceId !== card.instanceId) return -Infinity;
      // plan.oneCurrency: the rez and the use it leads to, as one delta from before the rez
      if (before !== undefined) return evaluate(after, 'corp', this.synergy) - before + best.score;
      return best.score;
    } finally {
      rezzingToUse.delete(card.instanceId);
    }
  }

  /** Worth of rezzing a card in a server's root on the Corp's own turn. */
  private rezValue(state: GameState, card: CardInstance): number {
    if (this.rezTimingBlocked(state, card)) return -Infinity;
    // (Jeff, 2026-10-31: "it rezzes Humanoid Resources but never seems to use it"; plan.rezToUse) not before the turn
    // begins either, and in the action phase only when using it would then be the best play: rezzed and left, it is
    // just a credit spent and a trash target
    if (tuning.plan.rezToUse && clickOnly(card)) return this.rezToUse(state, card);
    const econ = econValue(card.cardCode, state);
    if (econ) return econ + 1;
    // Model: worth once rezzed, less the rez cost, on the install-score scale; upgrades still wait for ice money (Jeff)
    if (type(card) === 'upgrade' && this.idleUpgrade(state, card)) return -Infinity;
    if (type(card) === 'agenda' || isTrap(card.cardCode)) return -Infinity;
    // Manegarm and the like are rezzed when the Runner comes (decideRez), not on the Corp's turn
    if (runTimed(card)) return -Infinity;
    const worth = rezzedWorth(state, card, rezCost(state, card));
    return worth > 0 ? ECON_SCALE * worth : -Infinity;
  }

  /** Rez windows for a card in a server's root on the Corp's own turn: true while now is not its time (timing, not worth). */
  /**
   * plan.oneCurrency: a rez in the window before the turn begins (rule 5.6.1b), priced past the turn's start (5.6.1c:
   * "when your turn begins" abilities, Anthill Excavation Contract's 4 credits and a card) against beginning the turn
   * without it. Priced on the window's own position, a turn-start asset rezzed there was worth what it would be rezzed
   * later less the rez, about 0, and the Corp never rezzed before its turn as players do (human games: 13 decisions).
   * Only for assets with a "when your turn begins" ability (The Holo Man's turn-start move keeps the action-phase price).
   */
  private preTurnRez(state: GameState, action: GameAction): number {
    const begin = (s: GameState | null) => {
      let t = s && simulate(s, { type: 'START_TURN', player: 'corp' });
      for (let i = 0; t && i < 3 && activePrompt(t)?.side === 'corp'; i++) t = simulate(t, answerPrompt(t, 'corp', undefined, this.synergy));
      return t && !activePrompt(t) ? t : null;
    };
    const rezzed = begin(simulate(state, action));
    const plain = begin(state);
    if (!rezzed || !plain) return -Infinity;
    const score = evaluate(rezzed, 'corp', this.synergy) - evaluate(plain, 'corp', this.synergy);
    return score <= FREE_ACTION_FLOOR ? -Infinity : score;
  }

  private rezTimingBlocked(state: GameState, card: CardInstance): boolean {
    const corp = state.corp;
    // A money asset that pays when the Corp's turn begins is rezzed in the window just before then
    // (rules 5.6.1b-d): it pays at once, and the Runner gets no turn to trash it full (plan.assetRezTiming)
    if (tuning.plan.assetRezTiming && CARD_PROFILES[card.cardCode]?.every === 'turn' && state.turnStep?.kind !== 'corp_turn_start') return true;
    // The same for any asset whose payoff is "when your turn begins" (plan.turnStartRez): rezzed earlier it pays no
    // sooner, shows the Runner what it is, gives it a turn to trash it and spends credits the Corp's ice may need
    if (tuning.plan.turnStartRez && turnStartOnly(card) && state.turnStep?.kind !== 'corp_turn_start') return true;
    // (Jeff) Spin Doctor: left unrezzed it may draw a run, and is rezzed then for the same draw; or just before the
    // turn begins. Rezzed in the action phase only when the cards are needed now (digging, or an empty hand);
    if (tuning.plan.spinDoctorWait && onRezOnly(card) && state.turnStep?.kind !== 'corp_turn_start' && corp.hq.length > 1 && digValue(state, 'corp') <= 0) return true;
    // (Jeff's bug report, 2026-10-31; plan.rezWhenUsed) An asset that only pays through a click ability (Humanoid Resources)
    // is rezzed in the paid ability window just before the action that uses it (rule 5.6.2a): rezzed with fewer clicks
    // left it does nothing yet, and spends the money a broke Corp needs for Petty Cash or its ice
    if (tuning.plan.rezWhenUsed && clickOnly(card) && corp.clicks < clickOnly(card)) return true;
    // plan.clickMoneyRez (Jeff, 2026-11-04: Regolith rezzed with no clicks left, then trashed before it paid): money
    // taken with a click is rezzed when a click is left to take it, or in the window just before the turn begins
    if (tuning.plan.clickMoneyRez && CARD_PROFILES[card.cardCode]?.every === 'click' && corp.clicks < 1 && state.turnStep?.kind !== 'corp_turn_start') return true;
    return false;
  }

  /** Operations and other plays, scored by the position they lead to. */
  private playScore(state: GameState, action: GameAction, before: number, unfiltered = false): number {
    const corp = state.corp;
    const one = this.oneCurrency;
    if (action.type === 'PLAY_OPERATION_OR_EVENT' && !one) {
      const code = corp.hq.find(c => c.instanceId === action.cardInstanceId)?.cardCode;
      // The tag that sets up a waiting Orbital Superiority
      if (this.synergy && tuning.plan.scoreSetup && code && this.tagsBeforeScore(state, code) && simulate(state, action)) return 6;
      const bonus = code ? this.operationBonus(state, code) : 0;
      if (bonus !== 0) {
        const after = simulate(state, action);
        return after ? bonus : -Infinity;
      }
    }
    const after = simulate(state, action);
    if (!after) return -Infinity;
    // plan.oneCurrency: an action is a click action by its type (rule 5.2.6: operations, installs, advances and the basic
    // actions each cost a click) even when it gives clicks back (Nanomanagement nets +1 and is no free action)
    const spendsClick = after.corp.clicks < corp.clicks || (one && CLICK_ACTIONS.has(action.type));
    if (!spendsClick && this.freeActions.exhausted) return -Infinity;
    // Follow our own prompts (Predictive Planogram, Seamless Launch) a few steps.
    let resolved = after;
    for (let i = 0; i < 3 && activePrompt(resolved)?.side === 'corp'; i++) {
      const next = simulate(resolved, answerPrompt(resolved, 'corp', undefined, this.synergy));
      if (!next) break;
      resolved = next;
    }
    let score = evaluate(resolved, 'corp', this.synergy) - before;
    // Terminal operations (Liberation) end the action phase: the clicks left are lost, so play them last
    if (action.type === 'PLAY_OPERATION_OR_EVENT') {
      const played = corp.hq.find(c => c.instanceId === action.cardInstanceId);
      if (played && /terminal/i.test(cardDef(played).keywords ?? '')) score -= Math.max(0, corp.clicks - 1) * clickRate('corp');
    }
    // plan.oneCurrency: the delta alone (a free action still has to gain something, or the loop guard would spin)
    if (one) return !spendsClick && !unfiltered && score <= FREE_ACTION_FLOOR ? -Infinity : score;
    if (this.synergy) score += this.moneyPlan(state, action);
    // Myōshu: keep the 10 credits once saved, unless the spend scores (its card plan does this when plans are on)
    if (this.synergy && !plansOn() && myoshuSaving(state, true) && resolved.corp.credits < MYOSHU_COST && resolved.corp.score === corp.score) score -= 1;
    // Deck-aware AI: a play that makes an agenda scoreable this turn (Seamless Launch, Key Performance Indicators...)
    if (this.synergy && tuning.plan.scoreSetup && scoreable(resolved) > scoreable(state)) score = Math.max(score, 41);
    // plan.finishSetup (Jeff's Corp game 1, bug report #17: The Holo Man's 3 counters left Offworld Office one advance short,
    // and the reserve penalty on the 4 credits buried it): a play that lets this turn's clicks and credits finish an agenda
    // ranks with the advance that would, and the reserve isn't held against it
    if (this.synergy && tuning.plan.finishSetup && finishable(resolved) > finishable(state)) return Math.max(score, 40);
    if (!spendsClick && score <= 0.3) return -Infinity;
    score -= reservePenalty(state, resolved.corp.credits, this.wideReserve);
    return score;
  }

  /**
   * Money and digging the one-step evaluation misses (deck-aware AI):
   * clicks toward a money operation in HQ it can't afford yet, Petty Cash
   * while it can still be played (it comes back from Archives later), and
   * draws for a missing answer still in R&D (see digValue).
   */
  private moneyPlan(state: GameState, action: GameAction): number {
    const corp = state.corp;
    if (action.type === 'GAIN_CREDIT' && tuning.plan.saveForOps) {
      // Reachable: this turn with a click left to play it, or early next turn
      const reachable = corp.hq.some(c => {
        const gain = moneyOpGain(c.cardCode);
        const cost = cardDef(c).cost ?? 0;
        return gain !== undefined && cost > corp.credits && cost <= corp.credits + corp.clicks + 2;
      });
      return reachable || (!plansOn() && myoshuSaving(state)) ? 0.6 : 0;
    }
    // plan.castWhileAble (Jeff, 2026-11-04: the Corp goes broke holding Hedge Fund): a money operation the Corp can
    // afford now but not once it pays to rez its ice is played while it still can; stranded, it's a dead card until
    // clicks for credits climb back to its cost
    if (action.type === 'PLAY_OPERATION_OR_EVENT' && tuning.plan.castWhileAble) {
      const card = corp.hq.find(c => c.instanceId === action.cardInstanceId);
      const gain = card ? moneyOpGain(card.cardCode) : undefined;
      const cost = card ? cardDef(card).cost ?? 0 : 0;
      if (gain !== undefined && gain > cost && cost >= 3 && corp.credits >= cost && corp.credits - unrezzedIceCost(state) < cost) return CAST_WHILE_ABLE * (gain - cost);
    }
    if (action.type === 'PLAY_OPERATION_OR_EVENT' && tuning.plan.pettyCash) {
      return corp.hq.find(c => c.instanceId === action.cardInstanceId)?.cardCode === '35081' ? PETTY_CASH_REPLAY : 0;
    }
    // plan.digPastLimit (Jeff, 2026-10-31): a hand of duds digs one card past the limit, to discard the worst at the end of the turn (rules 4.3.6, 5.5.3)
    const digRoom = corp.handSizeLimit + (tuning.plan.digPastLimit ? 1 : 0);
    if (action.type === 'DRAW_CARD' && tuning.plan.dig?.corp && corp.hq.length < digRoom) return digValue(state, 'corp');
    return 0;
  }

  /**
   * Operations whose worth the one-step evaluation misses: extra clicks or
   * advancements that let an agenda be scored this turn. 0: no opinion.
   */
  private operationBonus(state: GameState, code: string): number {
    const corp = state.corp;
    const agendas = Object.values(corp.servers).flatMap(s => s.root).filter(c => type(c) === 'agenda');
    const need = (c: CardInstance) => (cardDef(c).advancement_cost ?? 0) - c.advancementCounters;
    switch (code) {
      case '35043': {
        // Nanomanagement (4 credits): +2 clicks, worth it if they finish an agenda
        const clicksAfter = corp.clicks - 1 + 2;
        const finishing = agendas.filter(a => need(a) > corp.clicks && need(a) <= clicksAfter && corp.credits - 4 >= need(a));
        // Model: the clicks are priced by the evaluation; what it misses is the score they lead to
        return Math.max(0, ...finishing.map(a => finishWorth(state, a)));
      }
      case '35067': {
        // Touch-ups (2 clicks, 2 credits): 2 advancements, best when they finish an agenda
        const clicksAfter = corp.clicks - 2;
        if (clicksAfter < 0 || corp.credits < 2) return -Infinity;
        const finishing = agendas.filter(a => need(a) <= 2 + Math.min(clicksAfter, corp.credits - 2) && need(a) > 0);
        return Math.max(0, ...finishing.map(a => finishWorth(state, a)));
      }
      case '35044': {
        // Top-Down Solutions: 2 cards and up to 2 installs for 1 click
        const installable = corp.hq.filter(c => ['ice', 'asset', 'upgrade', 'agenda'].includes(type(c))).length;
        if (!(corp.credits >= 3 && installable >= 1 && corp.hq.length <= corp.handSizeLimit)) return 0;
        return topDownWorth(installable, state);
      }
    }
    return 0;
  }

  private advanceScore(state: GameState, cardId: string, serverId: string): number {
    const corp = state.corp;
    const server = corp.servers[serverId];
    const card = server && [...server.root, ...server.ice].find(c => c.instanceId === cardId);
    if (!card) return -Infinity;
    const def = cardDef(card);
    if (def.type_code === 'agenda') {
      const need = (def.advancement_cost ?? 0) - card.advancementCounters;
      if (need <= 0) return this.synergy && this.overAdvance(state, card.instanceId) ? 6 + 1.5 * dividends(card) : -Infinity;
      if (need <= corp.clicks && need <= corp.credits) return 40 + card.advancementCounters;
      if (this.timing) {
        // Deck-aware AI: only if the rest of this turn leaves it scoreable next turn, behind ice we can still rez
        const spend = Math.min(corp.clicks, corp.credits) + this.untaianAdvance(state, 0);
        const locked = this.locked(state, server, corp.credits - spend);
        if (need - spend > (locked ? 6 : 3) || guards(state, server, corp.credits - spend) === 0 || (!this.exposureOk(state, server, corp.credits - spend) && !this.hqNoSafer(state, server, corp.credits - spend))) return -Infinity;
        return (locked ? 8 : 6) + card.advancementCounters; // and then finish the job: a half-advanced agenda is the Runner's best target
      }
      // Can't finish this turn: build counters only behind ice we can rez
      return guards(state, server, corp.credits - 1) > 0 ? 3 + 0.5 * card.advancementCounters : -Infinity;
    }
    if (def.type_code === 'asset') {
      // Traps: advancing makes them look like agendas (Urtica Cipher, Clearinghouse)
      // plan.clearinghouseLethal (Gemini audit, 2026-11-01): Clearinghouse's meat damage is its counters, so it keeps going
      // toward a flatline (one more than the grip, at most 6) instead of stopping at 3
      const cap = tuning.plan.clearinghouseLethal && card.cardCode === CLEARINGHOUSE ? Math.min(6, Math.max(3, state.runner.grip.length + 1)) : 3;
      if (!(corp.credits >= 4 && card.advancementCounters < cap)) return -Infinity;
      return this.synergy && tuning.bluff && isTrap(card.cardCode) ? 1.2 + this.trapBluff(state, card) : 1.2;
    }
    // Pharos: +5 strength at 3 counters; Syailendra: places counters when encountered at 3
    if (card.cardCode === '35076' || card.cardCode === '30063') {
      const at = (n: number) => Math.min(iceStop(state), iceCost(state, { ...card, isRezzed: true, advancementCounters: n }));
      const worth = iceAdvanceWorth(state, card, at);
      return worth > 0 ? ECON_SCALE * worth : -Infinity;
    }
    return -Infinity;
  }

  /**
   * Extra reason to advance a trap: an Urtica Cipher that would flatline
   * the Runner's current hand, or (once the Runner has seen this Corp's
   * traps) a bare trap that would otherwise read as an obvious bluff.
   */
  private trapBluff(state: GameState, card: CardInstance): number {
    if (card.cardCode === '30045' && 2 + card.advancementCounters + 1 >= state.runner.grip.length) {
      // Model: the counter that makes it lethal, at the chance it's accessed
      return ECON_SCALE * placedCounterWorth(state, card, false);
    }
    const shown = state.corp.archives.faceUp.some(c => isTrap(c.cardCode));
    return shown && card.advancementCounters === 0 ? 0.6 : 0;
  }

  /**
   * An agenda left installed over the Runner's turn needs a server they
   * can't simply walk into: 2 real layers of ice, or ice that costs at least
   * 2 more than the Runner has. (Judging by cost alone, Jeff's 2026-10-29
   * plan.exposureByCost, lost its batches and was deleted 2026-11-06.)
   */
  private exposureOk(state: GameState, server: ServerState, credits: number): boolean {
    if (!(this.synergy && tuning.plan.exposure)) return true;
    // (Jeff) unrezzed ice only protects if the money to rez it is still there on the Runner's turn
    if ((tuning.plan.fundedDepth ? fundedDepth(state, server, credits) : iceDepth(state, server)) >= 2) return true;
    return entryCost(state, server, credits) >= state.runner.credits + 2;
  }

  /**
   * plan.hqNoSafer (bug report #15): an agenda waiting in HQ for a safer remote is no safer there when the Runner got into
   * HQ last turn and HQ costs them no more to enter than this remote (Corp `credits` left to rez).
   */
  private hqNoSafer(state: GameState, server: ServerState, credits: number): boolean {
    if (!(this.synergy && tuning.plan.hqNoSafer)) return false;
    if (!state.runnerLastTurnRuns.some(r => r.server === 'hq' && r.successful)) return false;
    return entryCost(state, server, credits) >= entryCost(state, state.corp.servers.hq, credits);
  }

  /**
   * Tempo (Jeff): a server the Runner can't get into for now (ice they
   * can't break, or far more than they can pay), so the Corp should push
   * agendas through it before the Runner finds the answer.
   */
  private locked(state: GameState, server: ServerState, credits: number): boolean {
    if (!(this.synergy && tuning.plan.tempo) || !server.isRemote) return false;
    return entryCost(state, server, credits) >= state.runner.credits + 5;
  }

  /** PT Untaian's paid advancement at the end of this turn (1), if HQ will be small enough; `leaving` cards are about to leave HQ. */
  private untaianAdvance(state: GameState, leaving: number): number {
    const corp = state.corp;
    return this.synergy && tuning.plan.identities && corp.identity.cardCode === '35047' && corp.hq.length - leaving <= 3 && corp.credits >= 2 ? 1 : 0;
  }

  /**
   * BANGUN: a faceup agenda tells the Runner what it is, but accessing it
   * does 2 meat damage and gives a tag. Worth it when that would flatline
   * the Runner (a guard on the agenda), or when the Corp holds cards that
   * punish tags; otherwise a small cost, as before.
   */
  private bangunBait(state: GameState): number {
    if (state.runner.grip.length < 2) return 1.5;
    const corp = state.corp;
    const cards = [...corp.hq, ...corp.scoreArea, ...Object.values(corp.servers).flatMap(s => s.root)];
    const punishers = cards.filter(c => (cardSynergy(cardDef(c)).when ?? []).includes('ifTagged')).length;
    return punishers > 0 ? 0.4 + 0.4 * Math.min(punishers, 2) : -0.5;
  }

  /** An agenda that is better scored with the Runner tagged, while an operation in HQ could tag them this turn. */
  private tagFirst(state: GameState, agendaId: string): boolean {
    const agenda = Object.values(state.corp.servers).flatMap(s => s.root).find(c => c.instanceId === agendaId);
    if (!agenda || state.runner.tags > 0 || state.corp.clicks < 1) return false;
    const when = cardSynergy(cardDef(agenda)).when ?? [];
    if (!when.includes('ifTagged') || !when.includes('onScore')) return false;
    return state.corp.hq.some(c => this.tagsBeforeScore(state, c.cardCode, agenda));
  }

  /** Is this operation a tag we could play now to set up such an agenda? */
  private tagsBeforeScore(state: GameState, code: string, agenda?: CardInstance): boolean {
    const def = getCardDefinition(code);
    if (def.type_code !== 'operation' || !(cardSynergy(def).gives?.tags ?? 0) || state.runner.tags > 0) return false;
    const card = state.corp.hq.find(c => c.cardCode === code);
    if (!card || !isLegalAction(state, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: card.instanceId })) return false;
    if (agenda) return true;
    // Only worth it with such an agenda ready to score
    return Object.values(state.corp.servers)
      .flatMap(s => s.root)
      .some(a => {
        const when = cardSynergy(cardDef(a)).when ?? [];
        return type(a) === 'agenda' && a.advancementCounters >= (cardDef(a).advancement_cost ?? 99) && when.includes('ifTagged') && when.includes('onScore');
      });
  }

  /**
   * The reverse bluff: once the Runner has seen this Corp's traps, now and
   * then put a real agenda in a remote with no ice, unadvanced, and score
   * it out next turn while the Runner reads it as another trap. Only
   * agendas that 3 clicks can finish, and one at a time.
   */
  private nakedAgenda(state: GameState, card: CardInstance): boolean {
    const corp = state.corp;
    const cost = cardDef(card).advancement_cost ?? 0;
    if (this.reverseBluffed || cost > 3 || corp.credits < cost + 1) return false;
    if (!corp.archives.faceUp.some(c => isTrap(c.cardCode))) return false;
    // A decklist-aware Runner calls it unless this Corp still has traps they haven't seen
    const hidden = [...corp.hq, ...corp.rd, ...corp.archives.faceDown, ...Object.values(corp.servers).flatMap(s => s.root.filter(c => !c.isRezzed))];
    if (!hidden.some(c => isTrap(c.cardCode))) return false;
    const remotes = Object.values(corp.servers).filter(s => s.isRemote);
    if (remotes.some(s => s.ice.length === 0 && s.root.some(c => type(c) === 'agenda'))) return false;
    // "Now and then": about one turn in three, but the same answer all turn
    let hash = state.turnNumber * 31;
    for (const ch of card.instanceId) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
    return hash % 3 === 0;
  }

  /**
   * A scoreable Dividends agenda the Corp can still advance this turn: each
   * extra counter becomes agenda counters when it is scored.
   */
  private overAdvance(state: GameState, cardId: string): boolean {
    const corp = state.corp;
    const card = Object.values(corp.servers).flatMap(s => s.root).find(c => c.instanceId === cardId);
    if (!tuning.dividends || !card || type(card) !== 'agenda' || dividends(card) === 0) return false;
    const excess = card.advancementCounters - (cardDef(card).advancement_cost ?? 0);
    return excess >= 0 && excess < 2 && corp.clicks >= 1 && corp.credits >= 1 + rezReserve(state);
  }

  private installScore(state: GameState, card: CardInstance, server: ServerState | null, free = false): number {
    const corp = state.corp;
    const hq = corp.hq;
    const remotes = Object.values(corp.servers).filter(s => s.isRemote);
    const agendasInHand = hq.filter(c => type(c) === 'agenda').length;
    const protectedEmptyRemote = remotes.some(s => s.ice.length > 0 && !s.root.some(isAgendaOrAsset));

    switch (type(card)) {
      case 'ice': {
        const installCost = server ? server.ice.length : 0;
        // Deck-aware AI: ice the Runner already breaks counts as half a layer
        const depth =
          server && this.synergy && tuning.plan.iceDepth ? iceDepth(state, server) : server?.ice.length ?? 0;
        // (Jeff) no ice the Corp can't afford to rez on top of the unrezzed ice already out, unless HQ must shrink to avoid a discard
        // (a free install, Synapse Global, costs no click or credit and only pays the affordIce penalty below)
        // plan.freeRez: a coming free rez (Send a Message, Unleash) pays for the costliest of them
        const freeTargets = freeRezTargets(state, card);
        const covered = freeRezCover(state, card);
        // plan.lethalHq: HQ holds an agenda whose steal wins the Runner the game, and the Runner can get in
        const lethalHq = server?.id === 'hq' && this.synergy && tuning.plan.lethalHq && lethalHqAgenda(state, corp.credits - installCost);
        const paceOk = lethalHq && corp.credits - installCost >= (cardDef(card).cost ?? 0);
        if (this.synergy && tuning.plan.icePacing && !paceOk && !free && unrezzedIceCost(state) + (cardDef(card).cost ?? 0) - covered > corp.credits - installCost + ICE_PACING_INCOME && hq.length <= corp.handSizeLimit) return -Infinity;
        let need: number;
        // Deck-aware AI: one well-iced scoring remote rather than ice spread thin
        const main = this.synergy && tuning.plan.oneRemote ? mainRemote(state) : null;
        if (!server) {
          need = agendasInHand > 0 && !protectedEmptyRemote ? 5 : -1;
          if (main && need > 0 && (iceDepth(state, main) < 2 || corp.credits < rezReserve(state, this.wideReserve) + (cardDef(card).cost ?? 0))) need = -1;
        }
        else if (server.isRemote) {
          const holdsAgenda = server.root.some(c => type(c) === 'agenda' || c.advancementCounters > 0);
          const holdsAsset = server.root.some(c => type(c) === 'asset');
          if (holdsAgenda) {
            need = depth < 2 ? 7 : 3;
            // Deck-aware AI: guard a key agenda (more points, or one that would win them the game) harder
            const agenda = server.root.find(c => type(c) === 'agenda');
            if (this.synergy && tuning.plan.agendaStakes && agenda) need *= 0.7 + 0.15 * agendaStakes(state, agenda);
          }
          else if (holdsAsset) {
            need = server.ice.length === 0 ? 1.5 : 0.2;
            // ...money assets get ice only once the Runner goes after them
            if (main && !server.root.some(c => isTrap(c.cardCode)) && !state.runnerLastTurnRuns.some(r => r.server === server.id)) need = Math.min(need, 0.2);
            // Deck-aware AI: one cheap ice sells a trap as an agenda
            const trap = server.root.some(c => !c.isRezzed && isTrap(c.cardCode));
            if (this.synergy && tuning.bluff && trap && server.ice.length === 0 && (cardDef(card).cost ?? 0) <= 3) need += 0.6;
          }
          else need = agendasInHand > 0 ? (depth < 2 ? 3 : 1) : 0.3;
          if (main && server !== main && !holdsAgenda && !holdsAsset) need = Math.min(need, 0.3);
        } else if (server.id === 'archives') {
          need = server.ice.length === 0 && corp.archives.faceDown.length > 0 ? 1.2 : -0.5;
        } else {
          need = (depth <= 1 ? 4 - 2 * depth : Math.max(0.6, 2 - 1.4 * (depth - 1))) + (server.id === 'rd' ? 0.3 : 0);
          if (this.synergy && tuning.plan.centralIce) {
            // Deck-aware AI: R&D always holds agendas; HQ only matters while it does
            if (server.id === 'rd') need += 0.4;
            // ...but HQ still gets its first ice once R&D has one
            else if (agendasInHand === 0) need -= server.ice.length === 0 ? (corp.servers.rd.ice.length > 0 ? 0 : 1.5) : 0.8;
            // ...and agendas waiting in HQ for a safe remote (exposure) want HQ iced deeper
            else if (tuning.plan.exposure && agendasInHand >= 2) need += Math.min(2, 0.8 * (agendasInHand - 1));
          }
          if (lethalHq) need += LETHAL_HQ_NEED;
          // (Jeff) a bare central gets its first ice before anything else; HQ ahead of R&D while it holds agendas
          if (this.synergy && tuning.plan.centralsFirst && server.ice.length === 0 && (server.id === 'rd' || agendasInHand > 0)) {
            need += 2 + (server.id === 'hq' ? 1 : 0);
          }
        }
        // Deck-aware AI: a server the Runner keeps getting into needs another layer
        if (server && this.synergy && tuning.plan.iceDepth) {
          const breaches = state.runnerLastTurnRuns.filter(r => r.server === server.id && r.successful).length;
          need += Math.min(1, 0.5 * breaches);
        }
        const rezCost = freeTargets.has(card.instanceId) ? 0 : cardDef(card).cost ?? 0;
        // (Jeff) ice whose strength depends on where it sits (Scatter Field) is judged where it would go
        const placed = this.synergy && tuning.plan.icePosition ? withIceInstalled(state, card, server) : state;
        const strength = placed === state ? cardDef(card).strength ?? 0 : iceStrength(placed, card);
        return (
          (placed === state ? 0 : ICE_POSITION_RATE * shiftedIceWorth(state, placed, server)) +
          need -
          0.8 * installCost +
          (hasEndTheRun(card) ? 1 : 0) +
          0.15 * Math.min(strength, 5) -
          (corp.credits - installCost < rezCost ? (this.synergy && tuning.plan.affordIce ? 3 : 1.5) : 0) -
          // Deck-aware AI: ice we can't rez is no protection; rez money for the ice already out comes first
          (this.synergy && tuning.plan.affordIce && corp.credits - installCost >= rezCost && corp.credits - installCost < rezCost + rezReserve(state, this.wideReserve) ? 1 : 0) +
          (this.synergy && tuning.plan.icePlacement ? iceFit(state, card, server, tuning.plan.agendaStakes) : 0) +
          (this.synergy && tuning.plan.stopperPlacement ? stopperPlacement(placed, card, server) : 0)
        );
      }
      case 'agenda': {
        const def = cardDef(card);
        const finishNow = (def.advancement_cost ?? 0) <= corp.clicks - 1 && (def.advancement_cost ?? 0) <= corp.credits;
        // A naked remote only to dodge a discard (or to score it straight away)
        if (!server) {
          if (finishNow) return 44;
          // Deck-aware AI (exposure): an overfull HQ goes behind ice rather than into a bare remote
          if (hq.length > corp.handSizeLimit) return this.synergy && tuning.plan.exposure ? 0.1 : 0.5;
          if (this.synergy && tuning.bluff && tuning.reverseBluff && this.nakedAgenda(state, card)) {
            // A rare treat: worth it early (a steal costs little yet) or with the Runner too poor or too low on cards to check
            const risky = state.turnNumber <= 6 && state.runner.score <= 2;
            const vulnerable = state.runner.credits <= 2 || state.runner.grip.length <= 2;
            return risky || vulnerable ? 4 : 0.5;
          }
          return -2;
        }
        if (server.root.some(isAgendaOrAsset)) return -Infinity;
        if (finishNow) return 45;
        if (this.timing) {
          // Deck-aware AI: install only if this turn's advances leave it scoreable next turn, behind ice we can still rez
          const spend = Math.min(corp.clicks - 1, corp.credits) + this.untaianAdvance(state, 1);
          const left = (def.advancement_cost ?? 0) - spend;
          const locked = this.locked(state, server, corp.credits - spend);
          if (locked) return 11 + Math.min(guards(state, server, corp.credits), 3) * 0.6; // push it through while they can't get in
          const exposed = !this.exposureOk(state, server, corp.credits - spend) && !this.hqNoSafer(state, server, corp.credits - spend);
          if (left > 3 || guards(state, server, corp.credits - spend) === 0 || exposed) return hq.length > corp.handSizeLimit ? (server.ice.length > 0 ? 0.6 : 0.5) : -2;
        }
        // Only behind ice that is rezzed or that we can afford to rez
        const guarded = guards(state, server, corp.credits);
        return guarded === 0 ? -2 : 8 + Math.min(guarded, 3) * 0.6;
      }
      case 'asset': {
        const econ = econValue(card.cardCode, state);
        if (econ !== undefined) {
          if (server) {
            // plan.readAssetTrash (bug report #16): against a Runner who trashes unprotected assets, an empty iced
            // remote that isn't the scoring remote keeps a money asset alive (priced at the iced risk)
            const iced = this.synergy && tuning.plan.readAssetTrash && server.isRemote && server.ice.length > 0 && server.root.length === 0 && server !== mainRemote(state);
            const worth = iced ? unrezzedWorth(state, card.cardCode, true) : undefined;
            if (worth === undefined || bareAssetRisk(state) <= PAYOUT_RISK.moneyBare) return -1;
            return ECON_SCALE * worth - (corp.credits < (cardDef(card).cost ?? 0) ? 1.5 : 0) - 0.5;
          }
          const rezCost = cardDef(card).cost ?? 0;
          // Deck-aware AI (one remote): every extra remote spreads the Corp thinner
          const spread = this.synergy && tuning.plan.oneRemote ? (remotes.length >= 4 ? 2 : remotes.length >= 3 ? 1 : 0) : remotes.length >= 4 ? 1 : 0;
          return econ - (corp.credits < rezCost ? 1.5 : 0) - spread;
        }
        // Traps and Clearinghouse: bluff in a new remote, or an empty protected one
        if (!server) return remotes.length >= 4 ? 0.2 : 1.2;
        if (server.root.some(isAgendaOrAsset)) return -Infinity;
        // Deck-aware AI: keep the scoring remote free for agendas
        if (this.synergy && tuning.plan.oneRemote && server === mainRemote(state)) return -Infinity;
        // Deck-aware AI: a trap behind ice looks like the real thing
        const sell = this.synergy && tuning.bluff && isTrap(card.cardCode) && server.ice.length > 0 ? 0.5 : 0;
        return (server.ice.length > 0 && agendasInHand === 0 ? 1.8 : 0.5) + sell;
      }
      case 'upgrade': {
        const values = upgradeValue(card.cardCode, state);
        if (!server) return -1;
        if (server.root.some(c => c.cardCode === card.cardCode)) return -Infinity;
        const value = server.isRemote ? (server.ice.length > 0 ? values[0] : -0.5) : server.id === 'archives' ? -1 : values[1];
        return value - (corp.credits < (cardDef(card).cost ?? 0) ? 1 : 0);
      }
    }
    return -Infinity;
  }
}

/**
 * Deck-aware AI: how well this ice fits here against this Runner, as a
 * shift between ice and servers that averages out to about zero, so it
 * changes which ice goes where rather than how much ice gets installed
 * (a flat bonus made the Corp over-ice in batches). Ice of a type the rig
 * can't break, on a server the Runner has been attacking, or of a type the
 * server lacks, does better; with `stakes`, so does HQ while it holds agendas.
 */
function iceFit(state: GameState, ice: CardInstance, server: ServerState | null, stakes: boolean): number {
  let fit = 0;
  const types = iceSubtypes(ice, state);
  const { covered } = rigCoverage(state.runner.rig.programs);
  // Only once the rig breaks some types but not others is there a choice to make
  if (covered.size > 0 && covered.size < 3 && types.length > 0) fit += types.some(t => covered.has(t)) ? -0.5 : 0.8;
  if (!server) return fit;
  const runs = [...state.runnerLastTurnRuns, ...state.runsThisTurn];
  if (runs.length > 0) fit += runs.some(r => r.server === server.id) ? 0.6 : -0.2;
  const conduit = state.runner.rig.programs.find(p => p.cardCode === '30024');
  if (server.id === 'rd' && conduit) {
    // Conduit: each run on R&D it gets through accesses 1 more card per counter (model): ice here stops some of them
    fit += Math.min(3, ICE_STOPS * PACE.runs * PACE.conduitRdShare * (1 + counters(conduit, 'virus')) * accessWorth(state)) - ICE_STOPS * PACE.runs * PACE.rdShare * accessWorth(state);
  }
  if (stakes && (server.id === 'hq' || server.id === 'rd')) {
    // Guard what HQ holds: agendas in hand make HQ the server to ice, none make R&D the bigger risk
    const inHq = state.corp.hq.filter(c => type(c) === 'agenda' && c.instanceId !== ice.instanceId);
    const hqStakes = inHq.reduce((n, a) => n + agendaStakes(state, a), 0);
    const lean = hqStakes > 0 ? Math.min(1, 0.25 * hqStakes) : -0.3;
    fit += server.id === 'hq' ? lean : -lean / 2;
  }
  if (server.ice.length > 0 && server.ice.some(other => iceSubtypes(other, state).some(t => types.includes(t)))) fit -= 0.4;
  return fit;
}

/** Install-score points per credit of worth the ice already on a server gains or loses from a new layer. */
const ICE_POSITION_RATE = 0.5;

/** Change in worth (credits, as the Corp sees it) of the ice already on `server` once a new layer goes outside it (a lone Scatter Field drops 4 strength). */
function shiftedIceWorth(state: GameState, placed: GameState, server: ServerState | null): number {
  if (!server) return 0;
  return server.ice.reduce((n, ice) => n + iceWorth(placed, ice, 'corp') - iceWorth(state, ice, 'corp'), 0);
}

/** Share of runs a new ice on a server stops (a guess, Jeff 2026-10-28: about one run in three). */
const ICE_STOPS = 0.3;

/**
 * Worth of scoring `agenda` this turn rather than leaving it advanced on
 * the board: its points on the clock, less what the evaluation already
 * counts for it installed.
 */
function finishWorth(state: GameState, agenda: CardInstance): number {
  const def = cardDef(agenda);
  const points = def.agenda_points ?? 1;
  const server = Object.values(state.corp.servers).find(s => s.root.some(c => c.instanceId === agenda.instanceId));
  return pointValue(state.corp.score + points) - pointValue(state.corp.score) - agendaWorth(state, agenda.advancementCounters, def.advancement_cost ?? 0, points, server?.id);
}

/**
 * (Jeff) Ice that would stop this Runner (its rig can't break it, or it
 * costs more than they have) belongs where it matters: R&D, the scoring
 * remote, a remote holding an agenda, HQ while it holds agendas. Not on a
 * server with nothing at stake, where it can never be moved from.
 */
function stopperPlacement(state: GameState, ice: CardInstance, server: ServerState | null): number {
  const cost = iceCost(state, { ...ice, isRezzed: true });
  if (cost !== Infinity && cost <= state.runner.credits) return 0;
  if (!server) return state.corp.hq.some(c => c.instanceId !== ice.instanceId && type(c) === 'agenda') ? 0.5 : -1; // a new remote, for an agenda to come
  const hqAgendas = state.corp.hq.some(c => c.instanceId !== ice.instanceId && type(c) === 'agenda');
  const matters =
    server.id === 'rd' ||
    (server.id === 'hq' && hqAgendas) ||
    server === mainRemote(state) ||
    (server.isRemote && server.root.some(c => type(c) === 'agenda'));
  return matters ? 1.5 : -1.5;
}

/** Share of a money operation's net gain added for playing it before rezzing ice strands it (plan.castWhileAble). */
const CAST_WHILE_ABLE = 0.5;

/** Credits the Corp counts on making before the Runner tests its newest ice (ice pacing: 2 and 0 played the same). */
const ICE_PACING_INCOME = 0;

/** Credits to rez every unrezzed ice the Corp has installed. */
export function unrezzedIceCost(state: GameState): number {
  return Object.values(state.corp.servers)
    .flatMap(server => server.ice)
    .reduce((n, ice) => n + (ice.isRezzed ? 0 : rezCost(state, ice)), 0);
}

/**
 * The scoring remote: the remote with the most ice that isn't holding a
 * money asset or trap (null with no iced remote).
 */
export function mainRemote(state: GameState): ServerState | null {
  let best: ServerState | null = null;
  for (const server of Object.values(state.corp.servers)) {
    if (!server.isRemote || server.ice.length === 0 || server.root.some(c => type(c) === 'asset')) continue;
    if (!best || server.ice.length > best.ice.length) best = server;
  }
  return best;
}

/** The Runner's virus counters, weighted by what they do. */
/**
 * Clicks of the ability an asset pays through, when that is all it does (plan.rezWhenUsed): text that is only
 * a click ability, with nothing on rez, at the turn's start or while it sits rezzed. 0 for anything else.
 */
/** A rez-to-use check is running (its ranking must not start another). */
/** Cards whose rezToUse look-ahead is running (plan.oneCurrency: per card, so a second Humanoid Resources is still priced inside the first's). */
const rezzingToUse = new Set<string>();

export function clickOnly(card: CardInstance): number {
  const def = cardDef(card);
  if (def.type_code !== 'asset') return 0;
  const text = def.stripped_text ?? '';
  const ability = /^((?:click,? ?)+)/i.exec(text);
  if (!ability || /when you rez|when your turn begins|whenever|each turn|while/i.test(text)) return 0;
  return (ability[1].match(/click/gi) ?? []).length;
}

function virusThreat(state: GameState): number {
  return [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].reduce(
    (n, c) => n + counters(c, 'virus') * counterWorth(state, c, 'virus', 'corp'),
    0
  );
}

/**
 * What this (rezzed) ice costs the Runner to get past, as protection for an
 * agenda (plan.tankProtection). Ice the Runner can get past with the credits it
 * has (no run enders, like Doomscroll, or run enders it can pay to break),
 * and whose other subroutines cost it less than a typical agenda is worth,
 * only protects by those credits, often 0: a Runner going for an agenda
 * takes the tag and the damage (Jeff 2026-10-31: clear the tag, draw past
 * the damage, run anyway). The full agenda, not the steal odds' half: the
 * Corp has to plan against a Runner who knows to run. The Runner may get
 * ready first (tankPrep): clear its tags and draw up, a click each.
 */
export function protectionCost(state: GameState, ice: CardInstance): number {
  const cost = iceCost(state, ice);
  if (!tuning.plan.tankProtection) return cost;
  const worth = pointGain(state.runner.score, agendaOdds(state).points);
  for (const prep of tankPreps(state)) {
    const need = iceCreditNeed(prep.state, ice);
    if (need + prep.credits > state.runner.credits) continue;
    if (tankCost(prep.state, ice) + prep.cost < worth) return Math.min(cost, need);
  }
  return cost;
}

/**
 * Ways the Runner can get ready for a run on its turn (one click kept for
 * the run): as it is, its tags cleared (a click and 2 credits each), and
 * then up to 3 cards drawn (a click each). Shallow copies of the board.
 */
function tankPreps(state: GameState): { state: GameState; cost: number; credits: number }[] {
  const runner = state.runner;
  const preps = [{ state, cost: 0, credits: 0 }];
  // Clearing comes first: it also stops "if the Runner is tagged" subroutines
  for (const tags of runner.tags > 0 ? [runner.tags, 0] : [runner.tags]) {
    const cleared = runner.tags - tags;
    for (let draws = 0; cleared + draws <= 3 && draws <= runner.stack.length; draws++) {
      if (cleared === 0 && draws === 0) continue;
      const clicks = cleared + draws;
      preps.push({
        state: { ...state, runner: { ...runner, tags, grip: [...runner.grip, ...runner.stack.slice(0, draws)] } },
        cost: clicks * clickRate('runner') + 2 * cleared,
        credits: 2 * cleared,
      });
    }
  }
  return preps;
}

/**
 * What taking this ice's subroutines (the ones that don't end the run) costs
 * the Runner, resolving them in order: tags an earlier one gives count for
 * the later ones (Doomscroll's third subroutine after its first). Ones that
 * end the run as things stand are broken (iceCreditNeed); one that only
 * becomes a wall from those tags (damage past the grip) can't be taken.
 */
function tankCost(state: GameState, ice: CardInstance): number {
  let tags = state.runner.tags;
  let total = 0;
  for (const sub of iceSubroutines(state, ice)) {
    const now = tags === state.runner.tags ? state : { ...state, runner: { ...state.runner, tags } };
    const c = subroutineCost(now, sub.label);
    if (c >= BLOCK && subroutineCost(state, sub.label) < BLOCK) return Infinity;
    if (c < BLOCK) total += c;
    tags += Number(sub.label.match(/give the runner (\d+) tags?/i)?.[1] ?? 0);
  }
  return total;
}

/**
 * What the Runner would pay to get into a server, counting rezzed ice and
 * the unrezzed ice `credits` can still rez (plan.breakerReach: ice their rig can't break by the
 * breaker they'd find for it; off, 8).
 */
function entryCost(state: GameState, server: ServerState, credits: number): number {
  let cost = 0;
  for (const ice of server.ice) {
    if (!ice.isRezzed) {
      const rc = rezCost(state, ice);
      if (rc > credits) continue;
      credits -= rc;
    }
    const c = protectionCost(state, { ...ice, isRezzed: true });
    cost += !tuning.plan.breakerReach ? Math.min(8, c) : c === Infinity ? breakerReach(state, { ...ice, isRezzed: true }) : c;
  }
  return cost;
}

/**
 * plan.breakerReach (code audit, 2026-11-06; Jeff: the flat 8 was a band-aid): what the Runner pays to get past ice
 * its rig can't, by the cheapest icebreaker in its deck that could: break it, install it, a click to install and the
 * clicks to draw it (none from the grip; from the stack the expected draws to the first copy, (n + 1) / (k + 1)).
 * Infinity when nothing in its grip or stack can: a wall. It reads the Runner's deck, not its order (the Corp knows
 * the faction's breakers); memory limits aren't checked.
 */
export function breakerReach(state: GameState, ice: CardInstance): number {
  const runner = state.runner;
  const found = new Map<string, { card: CardInstance; grip: boolean; copies: number }>();
  for (const [cards, grip] of [[runner.grip, true], [runner.stack, false]] as const) {
    for (const card of cards) {
      if (!isIcebreaker(card)) continue;
      const seen = found.get(card.cardCode);
      if (!seen) found.set(card.cardCode, { card, grip, copies: grip ? 0 : 1 });
      else if (!grip && !seen.grip) seen.copies++;
    }
  }
  let best = Infinity;
  for (const { card, grip, copies } of found.values()) {
    const trial: GameState = { ...state, runner: { ...runner, rig: { ...runner.rig, programs: [...runner.rig.programs, card] } } };
    const pass = iceCost(trial, ice);
    if (pass === Infinity) continue;
    const draws = grip ? 0 : (runner.stack.length + 1) / (copies + 1);
    best = Math.min(best, pass + (cardDef(card).cost ?? 0) + (1 + draws) * clickRate('runner'));
  }
  return best;
}

/** An asset whose whole worth is what it does when rezzed (Spin Doctor), not a money asset that pays out. */
function onRezOnly(card: CardInstance): boolean {
  return type(card) === 'asset' && !CARD_PROFILES[card.cardCode] && /^When you rez this asset, draw/i.test(cardDef(card).stripped_text ?? '');
}

/**
 * The Runner can't pay its way into the server on its next turn: the ice
 * (rezzed, or that `credits` can still rez) costs more to get through than
 * it has plus a turn's income.
 */
export function outOfReach(state: GameState, server: ServerState, credits: number): boolean {
  // plan.stealCosts: other cards' additional costs to steal (Magistrate Revontulet's 3 credits, rules 1.16.10b) are paid at the access too
  const tax = tuning.plan.stealCosts ? stealCost(state, { instanceId: '', cardCode: '' } as CardInstance).credits : 0;
  return entryCost(state, server, credits) + tax > state.runner.credits + STEAL.income;
}

/**
 * Layers of ice on a server as the Runner sees them: rezzed ice counts by
 * what it costs them to get through (1 credit or less: not there at all,
 * 3 or more: a full layer); unrezzed ice counts in full.
 */
export function iceDepth(state: GameState, server: ServerState): number {
  return server.ice.reduce((n, ice) => n + (ice.isRezzed ? Math.min(1, Math.max(0, (protectionCost(state, ice) - 1) / 2)) : 1), 0);
}

/**
 * iceDepth, counting only the unrezzed ice that `credits` can pay to rez
 * (cheapest first): ice the Corp can't afford to rez is no protection.
 */
export function fundedDepth(state: GameState, server: ServerState, credits: number): number {
  const affordable = new Set<string>();
  for (const ice of server.ice.filter(i => !i.isRezzed).sort((a, b) => rezCost(state, a) - rezCost(state, b))) {
    const cost = rezCost(state, ice);
    if (cost > credits) break;
    credits -= cost;
    affordable.add(ice.instanceId);
  }
  return server.ice.reduce(
    (n, ice) => n + (ice.isRezzed ? Math.min(1, Math.max(0, (protectionCost(state, ice) - 1) / 2)) : affordable.has(ice.instanceId) ? 1 : 0),
    0
  );
}

/**
 * What losing this agenda would cost: its points, a lot more if the steal
 * would win the game for the Runner, and a little for each advancement
 * counter on it (it is that much closer to being scored). About 1 to 7.
 */
/** Install-score bonus for ice on HQ while it holds an agenda that would win the Runner the game (plan.lethalHq). */
const LETHAL_HQ_NEED = 3;

/**
 * plan.lethalHq (bug report #4, Jeff 2026-11-02): an agenda in HQ whose steal wins the Runner
 * the game, while HQ is not out of the Runner's reach (what it costs them to get in, with the
 * Corp's `credits` to rez). Trashing it is no answer: it lands in Archives, where they steal it too.
 */
export function lethalHqAgenda(state: GameState, credits = state.corp.credits): boolean {
  const lethal = state.corp.hq.some(c => type(c) === 'agenda' && state.runner.score + (cardDef(c).agenda_points ?? 0) >= 7);
  return lethal && !outOfReach(state, state.corp.servers.hq, credits);
}

export function agendaStakes(state: GameState, agenda: CardInstance): number {
  const points = cardDef(agenda).agenda_points ?? 1;
  return points + (state.runner.score + points >= 7 ? 3 : 0) + 0.25 * Math.min(agenda.advancementCounters, 4);
}

/** Installed agendas with enough counters to score. */
/** plan.oneCurrency: FINISH_TIE's ordering (rankMainActions). */
function finishFirst(state: GameState, ranked: ScoredAction[]): ScoredAction[] {
  const top = ranked[0];
  if (!top || !Number.isFinite(top.score) || top.action.type === 'SCORE_AGENDA' || top.action.type === 'ADVANCE_CARD') return ranked;
  // Tempo round (human games): also when the top play leaves the finish in reach. Then advancing first ends the turn in
  // the same place, and the agenda is done before a prompt, a run or a cut-off playout can stop it; Jeff advanced first
  const after = simulate(state, top.action);
  const at = ranked.findIndex(
    r =>
      r.action.type === 'ADVANCE_CARD' &&
      Number.isFinite(r.score) &&
      towardFinish(state, r.action.cardInstanceId) &&
      (r.score >= top.score - FINISH_TIE || (!!after && towardFinish(after, r.action.cardInstanceId)))
  );
  if (at <= 0) return ranked;
  return [ranked[at], ...ranked.slice(0, at), ...ranked.slice(at + 1)];
}

/** An installed agenda this turn's clicks and credits can finish (an advance is a click and a credit, rule 5.2.6f). */
function towardFinish(state: GameState, id: string): boolean {
  const card = Object.values(state.corp.servers).flatMap(s => s.root).find(c => c.instanceId === id);
  if (!card || type(card) !== 'agenda') return false;
  const need = (cardDef(card).advancement_cost ?? 0) - card.advancementCounters;
  return need > 0 && need <= state.corp.clicks && need <= state.corp.credits;
}

/** Agendas in the root of a server the Corp can finish and score with the clicks and credits it has left (an advance is a click and a credit, rule 5.2.6). */
function finishable(state: GameState): number {
  return Object.values(state.corp.servers)
    .flatMap(s => s.root)
    .filter(c => {
      if (type(c) !== 'agenda') return false;
      const need = Math.max(0, (cardDef(c).advancement_cost ?? 99) - c.advancementCounters);
      return need <= state.corp.clicks && need <= state.corp.credits;
    }).length;
}

function scoreable(state: GameState): number {
  return Object.values(state.corp.servers)
    .flatMap(s => s.root)
    .filter(c => type(c) === 'agenda' && c.advancementCounters >= (cardDef(c).advancement_cost ?? 99)).length;
}

/** How much the Corp cares about keeping the Runner out of this server (for rez decisions). */
/**
 * What the Runner's run takes if it gets in, on the value model's scale: the agendas it would
 * steal (the Corp knows its own cards), each worth the points it brings the Runner closer to 7.
 */
export function runLoss(state: GameState): number {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server) return 0;
  const steal = (c: CardInstance) => pointGain(state.runner.score, cardDef(c).agenda_points ?? 0);
  const accesses = 1 + run.extraAccesses;
  let loss = server.root.filter(c => type(c) === 'agenda').reduce((n, c) => n + steal(c), 0);
  if (server.id === 'hq' && state.corp.hq.length > 0) {
    const agendas = state.corp.hq.filter(c => type(c) === 'agenda');
    loss += (Math.min(accesses, state.corp.hq.length) / state.corp.hq.length) * agendas.reduce((n, c) => n + steal(c), 0);
  } else if (server.id === 'rd') {
    const { odds, points } = agendaOdds(state);
    loss += Math.min(accesses, state.corp.rd.length) * odds * pointGain(state.runner.score, points);
  } else if (server.id === 'archives') {
    loss += state.corp.archives.faceDown.filter(c => type(c) === 'agenda').reduce((n, c) => n + steal(c), 0);
  }
  return loss;
}

const MYOSHU_COST = 10;

/**
 * Myōshu (play only after scoring an agenda installed on an earlier turn;
 * 10 credits for 2 points): worth saving for while it is in HQ and an
 * agenda installed before this turn sits in a remote. `held`: the 10 are
 * already in the pool (keep them); otherwise they are within about two
 * turns of clicks (save toward them).
 */
export function myoshuSaving(state: GameState, held = false): boolean {
  const corp = state.corp;
  if (!corp.hq.some(c => c.cardCode === MYOSHU)) return false;
  const now = turnKey(state);
  const older = Object.values(corp.servers).some(s => s.isRemote && s.root.some(c => type(c) === 'agenda' && c.installedTurn !== now));
  if (!older) return false;
  return held ? corp.credits >= MYOSHU_COST : corp.credits < MYOSHU_COST && corp.credits + corp.clicks + 6 >= MYOSHU_COST;
}

/**
 * Perfect Recall: the card in HQ to reveal so the Runner can't steal it on
 * this run: on an HQ run the agenda worth most there; on a run where the
 * root holds an agenda, a copy of it in HQ. Undefined: nothing worth it.
 */
export function perfectRecallTarget(state: GameState): string | undefined {
  const run = state.activeRun;
  if (!run || (run.protectedTitles?.length ?? 0) > 0) return undefined;
  const agendas = state.corp.hq.filter(c => type(c) === 'agenda');
  if (run.server === 'hq') return [...agendas].sort((a, b) => (cardDef(b).agenda_points ?? 0) - (cardDef(a).agenda_points ?? 0))[0]?.instanceId;
  const target = state.corp.servers[run.server]?.root.find(c => type(c) === 'agenda');
  return target ? agendas.find(c => cardDef(c).title === cardDef(target).title)?.instanceId : undefined;
}

function serverImportance(state: GameState, server: ServerState | undefined, aware = false): number {
  if (!server) return 0;
  const agenda = server.root.find(c => type(c) === 'agenda');
  if (agenda) return aware ? 7 + 1.5 * agendaStakes(state, agenda) : 10;
  if (server.id === 'hq') {
    const inHq = state.corp.hq.filter(c => type(c) === 'agenda');
    return 3 + (aware ? inHq.reduce((n, a) => n + agendaStakes(state, a), 0) : inHq.length * 2);
  }
  if (server.id === 'rd') return 4;
  if (server.id === 'archives') return state.corp.archives.faceDown.some(c => type(c) === 'agenda') ? 6 : 0.5;
  if (server.root.some(c => c.advancementCounters > 0)) return 1; // a trap: let them in
  if (server.root.some(c => c.isRezzed && econValue(c.cardCode, state))) return 3;
  return server.root.length > 0 ? 2 : 0.5;
}

/** Ice on this server that is rezzed or that `credits` could rez (cheapest first). */
function guards(state: GameState, server: ServerState, credits: number): number {
  let count = server.ice.filter(ice => ice.isRezzed).length;
  const costs = server.ice.filter(ice => !ice.isRezzed).map(ice => rezCost(state, ice)).sort((a, b) => a - b);
  for (const cost of costs) {
    if (cost > credits) break;
    credits -= cost;
    count++;
  }
  return count;
}

/**
 * Credits to keep back so every remote holding an agenda has at least one
 * piece of ice the Corp can rez when the Runner comes in.
 */
export function rezReserve(state: GameState, wide = false): number {
  const needs: number[] = [];
  const hqAgendas = state.corp.hq.some(c => type(c) === 'agenda');
  for (const server of Object.values(state.corp.servers)) {
    const agendaRemote = server.isRemote && server.root.some(c => type(c) === 'agenda');
    // Deck-aware AI: R&D, and HQ while it holds agendas, need rez money too
    const central = wide && (server.id === 'rd' || (server.id === 'hq' && hqAgendas));
    if (!agendaRemote && !central) continue;
    if (server.ice.some(ice => ice.isRezzed)) continue;
    const costs = server.ice.map(ice => rezCost(state, ice));
    if (costs.length > 0) needs.push(Math.min(...costs));
  }
  needs.sort((a, b) => b - a);
  // Wide: enough for the two most expensive of those servers
  return wide ? (needs[0] ?? 0) + (needs[1] ?? 0) : needs[0] ?? 0;
}

/**
 * Penalty for an action that drops the Corp below its rez reserve. Wide
 * (round 3): graded by how far below it goes, and a small reward for
 * money that climbs back toward it.
 */
function reservePenalty(state: GameState, creditsAfter: number, wide = false): number {
  const reserve = rezReserve(state, wide);
  if (!wide) return reserve > 0 && state.corp.credits >= reserve && creditsAfter < reserve ? 3 : 0;
  const before = Math.max(0, reserve - state.corp.credits);
  const after = Math.max(0, reserve - creditsAfter);
  // (Jeff) an installed agenda's unrezzed ice is only protection while the money to rez it is there: don't spend it
  const agendaMoney = tuning.plan.agendaMoney && creditsAfter < state.corp.credits && creditsAfter < agendaRemoteNeed(state) ? 6 : 0;
  return agendaMoney + moneyTargetPenalty(state, creditsAfter) + (after > before ? Math.min(3, after - before) : -Math.min(1, 0.4 * (before - after)));
}

/**
 * (Jeff) A surplus to aim for: the credits to rez every unrezzed ice on
 * R&D, HQ and the remotes that hold agendas or do the scoring (at most 12).
 * Spending below it costs a little, money that climbs toward it earns a
 * little. Rezzing during runs and scoring aren't held back by it.
 */
export function moneyTarget(state: GameState): number {
  const main = mainRemote(state);
  let target = 0;
  for (const server of Object.values(state.corp.servers)) {
    const counts = server.id === 'rd' || server.id === 'hq' || server === main || (server.isRemote && server.root.some(c => type(c) === 'agenda'));
    if (counts) for (const ice of server.ice) if (!ice.isRezzed) target += rezCost(state, ice);
  }
  return Math.min(12, target);
}

function moneyTargetPenalty(state: GameState, creditsAfter: number): number {
  const weight = tuning.plan.moneyTarget;
  if (!weight) return 0;
  const target = moneyTarget(state);
  const before = Math.max(0, target - state.corp.credits);
  const after = Math.max(0, target - creditsAfter);
  return after > before ? Math.min(2, weight * (after - before)) : -Math.min(1.5, weight * (before - after));
}

/**
 * Credits to rez every unrezzed ice on the remotes holding an agenda that
 * can't be scored yet (other than `except`).
 */
export function agendaRemoteNeed(state: GameState, except?: string): number {
  let need = 0;
  for (const server of Object.values(state.corp.servers)) {
    if (!server.isRemote || server.id === except) continue;
    if (!server.root.some(c => type(c) === 'agenda' && c.advancementCounters < (cardDef(c).advancement_cost ?? 0))) continue;
    for (const ice of server.ice) if (!ice.isRezzed) need += rezCost(state, ice);
  }
  return need;
}

/**
 * Installing ice behind 2 or more layers: trash rezzed ice the Runner gets
 * through for a credit or less (rules 8.5.6b), when the new ice taxes them
 * clearly more. Each trashed ice is a credit off the install cost.
 */
export function withDeadIceTrashed(state: GameState, action: GameAction): GameAction {
  if (action.type !== 'INSTALL_CARD' || action.asNewRemote || !action.targetServerId) return action;
  const card = state.corp.hq.find(c => c.instanceId === action.cardInstanceId);
  const server = state.corp.servers[action.targetServerId];
  if (!card || type(card) !== 'ice' || !server || server.ice.length < 2) return action;
  const incoming = iceCost(state, { ...card, isRezzed: true });
  const dead = server.ice.filter(ice => {
    if (!ice.isRezzed) return false;
    const cost = iceCost(state, ice);
    return cost <= 1 && incoming >= cost + 2;
  });
  return dead.length > 0 ? { ...action, trashFirst: dead.map(ice => ice.instanceId) } : action;
}

/**
 * Ice installs that trash the weakest rezzed ice on the server first (rules
 * 8.5.6b): a credit off the install cost, and some installs become
 * affordable only this way. Scored as the plain install with a credit more,
 * less the trashed ice's worth, so it wins only where money is tight.
 */
export function iceTrashInstalls(state: GameState): GameAction[] {
  const corp = state.corp;
  if (state.activePlayer !== 'corp' || state.activeRun || corp.clicks < 1) return [];
  const installs: GameAction[] = [];
  // plan.lethalHq: HQ keeps every layer while it holds the agenda that would lose the game
  const keepHq = tuning.plan.lethalHq && lethalHqAgenda(state);
  for (const card of corp.hq) {
    if (type(card) !== 'ice') continue;
    for (const server of Object.values(corp.servers)) {
      if (corp.credits < server.ice.length - 1 || (keepHq && server.id === 'hq')) continue;
      const weak = weakestIce(state, server.id);
      if (!weak) continue;
      const action: GameAction = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: card.instanceId, targetServerId: server.id, trashFirst: [weak.instanceId] };
      if (isLegalAction(state, action)) installs.push(action);
    }
  }
  return installs;
}

/** What losing a piece of ice costs the Corp: a layer, worth more the more it taxes the Runner. */
function trashLoss(state: GameState, id: string): number {
  const ice = Object.values(state.corp.servers).flatMap(s => s.ice).find(c => c.instanceId === id);
  return ice ? 0.5 + 0.75 * Math.min(4, iceCost(state, ice)) : 0;
}

/**
 * plan.freeInstallPick: where the Corp's own install choice would put `card` among these
 * install options ('new' is a new remote), and how much it wants it there. Effects that
 * install from HQ ignoring all costs (Synapse Global) are judged like an install action,
 * because the board score alone prices a card leaving HQ above unrezzed ice.
 */
export function freeInstallTarget(state: GameState, card: CardInstance, options: string[]): { server: string; score: number } | undefined {
  const corp = new HeuristicCorpAI({ synergy: true, planner: false });
  let best: { server: string; score: number } | undefined;
  for (const id of options) {
    const server = id === 'new' ? null : state.corp.servers[id];
    if (server === undefined) continue;
    const score = (corp as unknown as { installScore(s: GameState, c: CardInstance, sv: ServerState | null, free: boolean): number }).installScore(state, card, server, true);
    if (Number.isFinite(score) && (!best || score > best.score)) best = { server: id, score };
  }
  return best;
}

/**
 * plan.pettyCashFirst (Jeff, 2026-11-04, the credit-card audit): Petty Cash can be played only before the Corp has
 * finished an action this turn, so ranking it below an install made it unplayable for the rest of the turn. In 40
 * self-play games the Corp clicked for credits on 25 turns while holding a Petty Cash it could afford. When it ranks
 * among the actions the Corp has clicks for this turn, it goes first; and the Corp never clicks for a credit while it
 * can play it instead.
 */
function pettyCashFirst(state: GameState, ranked: ScoredAction[]): ScoredAction[] {
  const at = ranked.findIndex(r => isPettyCash(state, r.action));
  if (at <= 0 || at >= state.corp.clicks || !Number.isFinite(ranked[at].score) || ranked[0].action.type === 'SCORE_AGENDA') return ranked;
  const petty = { ...ranked[at], score: ranked[0].score + 0.01 };
  return [petty, ...ranked.slice(0, at), ...ranked.slice(at + 1)];
}
const PETTY_CASH = '35081';
const isPettyCash = (state: GameState, a: GameAction): boolean => a.type === 'PLAY_OPERATION_OR_EVENT' && state.corp.hq.find(c => c.instanceId === a.cardInstanceId)?.cardCode === PETTY_CASH;

/**
 * plan.tagFirst (Jeff, 2026-11-05: the Corp leaves tags unused): a tag usually lasts only until the Runner's next turn,
 * so a resource trash the Corp would make with this turn's clicks is made first, before the installs and draws that can
 * wait. The "tag not used" alarm rose from 52 to 79 per 663 games once the Runner played its money resources (Side
 * Hustle at 5 credits, Telework): the Corp ranked the trash second, installed first, and was then too poor to trash.
 */
function tagFirst(state: GameState, ranked: ScoredAction[]): ScoredAction[] {
  if (state.runner.tags <= 0) return ranked;
  const at = ranked.findIndex(r => r.action.type === 'TRASH_RESOURCE');
  if (at <= 0 || at >= state.corp.clicks || !Number.isFinite(ranked[at].score) || ranked[at].score <= 0 || ranked[0].action.type === 'SCORE_AGENDA') return ranked;
  const trash = { ...ranked[at], score: ranked[0].score + 0.01, tagFirst: true };
  return [trash, ...ranked.slice(0, at), ...ranked.slice(at + 1)];
}
