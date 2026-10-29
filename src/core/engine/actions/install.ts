import { InstallCardAction } from '../../types/actions';
import { GameState } from '../../types/state';
import { cardDef } from '../../cards';
import { getCardScript } from '../../scripts';
import { addLog } from '../log';
import { CardInstance } from '../../types/card';
import { activeCards, fireTrigger } from '../triggers';
import {
  availableCredits,
  bumpTurnFlag,
  enforceInstallLimits,
  installedIce,
  memoryLimit,
  refillRecurring,
  spendCredits,
  TurnFlag,
} from '../cardEffects';
import {
  createRemoteServer,
  illegal,
  runnerSawBeforeInstall,
  removeCard,
  requireActionPhase,
  requireClicks,
  trashInstalledCorpCard,
  turnKey,
} from '../helpers';
import { trashInstalledRunnerCard } from '../damage';

export function installCard(state: GameState, action: InstallCardAction): void {
  requireActionPhase(state, action.player);
  requireClicks(state, action.player);
  if (action.player === 'corp') {
    installCorpCard(state, action);
  } else {
    installRunnerCard(state, action);
  }
}

function installCorpCard(state: GameState, action: InstallCardAction): void {
  const card = state.corp.hq.find(c => c.instanceId === action.cardInstanceId);
  if (!card) illegal('Card not in HQ');
  const newRemote = action.asNewRemote || !action.targetServerId;
  const serverId = newRemote ? null : action.targetServerId!;
  const trash = chosenToTrashFirst(state, card, serverId, action.trashFirst ?? []);
  const blocker = corpInstallBlocker(state, card, serverId, false, iceTrashedDiscount(card, trash));
  if (blocker) illegal(blocker);
  if (action.faceUp && !canInstallFaceUp(state, card)) illegal('This card cannot be installed faceup');
  state.corp.clicks -= 1;
  trashFirst(state, trash);
  installCorpCardFrom(state, card, state.corp.hq, serverId, false, { faceUp: action.faceUp });
}

/**
 * The installed cards a player may trash as part of installing this card
 * (rules 8.5.6): ice protecting the server for ice (8.5.6b), cards in the
 * root for an upgrade, or an agenda or asset in a remote (8.5.6a), and
 * installed programs for a program (8.5.6c). Null server: a new remote.
 */
export function trashableFirst(state: GameState, card: CardInstance, serverId: string | null): CardInstance[] {
  const type = cardDef(card).type_code;
  if (type === 'program') return [...state.runner.rig.programs];
  const server = serverId === null ? undefined : state.corp.servers[serverId];
  if (!server) return [];
  if (type === 'ice') return [...server.ice];
  if (type === 'upgrade' || ((type === 'agenda' || type === 'asset') && server.isRemote)) return [...server.root];
  return [];
}

/** Checks the cards a player chose to trash while installing (see trashableFirst) and returns them. */
export function chosenToTrashFirst(state: GameState, card: CardInstance, serverId: string | null, ids: string[]): CardInstance[] {
  if (ids.length === 0) return [];
  const allowed = trashableFirst(state, card, serverId);
  const chosen = ids.map(id => allowed.find(c => c.instanceId === id));
  if (chosen.some(c => !c) || new Set(ids).size !== ids.length) illegal(`Can't trash those cards to install ${cardDef(card).title}`);
  return chosen as CardInstance[];
}

/** Ice trashed before installing ice doesn't count toward its install cost (rules 8.5.6b). */
export function iceTrashedDiscount(card: CardInstance, trash: CardInstance[]): number {
  return cardDef(card).type_code === 'ice' ? trash.length : 0;
}

/** Programs trashed before installing a program free up their memory (rules 8.5.6c). */
export function freedMemory(trash: CardInstance[]): number {
  return trash.reduce((mu, c) => mu + (cardDef(c).type_code === 'program' ? cardDef(c).memory_cost || 0 : 0), 0);
}

/** Trashes the cards chosen in chosenToTrashFirst(), before the install itself. */
export function trashFirst(state: GameState, trash: CardInstance[]): void {
  for (const card of trash) {
    if (cardDef(card).side_code === 'runner') {
      trashInstalledRunnerCard(state, card);
      addLog(state, 'runner', `Runner trashed ${cardDef(card).title} to make room.`);
      continue;
    }
    const server = Object.values(state.corp.servers).find(s => s.ice.includes(card) || s.root.includes(card));
    if (!server) continue;
    trashInstalledCorpCard(state, server, card);
    const seen = state.corp.archives.faceUp.includes(card);
    addLog(state, 'corp', `Corp trashed ${seen ? cardDef(card).title : 'a card'} in ${server.name} to make room.`);
  }
}

/** BANGUN: agendas may be installed faceup. */
export function canInstallFaceUp(state: GameState, card: CardInstance): boolean {
  if (getCardScript(card.cardCode)?.installFaceUpOnly) return true;
  return cardDef(card).type_code === 'agenda' && !!getCardScript(state.corp.identity.cardCode)?.agendasFaceUp;
}

export interface CorpInstallOptions {
  /** Credits off the install cost (Mercia B4LL4RD). */
  discount?: number;
  /** Install faceup without rezzing (BANGUN agendas). */
  faceUp?: boolean;
}

/** The credits it costs to install this card in that server (ice: 1 per ice already there). */
export function corpInstallCost(state: GameState, card: CardInstance, serverId: string | null, ignoreCosts: boolean, discount = 0): number {
  if (ignoreCosts || cardDef(card).type_code !== 'ice' || serverId === null) return 0;
  return Math.max(0, (state.corp.servers[serverId]?.ice.length ?? 0) - discount);
}

/** Why the Corp can't install this card in that server (null server = new remote), or null if it can. */
export function corpInstallBlocker(
  state: GameState,
  card: CardInstance,
  serverId: string | null,
  ignoreCosts: boolean,
  discount = 0
): string | null {
  const def = cardDef(card);
  if (def.type_code === 'operation') return 'Operations are played, not installed';
  const server = serverId === null ? null : state.corp.servers[serverId];
  if (serverId !== null && !server) return 'Server not found';
  if ((def.type_code === 'agenda' || def.type_code === 'asset') && server && !server.isRemote) {
    return 'Agendas and assets can only be installed in a remote server';
  }
  const only = getCardScript(card.cardCode)?.installOnly;
  if (only === 'central' && (!server || server.isRemote)) return `${def.title} can only be installed in a central server`;
  if (only === 'hq-rd' && server?.id !== 'hq' && server?.id !== 'rd') return `${def.title} can only be installed in HQ or R&D`;
  const cost = corpInstallCost(state, card, serverId, ignoreCosts, discount);
  if (state.corp.credits < cost) return `Need ${cost} credits to install ice on this server`;
  return null;
}

/**
 * Installs a Corp card from any zone into a server (null = new remote),
 * paying the ice install cost unless ignoring costs. No click is spent here.
 */
export function installCorpCardFrom(
  state: GameState,
  card: CardInstance,
  zone: CardInstance[],
  serverId: string | null,
  ignoreCosts: boolean,
  options: CorpInstallOptions = {}
): void {
  const blocker = corpInstallBlocker(state, card, serverId, ignoreCosts, options.discount);
  if (blocker) illegal(blocker);
  const def = cardDef(card);
  const installCost = corpInstallCost(state, card, serverId, ignoreCosts, options.discount);

  removeCard(zone, card);
  card.isRezzed = false;
  // "Install only faceup" agendas are always installed faceup (Sacrifice Zone Expansion)
  const faceUp = options.faceUp || !!getCardScript(card.cardCode)?.installFaceUpOnly;
  card.faceUp = faceUp && def.type_code === 'agenda' ? true : undefined;
  // A card the Runner accessed in this breach (rules 7.3.1a) or saw faceup before stays known to them
  if (runnerSawBeforeInstall(state, card, zone)) card.runnerKnows = true;
  else delete card.runnerKnows;
  card.installedTurn = turnKey(state);
  state.corp.credits -= installCost;
  const server = serverId === null ? createRemoteServer(state) : state.corp.servers[serverId];

  if (def.type_code === 'ice') {
    // Outer ice is placed at the end of the array
    server.ice.push(card);
    addLog(state, 'corp', `Corp installed Ice protecting ${server.name} (cost: ${installCost} [credit]).`, undefined, 'install');
    fireTrigger(state, { type: 'installed', card });
    return;
  }

  if (def.type_code === 'agenda' || def.type_code === 'asset') {
    // A remote holds at most one agenda or asset; the old one is trashed.
    for (const old of server.root.filter(c => ['agenda', 'asset'].includes(cardDef(c).type_code))) {
      trashInstalledCorpCard(state, server, old);
      addLog(state, 'corp', `Corp trashed a card in ${server.name} to make room.`);
    }
  }
  if (/\bregion\b/i.test(def.keywords ?? '')) {
    // Limit 1 region per server
    for (const old of server.root.filter(c => /\bregion\b/i.test(cardDef(c).keywords ?? ''))) {
      trashInstalledCorpCard(state, server, old);
      addLog(state, 'corp', `Corp trashed ${state.corp.archives.faceUp.includes(old) ? cardDef(old).title : 'a card'} (limit 1 region per server).`);
    }
  }
  server.root.push(card);
  addLog(state, 'corp', card.faceUp ? `Corp installed ${def.title} faceup into ${server.name}.` : `Corp installed a card into ${server.name}.`, undefined, 'install');
  fireTrigger(state, { type: 'installed', card });
}

function installRunnerCard(state: GameState, action: InstallCardAction): void {
  const zone = runnerHandZone(state, action.cardInstanceId);
  const card = zone?.find(c => c.instanceId === action.cardInstanceId);
  if (!zone || !card) illegal('Card not in Grip');
  if (cardDef(card).type_code === 'event') illegal('Events are played, not installed');
  const trash = chosenToTrashFirst(state, card, null, action.trashFirst ?? []);
  const blocker = runnerInstallBlocker(state, card, action.hostInstanceId, 0, freedMemory(trash));
  if (blocker) illegal(blocker);
  state.runner.clicks -= 1;
  trashFirst(state, trash);
  installRunnerCardFrom(state, card, zone, action.hostInstanceId);
}

/**
 * The zone holding a card the Runner can play or install as if it were in
 * the grip: the grip itself, or a card hosted on Bling.
 */
export function runnerHandZone(state: GameState, instanceId: string): CardInstance[] | undefined {
  if (state.runner.grip.some(c => c.instanceId === instanceId)) return state.runner.grip;
  return playableHostZones(state).find(z => z.some(c => c.instanceId === instanceId));
}

/** Cards hosted on installed cards that can be played or installed as if in the grip (Bling). */
export function playableHostZones(state: GameState): CardInstance[][] {
  return activeCards(state, 'runner')
    .filter(c => getCardScript(c.cardCode)?.hostedPlayable && c.hostedCards?.length)
    .map(c => c.hostedCards!);
}

/** Install cost after modifiers: the card's own (Carmen) and active cards' (DZMZ Optimizer), less a discount. */
export function runnerInstallCost(state: GameState, card: CardInstance, discount = 0): number {
  const own = getCardScript(card.cardCode)?.installCostModifier?.(state, card) ?? 0;
  const fromCards = activeCards(state, 'runner').reduce(
    (n, c) => n + (getCardScript(c.cardCode)?.modifiers?.runnerInstallCost?.(state, c, card) ?? 0),
    0
  );
  return Math.max(0, (cardDef(card).cost || 0) + own + fromCards - discount);
}

/**
 * Can the Runner install this card right now (credits, MU, host, card
 * restrictions)? Returns a reason if not. Programs that install on ice
 * need a host; other cards must not have one.
 */
export function runnerInstallBlocker(state: GameState, card: CardInstance, hostInstanceId?: string, discount = 0, freedMU = 0): string | null {
  const def = cardDef(card);
  const script = getCardScript(card.cardCode);
  if (!['program', 'hardware', 'resource'].includes(def.type_code)) return 'Only programs, hardware and resources can be installed';
  if (script?.installsOnIce) {
    if (!hostInstanceId) return `${def.title} must be installed on a piece of ice`;
    if (!installedIce(state).some(c => c.instanceId === hostInstanceId)) return 'Host must be an installed piece of ice';
  } else if (hostInstanceId) {
    const host = runnerHost(state, hostInstanceId);
    if (!host || !getCardScript(host.cardCode)?.hostsInstalled?.(state, host, card)) return `${def.title} cannot be hosted there`;
  }
  const restriction = script?.canInstall?.({ state, card, side: 'runner' });
  if (restriction) return restriction;
  const hostDiscount = hostInstanceId && !script?.installsOnIce ? hostedDiscount(state, hostInstanceId) : 0;
  if (availableCredits(state, 'runner', { kind: 'install', card }) < runnerInstallCost(state, card, discount + hostDiscount)) {
    return 'Not enough credits to install';
  }
  const mem = def.type_code === 'program' ? def.memory_cost || 0 : 0;
  if (state.runner.memoryUnitsUsed - freedMU + mem > memoryLimit(state)) {
    return 'Not enough memory units to install this program';
  }
  return null;
}

/** An installed Runner card that can host other installed cards (Hackerspace). */
export function runnerHost(state: GameState, instanceId: string): CardInstance | undefined {
  const { programs, hardware, resources } = state.runner.rig;
  return [...programs, ...hardware, ...resources].find(c => c.instanceId === instanceId && getCardScript(c.cardCode)?.hostsInstalled);
}

/** Install cost discount for installing onto a host (Hackerspace). */
function hostedDiscount(state: GameState, hostInstanceId: string): number {
  const host = runnerHost(state, hostInstanceId);
  return host ? getCardScript(host.cardCode)?.hostedInstallDiscount ?? 0 : 0;
}

/**
 * Installs a Runner card from any zone, paying its install cost (but no
 * click). Used by the install action and by effects like Mutual Favor.
 */
export function installRunnerCardFrom(
  state: GameState,
  card: CardInstance,
  zone: CardInstance[],
  hostInstanceId?: string,
  discount = 0
): void {
  const blocker = runnerInstallBlocker(state, card, hostInstanceId, discount);
  if (blocker) illegal(blocker);
  const def = cardDef(card);
  const onRunnerCard = hostInstanceId && !getCardScript(card.cardCode)?.installsOnIce ? runnerHost(state, hostInstanceId) : undefined;
  const installCost = runnerInstallCost(state, card, discount + (onRunnerCard ? hostedDiscount(state, onRunnerCard.instanceId) : 0));
  const mem = def.type_code === 'program' ? def.memory_cost || 0 : 0;

  removeCard(zone, card);
  spendCredits(state, 'runner', installCost, { kind: 'install', card });
  refillRecurring(card);
  card.isRezzed = true; // Runner cards enter the game active / face up
  card.installedTurn = turnKey(state);

  if (def.type_code === 'program') {
    state.runner.memoryUnitsUsed += mem;
    state.runner.rig.programs.push(card);
    bumpTurnFlag(state, TurnFlag.programsInstalled);
  } else if (def.type_code === 'hardware') {
    state.runner.rig.hardware.push(card);
  } else if (def.type_code === 'resource') {
    state.runner.rig.resources.push(card);
  }
  const host = hostInstanceId ? installedIce(state).find(c => c.instanceId === hostInstanceId) : undefined;
  if (host) {
    card.hostedOnId = host.instanceId;
    host.hostedCardIds.push(card.instanceId);
  } else if (onRunnerCard) {
    // Hosted on another Runner card (Hackerspace); trashed along with it
    card.hostedOnId = onRunnerCard.instanceId;
  }

  const where = host ? ' on a piece of ice' : onRunnerCard ? ` onto ${cardDef(onRunnerCard).title}` : '';
  addLog(state, 'runner', `Runner paid ${installCost} [credit] to install ${def.title}${where}.`, undefined, 'install');
  enforceInstallLimits(state, card);
  fireTrigger(state, { type: 'installed', card, paid: installCost });
}
