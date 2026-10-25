import { CardInstance, GameAction, GameState, ServerState, activePrompt, cardDef, findCardAnywhere, getCardDefinition, getLegalActions, isLegalAction } from '../core';
import { iceScript, iceSubtypes } from '../core/engine/ice';
import { rigCoverage } from './evaluate';
import { counters, rezCost } from '../core/engine/cardEffects';
import { Agent, ScoredAction } from './agent';
import { evaluate } from './evaluate';
import { answerPrompt, simulate } from './prompts';
import { logNudge, nudge, opponentLean, tuning } from './synergy';
import { isTrap } from './runs';
import { cardSynergy } from './synergyTags';

const FREE_ACTION_LIMIT = 6;

// Assets worth installing in their own remote and rezzing for money or cards (by code).
const ECON_ASSETS: Record<string, number> = {
  '30071': 4, // Regolith Mining License
  '30037': 3.5, // Nico Campaign
  '30053': 1.5, // Spin Doctor
  '35072': 4, // Anthill Excavation Contract
  '35040': 3.5, // Otto Campaign
  '35062': 2.5, // Public Access Plaza
  '35039': 2, // Humanoid Resources
};
// Upgrades: [value in a scoring remote, value on HQ or R&D]
const UPGRADES: Record<string, [number, number]> = {
  '30042': [2.5, 2], // Manegarm Skunkworks
  '30050': [1.5, 0.8], // Anoetic Void
  '30058': [1.5, 0], // AMAZE Amusements
  '30066': [1.5, 0], // Malapert Data Vault
  '35082': [2, 0.5], // Mahkota Langit Grid
  '35056': [1.5, 1.2], // Mitra Aman
  '35045': [1, 1], // Mercia B4LL4RD
};

const type = (card: CardInstance) => cardDef(card).type_code;
const hasEndTheRun = (ice: CardInstance) => (iceScript(ice)?.subroutines ?? []).some(s => /end the run/i.test(s.label));
const isAgendaOrAsset = (card: CardInstance) => ['agenda', 'asset'].includes(type(card));
/** "Dividends N": agenda counters per advancement counter beyond the requirement (0: none). */
const dividends = (card: CardInstance) => Number(/dividends (\d+)/i.exec(cardDef(card).stripped_text ?? '')?.[1] ?? 0);

export interface HeuristicOptions {
  /** Deck-aware nudges and opponent reading (synergy.ts). Off: the AI as it was before them. */
  synergy?: boolean;
  /** Log each move's synergy reasons to the console. */
  debug?: boolean;
}

/**
 * Rule-based Corp: builds money, ices its centrals, sets up a remote with
 * ice to score agendas from, and rezzes ice when the Runner comes in.
 */
export class HeuristicCorpAI implements Agent {
  readonly side = 'corp' as const;
  private freeActions = 0;
  private freeKey = '';
  readonly synergy: boolean;
  private debug: boolean;

  constructor(options: HeuristicOptions = {}) {
    this.synergy = options.synergy ?? true;
    this.debug = options.debug ?? false;
  }

  /** Round 3: keep rez money for R&D and HQ as well as agenda remotes. */
  private get wideReserve() {
    return this.synergy && tuning.plan.rezMoney;
  }

  private get timing() {
    return this.synergy && tuning.plan.agendaTiming;
  }

  chooseAction(state: GameState): GameAction {
    if (activePrompt(state)) return answerPrompt(state, 'corp', undefined, this.synergy);
    const legal = getLegalActions(state, 'corp');
    const ranked = this.rankMainActions(state, legal);
    const chosen = ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0];
    this.notePlayed(chosen);
    if (this.debug) logNudge(state, 'corp', chosen);
    return chosen;
  }

  /** Counts actions in a row that spent no click (loop guard). */
  notePlayed(action: GameAction) {
    if (action.type !== 'END_TURN') this.freeActions++;
  }

  /** Main-phase actions, best first, with this AI's score for each (the search AI starts from these). */
  rankMainActions(state: GameState, legal = getLegalActions(state, 'corp')): ScoredAction[] {
    const key = `${state.turnNumber}|${state.corp.clicks}`;
    if (key !== this.freeKey) {
      this.freeKey = key;
      this.freeActions = 0;
    }
    const before = evaluate(state, 'corp', this.synergy);
    return legal
      .map(action => {
        let score = this.score(state, action, before);
        // Deck-aware nudge: small, and only for moves the AI would consider anyway
        if (this.synergy && Number.isFinite(score) && score < 40 && action.type !== 'END_TURN') score += nudge(state, 'corp', action).bonus;
        return { action, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  chooseRez(state: GameState, cards: CardInstance[]): GameAction | null {
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
        score = importance + (hasEndTheRun(card) ? 1 : 0) + (card.cardCode === '30055' ? 2 : 0);
        if (state.corp.credits - cost < 2 && importance < 4) score -= 2;
      } else if (def.type_code === 'upgrade') {
        score = card.cardCode === '30042' || card.cardCode === '30050' ? importance : importance - 2;
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

  private score(state: GameState, action: GameAction, before: number): number {
    const corp = state.corp;
    switch (action.type) {
      case 'END_TURN':
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
        return this.installScore(state, card, server) - (action.faceUp ? 0.5 : 0) - reservePenalty(state, corp.credits - installCost, this.wideReserve);
      }
      case 'REZ_CARD': {
        if (state.activeRun) return -Infinity;
        const card = Object.values(corp.servers).flatMap(s => s.root).find(c => c.instanceId === action.cardInstanceId);
        if (!card) return -Infinity; // ice waits for a run
        if (ECON_ASSETS[card.cardCode]) return ECON_ASSETS[card.cardCode] + 1;
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
            return 1.5;
          case '35045': // Mercia B4LL4RD
          case '35056': // Mitra Aman
            return 1;
        }
        return -Infinity;
      }
    }
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
    if (!spendsClick && this.freeActions >= FREE_ACTION_LIMIT) return -Infinity;
    // Follow our own prompts (Predictive Planogram, Seamless Launch) a few steps.
    let resolved = after;
    for (let i = 0; i < 3 && activePrompt(resolved)?.side === 'corp'; i++) {
      const next = simulate(resolved, answerPrompt(resolved, 'corp', undefined, this.synergy));
      if (!next) break;
      resolved = next;
    }
    let score = evaluate(resolved, 'corp', this.synergy) - before;
    // Deck-aware AI: a play that makes an agenda scoreable this turn (Seamless Launch, Key Performance Indicators...)
    if (this.synergy && tuning.plan.scoreSetup && scoreable(resolved) > scoreable(state)) score = Math.max(score, 41);
    if (!spendsClick && score <= 0.3) return -Infinity;
    score -= reservePenalty(state, resolved.corp.credits, this.wideReserve);
    return score;
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
        const finish = agendas.some(a => need(a) > corp.clicks && need(a) <= clicksAfter && corp.credits - 4 >= need(a));
        return finish ? 42 : -Infinity;
      }
      case '35067': {
        // Touch-ups (2 clicks, 2 credits): 2 advancements, best when they finish an agenda
        const clicksAfter = corp.clicks - 2;
        if (clicksAfter < 0 || corp.credits < 2) return -Infinity;
        const finish = agendas.some(a => need(a) <= 2 + Math.min(clicksAfter, corp.credits - 2) && need(a) > 0);
        return finish ? 41 : 0;
      }
      case '35044': {
        // Top-Down Solutions: 2 cards and up to 2 installs for 1 click
        const installable = corp.hq.filter(c => ['ice', 'asset', 'upgrade', 'agenda'].includes(type(c))).length;
        return corp.credits >= 3 && installable >= 1 && corp.hq.length <= corp.handSizeLimit ? 1.3 : 0;
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
        const spend = Math.min(corp.clicks, corp.credits);
        if (need - spend > 3 || guards(state, server, corp.credits - spend) === 0) return -Infinity;
        return 6 + card.advancementCounters; // and then finish the job: a half-advanced agenda is the Runner's best target
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
    if (card.cardCode === '35076' && card.advancementCounters < 3 && corp.credits >= 4) return 0.8;
    return card.cardCode === '30063' && card.advancementCounters < 3 && corp.credits >= 8 ? 1 : -Infinity;
  }

  /**
   * Extra reason to advance a trap: an Urtica Cipher that would flatline
   * the Runner's current hand, or (once the Runner has seen this Corp's
   * traps) a bare trap that would otherwise read as an obvious bluff.
   */
  private trapBluff(state: GameState, card: CardInstance): number {
    if (card.cardCode === '30045' && 2 + card.advancementCounters + 1 >= state.runner.grip.length) return 1.5;
    const shown = state.corp.archives.faceUp.some(c => isTrap(c.cardCode));
    return shown && card.advancementCounters === 0 ? 0.6 : 0;
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
    if (cost > 3 || corp.credits < cost + 1) return false;
    if (!corp.archives.faceUp.some(c => isTrap(c.cardCode))) return false;
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
        let need: number;
        if (!server) need = agendasInHand > 0 && !protectedEmptyRemote ? 5 : -1;
        else if (server.isRemote) {
          const holdsAgenda = server.root.some(c => type(c) === 'agenda' || c.advancementCounters > 0);
          const holdsAsset = server.root.some(c => type(c) === 'asset');
          if (holdsAgenda) {
            need = server.ice.length < 2 ? 7 : 3;
            // Deck-aware AI: guard a key agenda (more points, or one that would win them the game) harder
            const agenda = server.root.find(c => type(c) === 'agenda');
            if (this.synergy && tuning.plan.agendaStakes && agenda) need *= 0.7 + 0.15 * agendaStakes(state, agenda);
          }
          else if (holdsAsset) {
            need = server.ice.length === 0 ? 1.5 : 0.2;
            // Deck-aware AI: one cheap ice sells a trap as an agenda
            const trap = server.root.some(c => !c.isRezzed && isTrap(c.cardCode));
            if (this.synergy && tuning.bluff && trap && server.ice.length === 0 && (cardDef(card).cost ?? 0) <= 3) need += 0.6;
          }
          else need = agendasInHand > 0 ? (server.ice.length < 2 ? 3 : 1) : 0.3;
        } else if (server.id === 'archives') {
          need = server.ice.length === 0 && corp.archives.faceDown.length > 0 ? 1.2 : -0.5;
        } else {
          need = (server.ice.length === 0 ? 4 : server.ice.length === 1 ? 2 : 0.6) + (server.id === 'rd' ? 0.3 : 0);
          if (this.synergy && tuning.plan.centralIce) {
            // Deck-aware AI: R&D always holds agendas; HQ only matters while it does
            if (server.id === 'rd') need += 0.4;
            else if (agendasInHand === 0) need -= server.ice.length === 0 ? 1.5 : 0.8;
          }
        }
        const rezCost = cardDef(card).cost ?? 0;
        const strength = cardDef(card).strength ?? 0;
        return (
          need -
          0.8 * installCost +
          (hasEndTheRun(card) ? 1 : 0) +
          0.15 * Math.min(strength, 5) -
          (corp.credits - installCost < rezCost ? 1.5 : 0) +
          (this.synergy && tuning.plan.icePlacement ? iceFit(state, card, server, tuning.plan.agendaStakes) : 0)
        );
      }
      case 'agenda': {
        const def = cardDef(card);
        const finishNow = (def.advancement_cost ?? 0) <= corp.clicks - 1 && (def.advancement_cost ?? 0) <= corp.credits;
        // A naked remote only to dodge a discard (or to score it straight away)
        if (!server) {
          if (finishNow) return 44;
          if (hq.length > corp.handSizeLimit) return 0.5;
          return this.synergy && tuning.bluff && this.nakedAgenda(state, card) ? 5 : -2;
        }
        if (server.root.some(isAgendaOrAsset)) return -Infinity;
        if (finishNow) return 45;
        if (this.timing) {
          // Deck-aware AI: install only if this turn's advances leave it scoreable next turn, behind ice we can still rez
          const spend = Math.min(corp.clicks - 1, corp.credits);
          const left = (def.advancement_cost ?? 0) - spend;
          if (left > 3 || guards(state, server, corp.credits - spend) === 0) return hq.length > corp.handSizeLimit ? 0.5 : -2;
        }
        // Only behind ice that is rezzed or that we can afford to rez
        const guarded = guards(state, server, corp.credits);
        return guarded === 0 ? -2 : 8 + Math.min(guarded, 3) * 0.6;
      }
      case 'asset': {
        const econ = ECON_ASSETS[card.cardCode];
        if (econ !== undefined) {
          if (server) return -1;
          const rezCost = cardDef(card).cost ?? 0;
          return econ - (corp.credits < rezCost ? 1.5 : 0) - (remotes.length >= 4 ? 1 : 0);
        }
        // Traps and Clearinghouse: bluff in a new remote, or an empty protected one
        if (!server) return remotes.length >= 4 ? 0.2 : 1.2;
        if (server.root.some(isAgendaOrAsset)) return -Infinity;
        // Deck-aware AI: a trap behind ice looks like the real thing
        const sell = this.synergy && tuning.bluff && isTrap(card.cardCode) && server.ice.length > 0 ? 0.5 : 0;
        return (server.ice.length > 0 && agendasInHand === 0 ? 1.8 : 0.5) + sell;
      }
      case 'upgrade': {
        const values = UPGRADES[card.cardCode] ?? [1, 0.5];
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
  if (server.id === 'rd' && state.runner.rig.programs.some(p => p.cardCode === '30024')) fit += 0.6; // Conduit
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
  if (server.root.some(c => c.isRezzed && ECON_ASSETS[c.cardCode])) return 3;
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
function rezReserve(state: GameState, wide = false): number {
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
  return after > before ? Math.min(3, after - before) : -Math.min(1, 0.4 * (before - after));
}
