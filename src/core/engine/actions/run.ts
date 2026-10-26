import { ContinueRunAction, InitiateRunAction, JackOutAction } from '../../types/actions';
import { CardInstance } from '../../types/card';
import { GameState, LogEntry, RunEffectSource, ServerState } from '../../types/state';
import { cardDef } from '../../cards';
import { getCardScript } from '../../scripts';
import { nextInt } from '../../rng';
import { addLog } from '../log';
import { checkAgendaVictory, findCardAnywhere, illegal, locateCorpCard, removeCard, requireActionPhase, requireClicks } from '../helpers';
import { pushPrompt } from '../prompts';
import { approachIce, approachServer, beginEncounter, passIce, startSubroutineResolution } from '../ice';
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
  if (iceCount > 0) approachIce(state, iceCount - 1);
  else approachServer(state);
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
  } else if (run.phase === 'approach_server') {
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
}

/**
 * The Runner may jack out during the movement phase, i.e. after passing at
 * least one piece of ice and before encountering the next one or breaching.
 */
export function jackOut(state: GameState, action: JackOutAction): void {
  if (action.player !== 'runner') illegal('Only the Runner can jack out');
  const run = state.activeRun;
  if (!run) illegal('No active run');
  if (!['approach_ice', 'approach_server'].includes(run.phase) || run.icePassed === 0) {
    illegal('You can only jack out after passing a piece of ice');
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
 * Queues every card the breach reaches: root cards of any server, plus
 * random cards from HQ, cards from the top of R&D, or all of Archives.
 * Candidates are fixed before anything moves, so stealing a card can't
 * cause another to be skipped. Accessing pauses whenever a prompt is
 * pending; resumeRun() picks it up again.
 */
function breachServer(state: GameState, server: ServerState): void {
  state.activeRun!.breached = true;
  const ids = server.root.map(card => card.instanceId);

  if (server.id === 'hq') {
    const count = 1 + breachBonus(state, 'hq');
    bumpTurnFlag(state, TurnFlag.hqBreaches);
    const pool = [...state.corp.hq];
    for (let i = 0; i < count && pool.length > 0; i++) {
      ids.push(pool.splice(nextInt(state.rng, pool.length), 1)[0].instanceId);
    }
  } else if (server.id === 'rd') {
    const count = 1 + breachBonus(state, 'rd');
    ids.push(...state.corp.rd.slice(0, count).map(card => card.instanceId));
  } else if (server.id === 'archives') {
    // Breaching Archives turns all its cards face up.
    state.corp.archives.faceUp.push(...state.corp.archives.faceDown);
    state.corp.archives.faceDown = [];
    ids.push(...state.corp.archives.faceUp.map(card => card.instanceId));
  }

  state.activeRun!.accessQueue = ids;
}

/** Marks an access queue entry that continues an access paused by a "when accessed" prompt. */
const RESUME = 'resume:';

/** Accesses queued cards until something needs a decision, then ends the run. */
export function continueAccess(state: GameState): void {
  const run = state.activeRun;
  if (run && !run.breached) {
    if (state.pendingPrompts.length > 0 || state.winner) return;
    breachServer(state, state.corp.servers[run.server]);
  }
  while (state.activeRun && state.activeRun.accessQueue.length > 0) {
    if (state.pendingPrompts.length > 0 || state.winner) return;
    const next = state.activeRun.accessQueue.shift()!;
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
