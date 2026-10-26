import { ContinueRunAction, InitiateRunAction, JackOutAction } from '../../types/actions';
import { CardInstance } from '../../types/card';
import { GameState, LogEntry, RunEffectSource, ServerState } from '../../types/state';
import { cardDef } from '../../cards';
import { getCardScript } from '../../scripts';
import { nextInt } from '../../rng';
import { addLog } from '../log';
import { checkAgendaVictory, findCardAnywhere, illegal, locateCorpCard, removeCard, requireActionPhase, requireClicks } from '../helpers';
import { pushPrompt } from '../prompts';
import { approachIce, approachServer, beginEncounter, enterMovement, moveInward, passIce, startSubroutineResolution } from '../ice';
import { endRun } from '../runEnd';
import { activeCards, fireTrigger } from '../triggers';
import { AccessZone } from '../../scripts/types';
import { availableCredits, bumpTurnFlag, trashCost, TurnFlag } from '../cardEffects';
import { RunState } from '../../types/state';

export function initiateRun(state: GameState, action: InitiateRunAction): void {
  if (action.player !== 'runner') illegal('Only Runner can initiate runs');
  requireActionPhase(state, 'runner');
  requireClicks(state, 'runner');
  if (!state.corp.servers[action.targetServerId]) illegal('Invalid target server');
  state.runner.clicks -= 1;
  startRun(state, action.targetServerId);
}

export interface RunOptions {
  /** A card whose "if successful" effect applies to this run. */
  source?: RunEffectSource;
  iceRezCostIncrease?: number;
  bonusCredits?: number;
  /** The run event that starts this run (for "while a run event is active"). */
  eventCode?: string;
  /** Shred: the first time the Corp would end the run, they must trash cards from HQ. */
  shred?: boolean;
  /** Maintenance Access: at Archives, approach HQ instead. */
  redirectToHq?: boolean;
}

function newRunState(serverId: string, options: RunOptions): RunState {
  return {
    server: serverId,
    phase: 'initiation',
    icePosition: null,
    isSuccessful: false,
    isJackedOut: false,
    cannotJackOut: false,
    accessQueue: [],
    encounter: null,
    icePassed: 0,
    cannotStealOrTrash: false,
    trashAtRunEnd: [],
    runEffects: options.source ? [options.source] : [],
    extraAccesses: 0,
    accessedCount: 0,
    stoleAgenda: false,
    iceRezCostIncrease: options.iceRezCostIncrease ?? 0,
    bonusCredits: options.bonusCredits ?? 0,
    persistentIds: [],
    persistentServers: {},
    subroutineResolved: false,
    accessed: [],
    breached: false,
    shredArmed: options.shred ?? false,
    redirectToHq: options.redirectToHq ?? false,
    eventCode: options.eventCode ?? null,
    runBoosts: {},
    accessOnly: false,
    serverApproached: false,
  };
}

/** Starts a run (no click spent here; the basic action or the card effect pays for it). */
export function startRun(state: GameState, serverId: string, options: RunOptions = {}): void {
  const targetServer = state.corp.servers[serverId];
  if (!targetServer) illegal('Invalid target server');
  const iceCount = targetServer.ice.length;

  addLog(state, 'runner', `Runner initiated a run on ${targetServer.name}!`);

  state.runsThisTurn.push({ server: targetServer.id, successful: false });
  state.activeRun = newRunState(targetServer.id, options);
  state.phase = 'run';
  fireTrigger(state, { type: 'run_begins', server: targetServer.id });
  if (!state.activeRun) return;
  // With no ice the run goes straight to the Movement Phase, where the Runner may still jack out (rules 6.1.5b)
  if (iceCount > 0) approachIce(state, iceCount - 1);
  else enterMovement(state);
}

export function continueRun(state: GameState, action: ContinueRunAction): void {
  if (action.player !== 'runner') illegal('Only the Runner can continue a run');
  const run = state.activeRun;
  if (!run) illegal('No active run');
  const server = state.corp.servers[run.server];

  if (run.phase === 'approach_ice') {
    // The Corp's rez window for this ice is before the Runner continues.
    const currentIce = server.ice[run.icePosition!];
    if (currentIce && currentIce.isRezzed) {
      beginEncounter(state, currentIce);
    } else {
      addLog(state, 'runner', `Passed unrezzed Ice position ${run.icePosition! + 1}.`);
      passIce(state);
    }
  } else if (run.phase === 'encounter_ice') {
    // Done breaking: unbroken subroutines resolve, then the ice is passed.
    if (run.encounter?.resolvingIndex != null) illegal('Subroutines are already resolving');
    startSubroutineResolution(state);
  } else if (run.phase === 'movement') {
    moveInward(state);
  } else if (run.phase === 'approach_server') {
    if (!run.serverApproached) {
      // The Corp's last chance to rez was before this; now the Runner approaches the server
      approachServer(state);
      if (state.pendingPrompts.length > 0 || state.winner || state.activeRun !== run) return;
    }
    succeedRun(state);
  }
}

/** The Success Phase: the run is declared successful and the Runner breaches the server (rules 6.9.5). */
export function succeedRun(state: GameState): void {
  const run = state.activeRun;
  if (!run || run.phase !== 'approach_server') return;
  const server = state.corp.servers[run.server];
  run.phase = 'access';
  run.isSuccessful = true;
  state.runsThisTurn[state.runsThisTurn.length - 1].successful = true;
  addLog(state, 'runner', `Run successful on ${server.name}! Accessing cards.`);
  fireTrigger(state, { type: 'successful_run', server: server.id });
  for (const source of run.runEffects) {
    const card = findCardAnywhere(state, source.instanceId);
    if (card) getCardScript(source.cardCode)?.onRunSuccessful?.({ state, card, side: 'runner' });
  }
  if (state.winner || !state.activeRun) return;
  // "Whenever you breach" abilities (Devadatta Drone) resolve before cards are chosen
  fireTrigger(state, { type: 'breach_server', server: server.id });
  if (state.winner || !state.activeRun) return;
  continueAccess(state);
}

/**
 * The Runner may jack out only in the Movement Phase: after passing a piece
 * of ice, or before approaching a server with no ice, and before the Corp's
 * next chance to rez (rules 6.1.5, 6.9.4c).
 */
export function jackOut(state: GameState, action: JackOutAction): void {
  if (action.player !== 'runner') illegal('Only the Runner can jack out');
  const run = state.activeRun;
  if (!run) illegal('No active run');
  if (run.phase !== 'movement') {
    illegal('You can only jack out after passing a piece of ice, or before approaching a server with no ice');
  }
  addLog(state, 'runner', 'Runner jacked out. Run ended unsuccessfully.');
  endRun(state);
}

/** Extra accesses for this breach: from the run (Jailbreak, Conduit) and installed cards (Docklands Pass). */
function breachBonus(state: GameState, serverId: string): number {
  const fromCards = activeCards(state, 'runner').reduce(
    (n, c) => n + (getCardScript(c.cardCode)?.modifiers?.breachAccesses?.(state, c, serverId) ?? 0),
    0
  );
  return state.activeRun!.extraAccesses + fromCards;
}

/**
 * Begins the breach: sets out the candidates the Runner will choose from
 * (rules 7.4.1) and the random access limit for HQ or R&D (7.3.5). Breaching
 * Archives turns all its cards face up first (7.3.2).
 */
function breachServer(state: GameState, server: ServerState): void {
  const run = state.activeRun!;
  run.breached = true;
  let zone: 'hq' | 'rd' | 'archives' | null = null;
  let zoneLeft = 0;
  if (server.id === 'hq') {
    zone = 'hq';
    zoneLeft = 1 + breachBonus(state, 'hq');
    bumpTurnFlag(state, TurnFlag.hqBreaches);
  } else if (server.id === 'rd') {
    zone = 'rd';
    zoneLeft = 1 + breachBonus(state, 'rd');
  } else if (server.id === 'archives') {
    state.corp.archives.faceUp.push(...state.corp.archives.faceDown);
    state.corp.archives.faceDown = [];
    zone = 'archives';
    zoneLeft = -1;
  }
  run.breach = { root: server.root.map(card => card.instanceId), zone, zoneLeft, chosen: [] };
}

/** The zone's cards the Runner may still choose: HQ (at random), R&D (topmost first) or Archives, not yet chosen. */
function zoneCandidates(state: GameState): string[] {
  const breach = state.activeRun?.breach;
  if (!breach?.zone || breach.zoneLeft === 0) return [];
  const cards =
    breach.zone === 'hq'
      ? state.corp.hq
      : breach.zone === 'rd'
        ? state.corp.rd
        : [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];
  return cards.map(c => c.instanceId).filter(id => !breach.chosen.includes(id));
}

/** The choices the Runner has for the next access of the breach (rules 7.3.4). */
export function breachOptions(state: GameState): { id: string; label: string }[] {
  const run = state.activeRun;
  const breach = run?.breach;
  if (!run || !breach) return [];
  const server = state.corp.servers[run.server];
  const options: { id: string; label: string }[] = [];
  // A root card that left the server is no longer a candidate (7.4.5)
  for (const id of breach.root) {
    const card = server?.root.find(c => c.instanceId === id);
    if (!card) continue;
    const seen = card.isRezzed || card.faceUp;
    const place = server.root.indexOf(card) + 1;
    options.push({ id: `root:${id}`, label: seen ? `${cardDef(card).title} (in the root)` : `Unrezzed card in the root (${ordinal(place)} installed)` });
  }
  if (zoneCandidates(state).length > 0) {
    const label = breach.zone === 'hq' ? 'A random card from HQ' : breach.zone === 'rd' ? 'The top card of R&D' : 'A card in Archives';
    options.push({ id: breach.zone!, label });
  }
  return options;
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** Takes the Runner's choice of candidate and queues it for access. */
export function chooseBreachCandidate(state: GameState, optionId: string): void {
  const run = state.activeRun;
  const breach = run?.breach;
  if (!run || !breach) illegal('No breach in progress');
  if (!breachOptions(state).some(o => o.id === optionId)) illegal('That card cannot be chosen now');
  if (optionId.startsWith('root:')) {
    const id = optionId.slice('root:'.length);
    breach.root = breach.root.filter(r => r !== id);
    run.accessQueue.push(id);
    return;
  }
  const candidates = zoneCandidates(state);
  // HQ: at random among the cards not chosen yet; R&D: the topmost card not chosen yet (7.4.7a)
  const id = breach.zone === 'hq' ? candidates[nextInt(state.rng, candidates.length)] : candidates[0];
  breach.chosen.push(id);
  if (breach.zoneLeft > 0) breach.zoneLeft -= 1;
  run.accessQueue.push(id);
}

/** Marks an access queue entry that continues an access paused by a "when accessed" prompt. */
const RESUME = 'resume:';

/**
 * Accesses cards until something needs a decision, then ends the run. The
 * Runner chooses each breach candidate when there is more than one to
 * choose from; queued cards (a paused access, Detente) go first.
 */
export function continueAccess(state: GameState): void {
  const run = state.activeRun;
  if (run && !run.breached) {
    if (state.pendingPrompts.length > 0 || state.winner) return;
    breachServer(state, state.corp.servers[run.server]);
  }
  while (state.activeRun) {
    if (state.pendingPrompts.length > 0 || state.winner) return;
    const current = state.activeRun;
    if (current.accessQueue.length === 0) {
      const options = breachOptions(state);
      if (options.length === 0) break;
      if (options.length > 1) {
        pushPrompt(state, { kind: 'access_order', side: 'runner', options, message: 'Runner: which card do you access next?' });
        return;
      }
      chooseBreachCandidate(state, options[0].id);
    }
    const next = current.accessQueue.shift()!;
    if (next.startsWith(RESUME)) {
      resumePausedAccess(state, next.slice(RESUME.length));
      continue;
    }
    const found = locateCorpCard(state, next);
    if (!found) continue;
    accessCard(state, found.card, found.zone, found.inArchives);
  }
  if (state.pendingPrompts.length > 0 || state.winner || !state.activeRun) return;
  endRun(state);
}

/**
 * Resolves one access: "when accessed" effects, then one optional
 * mid-access ability (basic trash or e.g. Carnivore, via a prompt), then
 * stealing if it is an agenda. When a prompt is needed, the rest of the
 * access happens in finishAccess() after the answer.
 */
function accessCard(state: GameState, card: CardInstance, zone: CardInstance[], inArchives: boolean): void {
  const def = cardDef(card);
  const run = state.activeRun!;
  run.accessedCount += 1;
  run.accessed.push({ id: card.instanceId, inArchives });
  const installed = Object.values(state.corp.servers).some(s => s.root.includes(card) || s.ice.includes(card));
  const where: AccessZone = installed ? 'installed' : inArchives ? 'archives' : zone === state.corp.hq ? 'hq' : 'rd';
  // Rules 7.1.2: the Corp may look at accessed cards, except those accessed from R&D (unless revealed, Byte!)
  const secret = getCardScript(card.cardCode)?.revealedOnRdAccess ? undefined : rdSecret(where, 'Runner accessed a card in R&D.');
  addLog(state, 'runner', `Runner accessed ${def.title}.`, card.cardCode, 'access', secret);
  getCardScript(card.cardCode)?.onAccessed?.({ state, card, side: 'corp' }, where);
  if (state.winner || !state.activeRun) return;
  fireTrigger(state, { type: 'card_accessed', card, where });
  if (state.winner || !state.activeRun) return;
  if (state.pendingPrompts.length > 0) {
    // Let the "when accessed" decision resolve first; this card's access resumes afterwards.
    run.accessQueue.unshift(RESUME + card.instanceId);
    return;
  }
  offerMidAccess(state, card, zone, inArchives);
}

/** Keeps the name of a card accessed from R&D from the Corp (rules 7.1.2). */
function rdSecret(where: AccessZone | 'other', publicMessage: string): LogEntry['secret'] {
  return where === 'rd' ? { from: 'corp', publicMessage } : undefined;
}

function offerMidAccess(state: GameState, card: CardInstance, zone: CardInstance[], inArchives: boolean): void {
  const def = cardDef(card);
  const blocked = state.activeRun!.cannotStealOrTrash;
  const cost = trashCost(state, card);
  const canBasicTrash =
    !blocked &&
    !inArchives &&
    def.type_code !== 'agenda' &&
    cost != null &&
    availableCredits(state, 'runner', { kind: 'trash', card }) >= cost;
  const alternatives = blocked || inArchives ? [] : accessAlternatives(state, card);

  if (canBasicTrash || alternatives.length > 0) {
    pushPrompt(state, {
      kind: 'access_trash',
      side: 'runner',
      cardInstanceId: card.instanceId,
      trashCost: canBasicTrash ? cost! : null,
      alternatives,
      message: canBasicTrash
        ? `Runner: pay ${cost} [credit] to trash ${def.title}?`
        : `Runner: use an ability on ${def.title}?`,
    });
    return;
  }
  finishAccess(state, card, zone);
}

/** Mid-access abilities installed cards offer for this card. */
export function accessAlternatives(state: GameState, accessed: CardInstance): { id: string; label: string }[] {
  return activeCards(state, 'runner').flatMap(c => {
    const ability = getCardScript(c.cardCode)?.accessAbility;
    return ability && ability.canUse({ state, card: c, side: 'runner' }, accessed)
      ? [{ id: c.instanceId, label: `${cardDef(c).title}: ${ability.label}` }]
      : [];
  });
}

/** Re-enters an access that paused for a "when accessed" decision. */
export function resumePausedAccess(state: GameState, instanceId: string): void {
  const found = locateCorpCard(state, instanceId);
  if (found) offerMidAccess(state, found.card, found.zone, found.inArchives);
}

/** After any mid-access ability: an agenda still being accessed is stolen. */
export function finishAccess(state: GameState, card: CardInstance, zone: CardInstance[]): void {
  const def = cardDef(card);
  if (def.type_code !== 'agenda' || !zone.includes(card)) return;
  if (state.activeRun?.cannotStealOrTrash) {
    addLog(
      state,
      'runner',
      `Runner accessed ${def.title} but cannot steal it this run.`,
      undefined,
      undefined,
      rdSecret(zone === state.corp.rd ? 'rd' : 'other', ''),
    );
    return;
  }
  stealAgenda(state, card, zone);
}

function stealAgenda(state: GameState, card: CardInstance, zone: CardInstance[]): void {
  const def = cardDef(card);
  removeCard(zone, card);
  card.isRezzed = true;
  delete card.faceUp;
  card.advancementCounters = 0;
  state.runner.scoreArea.push(card);
  const pts = def.agenda_points || 0;
  state.runner.score += pts;
  if (state.activeRun) state.activeRun.stoleAgenda = true;
  addLog(state, 'runner', `Runner accessed and stole ${def.title} for ${pts} agenda point(s)! Total: ${state.runner.score}`);
  checkAgendaVictory(state);
  if (state.winner) return;
  // A stolen agenda is inactive, except for its own "when stolen" ability.
  fireTrigger(state, { type: 'agenda_stolen', card }, [card]);
}

/** Trashes the card being accessed (basic trash ability or e.g. Carnivore). */
export function trashAccessedCard(state: GameState, card: CardInstance): void {
  const found = locateCorpCard(state, card.instanceId);
  if (!found) return;
  const server = Object.values(state.corp.servers).find(s => s.root.includes(card) || s.ice.includes(card));
  const wasRezzed = card.isRezzed;
  runnerTrashCorpCard(state, card);
  const run = state.activeRun;
  if (run && server && getCardScript(card.cardCode)?.persistent) {
    run.persistentIds.push(card.instanceId);
    run.persistentServers[card.instanceId] = server.id;
  }
  bumpTurnFlag(state, TurnFlag.accessTrashes);
  fireTrigger(state, { type: 'trashed_on_access', card });
  fireTrigger(state, { type: 'runner_trashed_corp_card', card, wasInstalled: !!server, wasRezzed }, [card]);
}

/**
 * Moves a Corp card the Runner trashes to Archives face up (from a server,
 * HQ or R&D). Programs hosted on it go to the heap. Fires no triggers.
 */
function runnerTrashCorpCard(state: GameState, card: CardInstance): void {
  const found = locateCorpCard(state, card.instanceId);
  if (!found) return;
  removeCard(found.zone, card);
  for (const hostedId of card.hostedCardIds) {
    const hosted = state.runner.rig.programs.find(c => c.instanceId === hostedId);
    if (!hosted) continue;
    removeCard(state.runner.rig.programs, hosted);
    state.runner.memoryUnitsUsed -= cardDef(hosted).memory_cost || 0;
    hosted.hostedOnId = undefined;
    hosted.tokens = {};
    state.runner.heap.push(hosted);
  }
  card.hostedCardIds = [];
  card.isRezzed = false;
  card.faceUp = false;
  delete card.runnerKnows;
  card.advancementCounters = 0;
  card.tokens = {};
  state.corp.archives.faceUp.push(card);
}

/** The Runner trashes an installed Corp card with a card ability (Charm Offensive). */
export function runnerTrashInstalledCorpCard(state: GameState, card: CardInstance): void {
  const wasRezzed = card.isRezzed;
  runnerTrashCorpCard(state, card);
  addLog(state, 'runner', `Runner trashed ${cardDef(card).title}.`);
  fireTrigger(state, { type: 'runner_trashed_corp_card', card, wasInstalled: true, wasRezzed }, [card]);
}

/**
 * The Runner accesses cards outside of a run (Detente). Uses a run state
 * that is not a run: no run abilities apply and it is not counted as a run.
 */
export function accessOutsideRun(state: GameState, ids: string[]): void {
  if (state.activeRun || ids.length === 0) return;
  const access = newRunState('hq', {});
  access.phase = 'access';
  access.accessOnly = true;
  access.breached = true;
  access.accessQueue = ids;
  state.activeRun = access;
  continueAccess(state);
}
