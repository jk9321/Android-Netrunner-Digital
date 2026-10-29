import { CardInstance, GameAction, GameState, ServerState, activePrompt, cardDef, findCardAnywhere, getCardDefinition, getLegalActions, isLegalAction } from '../core';
import { iceScript, iceStrength, iceSubtypes } from '../core/engine/ice';
import { iceWorth, withIceInstalled } from './iceValues';
import { rigCoverage } from './evaluate';
import { counters, rezCost } from '../core/engine/cardEffects';
import { Agent, FreeActionGuard, ScoredAction } from './agent';
import { agendaWorth, digValue, evaluate } from './evaluate';
import { pointGain, pointValue } from './valueModel';
import { PACE, STEAL, accessWorth, agendaOdds } from './effectValues';
import { answerPrompt, simulate } from './prompts';
import { asSide, logNudge, nudge, opponentLean, tuning } from './synergy';
import { noteKnownHand } from './handValues';
import { PlanMemory, planTurn, plannerOn } from './turnPlanner';
import { runnerReply } from './runnerReply';
import { PETTY_CASH_REPLAY, iceAdvanceWorth, placedCounterWorth, rezEffectWorth, rezzedWorth, runTimed, topDownWorth } from './effectValues';
import { CARD_PROFILES, ECON_SCALE } from './cardProfiles';

/** Whether a group of value hacks is replaced by the model (plan.modelHacks, Jeff 2026-10-28). */
const hacksOff = (group: 'rez' | 'rezPriority' | 'purge' | 'bonuses' | 'iceAdvance' | 'finish' | 'conduit'): boolean => !!tuning.plan.modelHacks?.[group];
import { iceCost, isTrap, tagCost, weakestIce } from './runs';
import { cardSynergy } from './synergyTags';
import { econValue, upgradeValue } from './cardValues';
import { counterWorth } from './counterValues';


const type = (card: CardInstance) => cardDef(card).type_code;
const hasEndTheRun = (ice: CardInstance) => (iceScript(ice)?.subroutines ?? []).some(s => /end the run/i.test(s.label));
const isAgendaOrAsset = (card: CardInstance) => ['agenda', 'asset'].includes(type(card));

/**
 * Credits a money operation gains, read from its text (step 6: no hand-kept
 * list, so new sets are covered): "Gain N credits" as the card's own effect,
 * not as one option of a choice ("* Gain 3 credits").
 */
export function moneyOpGain(code: string): number | undefined {
  const def = getCardDefinition(code);
  if (def.type_code !== 'operation') return undefined;
  const gain = /(?:^|\. )Gain (\d+) credits/.exec(def.stripped_text ?? '');
  return gain ? Number(gain[1]) : undefined;
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

  chooseAction(state: GameState): GameAction {
    return asSide('corp', () => this.decide(state));
  }

  private decide(state: GameState): GameAction {
    noteKnownHand(state, 'corp');
    if (activePrompt(state)) return answerPrompt(state, 'corp', undefined, this.synergy);
    const legal = getLegalActions(state, 'corp');
    const ranked = this.rankMainActions(state, legal);
    const planned = this.planner && plannerOn('corp') && state.turnStep?.kind !== 'corp_turn_start' ? this.plan(state, ranked) : null;
    const chosen = planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0]);
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
    return [...legal, ...(iceTrash ? iceTrashInstalls(state) : [])]
      .map(original => {
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
      if (def.type_code === 'ice') {
        // Ping tags the Runner when rezzed during a run; ice that ends the run protects best
        const onRez = hacksOff('rezPriority') ? ECON_SCALE * rezEffectWorth(card, tagCost(state)) : card.cardCode === '30055' ? 2 : 0;
        score = importance + (hasEndTheRun(card) ? 1 : 0) + onRez;
        if (state.corp.credits - cost < 2 && importance < 4) score -= 2;
        // (Jeff) money kept to rez an agenda remote's ice isn't spent on ice elsewhere
        if (this.synergy && tuning.plan.agendaMoney && state.corp.credits - cost < agendaRemoteNeed(state, server.id)) score -= 3;
      } else if (def.type_code === 'upgrade') {
        if (hacksOff('rezPriority')) {
          // Upgrades: by what they do here (model), up to the 2 an upgrade gives up against ice;
          // one that does nothing in a run waits for the Corp's turn, keeping the money for ice
          const [remote, central] = upgradeValue(card.cardCode, state);
          score = !runTimed(card) ? -1 : importance - 2 + Math.min(2, Math.max(0, server.isRemote ? remote : central));
        } else score = card.cardCode === '30042' || card.cardCode === '30050' ? importance : importance - 2;
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

  private score(state: GameState, action: GameAction, before: number): number {
    const corp = state.corp;
    switch (action.type) {
      case 'END_TURN':
        return -0.5;
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

  /** Worth of rezzing a card in a server's root on the Corp's own turn. */
  private rezValue(state: GameState, card: CardInstance): number {
    const corp = state.corp;
    // A money asset that pays when the Corp's turn begins is rezzed in the window just before then
    // (rules 5.6.1b-d): it pays at once, and the Runner gets no turn to trash it full (plan.assetRezTiming)
    if (tuning.plan.assetRezTiming && CARD_PROFILES[card.cardCode]?.every === 'turn' && state.turnStep?.kind !== 'corp_turn_start') return -Infinity;
    // (Jeff) Spin Doctor: left unrezzed it may draw a run, and is rezzed then for the same draw; or just before the
    // turn begins. Rezzed in the action phase only when the cards are needed now (digging, or an empty hand);
    // spinDoctorUseNow: or while 2+ clicks are left to use them this turn
    if (tuning.plan.spinDoctorWait && onRezOnly(card) && state.turnStep?.kind !== 'corp_turn_start' && corp.hq.length > 1 && digValue(state, 'corp') <= 0 && (!tuning.plan.spinDoctorUseNow || corp.clicks <= 1)) return -Infinity;
    const econ = econValue(card.cardCode, state);
    if (econ) return econ + 1;
    if (hacksOff('rez')) {
      // Model: worth once rezzed, less the rez cost, on the install-score scale; upgrades still wait for ice money (Jeff)
      if (type(card) === 'upgrade' && this.idleUpgrade(state, card)) return -Infinity;
      if (type(card) === 'agenda' || isTrap(card.cardCode)) return -Infinity;
      // Manegarm and the like are rezzed when the Runner comes (decideRez), not on the Corp's turn
      if (runTimed(card)) return -Infinity;
      const worth = rezzedWorth(state, card, rezCost(state, card));
      return worth > 0 ? ECON_SCALE * worth : -Infinity;
    }
    if (card.cardCode === '30061') return 1; // Clearinghouse must be rezzed to fire
    // Elevation cards whose effects need them rezzed
    switch (card.cardCode) {
      case '35051': // Phật Gioan Baotixita: gathers power counters
        return 1.5;
      case '35061': // Idiosyncresis: pays out when the turn begins
        return card.advancementCounters >= 2 ? 2 : -Infinity;
      case '35073': // Plutus: replays transactions from Archives
        return corp.archives.faceUp.concat(corp.archives.faceDown).some(c => /transaction/i.test(cardDef(c).keywords ?? '')) ? 1.2 : -Infinity;
      case '35082': // Mahkota Langit Grid: recurring credits
        return this.idleUpgrade(state, card) ? -Infinity : 1.5;
      case '35045': // Mercia B4LL4RD
      case '35056': // Mitra Aman
        return this.idleUpgrade(state, card) ? -Infinity : 1;
    }
    return -Infinity;
  }

  /** Operations and other plays, scored by the position they lead to. */
  private playScore(state: GameState, action: GameAction, before: number): number {
    const corp = state.corp;
    if (action.type === 'PLAY_OPERATION_OR_EVENT') {
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
    const spendsClick = after.corp.clicks < corp.clicks;
    if (!spendsClick && this.freeActions.exhausted) return -Infinity;
    // Follow our own prompts (Predictive Planogram, Seamless Launch) a few steps.
    let resolved = after;
    for (let i = 0; i < 3 && activePrompt(resolved)?.side === 'corp'; i++) {
      const next = simulate(resolved, answerPrompt(resolved, 'corp', undefined, this.synergy));
      if (!next) break;
      resolved = next;
    }
    let score = evaluate(resolved, 'corp', this.synergy) - before;
    if (this.synergy) score += this.moneyPlan(state, action);
    // Deck-aware AI: a play that makes an agenda scoreable this turn (Seamless Launch, Key Performance Indicators...)
    if (this.synergy && tuning.plan.scoreSetup && scoreable(resolved) > scoreable(state)) score = Math.max(score, 41);
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
      return reachable ? 0.6 : 0;
    }
    if (action.type === 'PLAY_OPERATION_OR_EVENT' && tuning.plan.pettyCash) {
      return corp.hq.find(c => c.instanceId === action.cardInstanceId)?.cardCode === '35081' ? (hacksOff('bonuses') ? PETTY_CASH_REPLAY : 1.5) : 0;
    }
    if (action.type === 'DRAW_CARD' && tuning.plan.dig?.corp && corp.hq.length < corp.handSizeLimit) return digValue(state, 'corp');
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
        // Model (plan.modelHacks.finish): the clicks are priced by the evaluation; what it misses is the score they lead to
        if (hacksOff('finish')) return Math.max(0, ...finishing.map(a => finishWorth(state, a)));
        return finishing.length ? 42 : -Infinity;
      }
      case '35067': {
        // Touch-ups (2 clicks, 2 credits): 2 advancements, best when they finish an agenda
        const clicksAfter = corp.clicks - 2;
        if (clicksAfter < 0 || corp.credits < 2) return -Infinity;
        const finishing = agendas.filter(a => need(a) <= 2 + Math.min(clicksAfter, corp.credits - 2) && need(a) > 0);
        if (hacksOff('finish')) return Math.max(0, ...finishing.map(a => finishWorth(state, a)));
        return finishing.length ? 41 : 0;
      }
      case '35044': {
        // Top-Down Solutions: 2 cards and up to 2 installs for 1 click
        const installable = corp.hq.filter(c => ['ice', 'asset', 'upgrade', 'agenda'].includes(type(c))).length;
        if (!(corp.credits >= 3 && installable >= 1 && corp.hq.length <= corp.handSizeLimit)) return 0;
        return hacksOff('bonuses') ? topDownWorth(installable, state) : 1.3;
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
        if (need - spend > (locked ? 6 : 3) || guards(state, server, corp.credits - spend) === 0 || !this.exposureOk(state, server, corp.credits - spend)) return -Infinity;
        return (locked ? 8 : 6) + card.advancementCounters; // and then finish the job: a half-advanced agenda is the Runner's best target
      }
      // Can't finish this turn: build counters only behind ice we can rez
      return guards(state, server, corp.credits - 1) > 0 ? 3 + 0.5 * card.advancementCounters : -Infinity;
    }
    if (def.type_code === 'asset') {
      // Traps: advancing makes them look like agendas (Urtica Cipher, Clearinghouse)
      if (!(corp.credits >= 4 && card.advancementCounters < 3)) return -Infinity;
      return this.synergy && tuning.bluff && isTrap(card.cardCode) ? 1.2 + this.trapBluff(state, card) : 1.2;
    }
    // Pharos: +5 strength at 3 counters; Syailendra: places counters when encountered at 3
    if (hacksOff('iceAdvance') && (card.cardCode === '35076' || card.cardCode === '30063')) {
      const at = (n: number) => Math.min(8, iceCost(state, { ...card, isRezzed: true, advancementCounters: n }));
      const worth = iceAdvanceWorth(state, card, at);
      return worth > 0 ? ECON_SCALE * worth : -Infinity;
    }
    if (card.cardCode === '35076' && card.advancementCounters < 3 && corp.credits >= 4) return 0.8;
    return card.cardCode === '30063' && card.advancementCounters < 3 && corp.credits >= 8 ? 1 : -Infinity;
  }

  /**
   * Extra reason to advance a trap: an Urtica Cipher that would flatline
   * the Runner's current hand, or (once the Runner has seen this Corp's
   * traps) a bare trap that would otherwise read as an obvious bluff.
   */
  private trapBluff(state: GameState, card: CardInstance): number {
    if (card.cardCode === '30045' && 2 + card.advancementCounters + 1 >= state.runner.grip.length) {
      // Model: the counter that makes it lethal, at the chance it's accessed
      return hacksOff('bonuses') ? ECON_SCALE * placedCounterWorth(state, card, false) : 1.5;
    }
    const shown = state.corp.archives.faceUp.some(c => isTrap(c.cardCode));
    return shown && card.advancementCounters === 0 ? 0.6 : 0;
  }

  /**
   * An agenda left installed over the Runner's turn needs a server they
   * can't simply walk into. plan.exposureByCost (Jeff, 2026-10-29: two
   * layers are no protection against a Runner who can pay for them): the
   * ice (rezzed, or that `credits` can still rez) must cost more to get
   * through than the Runner has plus a turn's income (STEAL.income, as the
   * steal odds judge it). Before it: 2 real layers of ice, or ice that costs
   * more than the Runner has.
   */
  private exposureOk(state: GameState, server: ServerState, credits: number): boolean {
    if (!(this.synergy && tuning.plan.exposure)) return true;
    if (tuning.plan.exposureByCost) return outOfReach(state, server, credits);
    // (Jeff) unrezzed ice only protects if the money to rez it is still there on the Runner's turn
    if ((tuning.plan.fundedDepth ? fundedDepth(state, server, credits) : iceDepth(state, server)) >= 2) return true;
    return entryCost(state, server, credits) >= state.runner.credits + 2;
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

  private installScore(state: GameState, card: CardInstance, server: ServerState | null): number {
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
        if (this.synergy && tuning.plan.icePacing && unrezzedIceCost(state) + (cardDef(card).cost ?? 0) > corp.credits - installCost + ICE_PACING_INCOME && hq.length <= corp.handSizeLimit) return -Infinity;
        let need: number;
        // Deck-aware AI: one well-iced scoring remote rather than ice spread thin
        const main = this.synergy && tuning.plan.oneRemote ? mainRemote(state) : null;
        // (Jeff) centrals first while R&D, or HQ holding agendas, has no ice
        const bareCentral =
          this.synergy && tuning.plan.centralsFirst && (corp.servers.rd.ice.length === 0 || (agendasInHand > 0 && corp.servers.hq.ice.length === 0));
        if (!server) {
          need = agendasInHand > 0 && !protectedEmptyRemote ? 5 : -1;
          if (bareCentral && tuning.plan.centralsFirstRemotes) need -= 2;
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
          if (bareCentral && tuning.plan.centralsFirstRemotes && !holdsAgenda) need -= 2;
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
        const rezCost = cardDef(card).cost ?? 0;
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
          if (left > 3 || guards(state, server, corp.credits - spend) === 0 || !this.exposureOk(state, server, corp.credits - spend)) return hq.length > corp.handSizeLimit ? (server.ice.length > 0 ? 0.6 : 0.5) : -2;
        }
        // Only behind ice that is rezzed or that we can afford to rez
        const guarded = guards(state, server, corp.credits);
        return guarded === 0 ? -2 : 8 + Math.min(guarded, 3) * 0.6;
      }
      case 'asset': {
        const econ = econValue(card.cardCode, state);
        if (econ !== undefined) {
          if (server) return -1;
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
    // Conduit: each run on R&D it gets through accesses 1 more card per counter (model, plan.modelHacks.conduit): ice here stops some of them
    fit += hacksOff('conduit') ? Math.min(3, ICE_STOPS * PACE.runs * PACE.conduitRdShare * (1 + counters(conduit, 'virus')) * accessWorth(state)) - ICE_STOPS * PACE.runs * PACE.rdShare * accessWorth(state) : 0.6;
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

// What one virus counter on each card is worth to the Runner, in about credits
const VIRUS_WEIGHT: Record<string, number> = {
  '30024': 1.5, // Conduit: an extra R&D access per counter
  '30017': 1.2, // Tranquilizer: derezzes its host at 3
  '30004': 1, // Botulus: breaks its host's subroutines
  '30008': 0.8, // Leech: lowers ice strength
  '30007': 0.7, // Fermenter: 2 credits per counter, once
  '35008': 0.5, // Hantu
};

/** The Runner's virus counters, weighted by what they do. */
function virusThreat(state: GameState): number {
  return [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].reduce(
    (n, c) => n + counters(c, 'virus') * (hacksOff('purge') ? counterWorth(state, c, 'virus', 'corp') : VIRUS_WEIGHT[c.cardCode] ?? 0.8),
    0
  );
}

/**
 * What the Runner would pay to get into a server, counting rezzed ice and
 * the unrezzed ice `credits` can still rez (8 for ice they can't break).
 */
function entryCost(state: GameState, server: ServerState, credits: number): number {
  let cost = 0;
  for (const ice of server.ice) {
    if (!ice.isRezzed) {
      const rc = rezCost(state, ice);
      if (rc > credits) continue;
      credits -= rc;
    }
    cost += Math.min(8, iceCost(state, { ...ice, isRezzed: true }));
  }
  return cost;
}

/** An asset whose whole worth is what it does when rezzed (Spin Doctor), not a money asset that pays out. */
function onRezOnly(card: CardInstance): boolean {
  return type(card) === 'asset' && !CARD_PROFILES[card.cardCode] && /^When you rez this asset, draw/i.test(cardDef(card).stripped_text ?? '');
}

/**
 * The Runner can't pay its way into the server on its next turn: the ice
 * (rezzed, or that `credits` can still rez) costs more to get through than
 * it has plus a turn's income (plan.exposureByCost).
 */
export function outOfReach(state: GameState, server: ServerState, credits: number): boolean {
  // exposureNoIncome: only what the Runner holds now (it must spend clicks on money first)
  return entryCost(state, server, credits) > state.runner.credits + (tuning.plan.exposureNoIncome ? 0 : STEAL.income);
}

/**
 * Layers of ice on a server as the Runner sees them: rezzed ice counts by
 * what it costs them to get through (1 credit or less: not there at all,
 * 3 or more: a full layer); unrezzed ice counts in full.
 */
export function iceDepth(state: GameState, server: ServerState): number {
  return server.ice.reduce((n, ice) => n + (ice.isRezzed ? Math.min(1, Math.max(0, (iceCost(state, ice) - 1) / 2)) : 1), 0);
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
    (n, ice) => n + (ice.isRezzed ? Math.min(1, Math.max(0, (iceCost(state, ice) - 1) / 2)) : affordable.has(ice.instanceId) ? 1 : 0),
    0
  );
}

/**
 * What losing this agenda would cost: its points, a lot more if the steal
 * would win the game for the Runner, and a little for each advancement
 * counter on it (it is that much closer to being scored). About 1 to 7.
 */
export function agendaStakes(state: GameState, agenda: CardInstance): number {
  const points = cardDef(agenda).agenda_points ?? 1;
  return points + (state.runner.score + points >= 7 ? 3 : 0) + 0.25 * Math.min(agenda.advancementCounters, 4);
}

/** Installed agendas with enough counters to score. */
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
  for (const card of corp.hq) {
    if (type(card) !== 'ice') continue;
    for (const server of Object.values(corp.servers)) {
      if (corp.credits < server.ice.length - 1) continue;
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
