import { CardInstance, SideCode } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { getCardScript } from '../scripts';
import { CounterType, PaymentPurpose } from '../scripts/types';
import { addLog } from './log';
import { drawCards, findCardAnywhere, findInstalledCorpCard, removeCard, trashInstalledCorpCard } from './helpers';
import { activeCards, fireTrigger } from './triggers';
import { trashInstalledRunnerCard } from './damage';

/**
 * Shared building blocks for card abilities: turn flags, counters, hosted
 * credits, paying credits, derived stats (hand size, memory), and moving
 * installed cards (trash, derez, remove from game).
 */

// --- Turn flags -------------------------------------------------------------

/** Keys of GameState.turnFlags. All reset when the turn passes. */
export const TurnFlag = {
  programsInstalled: 'programs_installed',
  basicDraws: 'basic_draws',
  accessTrashes: 'access_trashes',
  tagEvents: 'tag_events',
  hqBreaches: 'hq_breaches',
  agendaPointsScored: 'agenda_points_scored',
  cannotScore: 'cannot_score',
  /** Click actions the active player has finished this turn (Petty Cash). */
  actionsFinished: 'actions_finished',
  operationsPlayed: 'operations_played',
  tagsRemoved: 'tags_removed',
  runnerTrashedCorpCards: 'runner_trashed_corp_cards',
} as const;

export function turnFlag(state: GameState, key: string): number {
  return state.turnFlags[key] ?? 0;
}

export function bumpTurnFlag(state: GameState, key: string, by = 1): number {
  state.turnFlags[key] = turnFlag(state, key) + by;
  return state.turnFlags[key];
}

/** For "once per turn" abilities: true (and marks it used) the first time this turn. */
export function useOncePerTurn(state: GameState, key: string): boolean {
  if (turnFlag(state, key) > 0) return false;
  state.turnFlags[key] = 1;
  return true;
}

// --- Counters ---------------------------------------------------------------

export function counters(card: CardInstance, type: CounterType): number {
  return card.tokens[type] ?? 0;
}

/** "Dividends N": when scored, N agenda counters for each advancement counter beyond the requirement. */
export function placeDividends(state: GameState, agenda: CardInstance, perExcess: number): void {
  const excess = agenda.advancementCounters - (cardDef(agenda).advancement_cost ?? 0);
  if (excess <= 0) return;
  addCounters(agenda, 'agenda', excess * perExcess);
  addLog(state, 'corp', `${cardDef(agenda).title}: dividends, ${excess * perExcess} agenda counter(s).`);
}

export function addCounters(card: CardInstance, type: CounterType, count: number): void {
  card.tokens[type] = counters(card, type) + count;
}

export function removeCounters(card: CardInstance, type: CounterType, count: number): void {
  card.tokens[type] = Math.max(0, counters(card, type) - count);
}

/** "Load X credits onto this card". */
export function loadCredits(state: GameState, card: CardInstance, amount: number): void {
  addCounters(card, 'credit', amount);
  addLog(state, cardDef(card).side_code, `${cardDef(card).title} was loaded with ${amount} [credit].`);
}

/**
 * Moves up to `amount` hosted credits from a card to its controller's pool.
 * If the card is now empty and says "when it is empty, trash it", it is
 * trashed (and onEmptied runs). Returns the credits taken.
 */
export function takeHostedCredits(state: GameState, card: CardInstance, amount: number): number {
  const side = cardDef(card).side_code;
  const taken = Math.min(amount, counters(card, 'credit'));
  removeCounters(card, 'credit', taken);
  state[side].credits += taken;
  addLog(state, side, `${side === 'corp' ? 'Corp' : 'Runner'} took ${taken} [credit] from ${cardDef(card).title}.`);
  const script = getCardScript(card.cardCode);
  if (counters(card, 'credit') === 0 && script?.trashWhenEmpty) {
    trashInstalledCard(state, card);
    addLog(state, side, `${cardDef(card).title} is empty and was trashed.`);
    script.onEmptied?.({ state, card, side });
  }
  return taken;
}

/** Removes every virus counter from every card. */
export function purgeVirusCounters(state: GameState): number {
  let removed = 0;
  for (const card of allInstalledCards(state)) {
    removed += counters(card, 'virus');
    if (card.tokens.virus) card.tokens.virus = 0;
  }
  return removed;
}

// --- Credits ----------------------------------------------------------------

/**
 * Cards whose hosted credits can pay for this: recurring credits (Azimat,
 * Mahkota Langit Grid) and restricted loaded credits (Open Market).
 */
export function creditSources(state: GameState, side: SideCode, purpose: PaymentPurpose): CardInstance[] {
  if (purpose.kind === 'other') return [];
  return activeCards(state, side).filter(c => counters(c, 'credit') > 0 && getCardScript(c.cardCode)?.paysFor?.(state, c, purpose));
}

/**
 * Credits a side can spend right now: its pool, run-only credits (Overclock)
 * and hosted credits that may pay for `purpose`.
 */
export function availableCredits(state: GameState, side: SideCode, purpose: PaymentPurpose = { kind: 'other' }): number {
  const bonus = side === 'runner' ? state.activeRun?.bonusCredits ?? 0 : 0;
  const hosted = creditSources(state, side, purpose).reduce((n, c) => n + counters(c, 'credit'), 0);
  return state[side].credits + bonus + hosted;
}

/**
 * Pays credits: restricted hosted credits first, then run-only credits, then
 * the credit pool. Callers check availableCredits beforehand.
 */
export function spendCredits(state: GameState, side: SideCode, amount: number, purpose: PaymentPurpose = { kind: 'other' }): void {
  let remaining = amount;
  for (const source of creditSources(state, side, purpose)) {
    if (remaining === 0) break;
    const used = Math.min(remaining, counters(source, 'credit'));
    removeCounters(source, 'credit', used);
    remaining -= used;
    addLog(state, side, `${used} [credit] paid from ${cardDef(source).title}.`);
    const script = getCardScript(source.cardCode);
    if (counters(source, 'credit') === 0 && script?.trashWhenEmpty) {
      trashInstalledCard(state, source);
      addLog(state, side, `${cardDef(source).title} is empty and was trashed.`);
      script.onEmptied?.({ state, card: source, side });
    }
  }
  const run = state.activeRun;
  if (side === 'runner' && run && run.bonusCredits > 0) {
    const fromBonus = Math.min(run.bonusCredits, remaining);
    run.bonusCredits -= fromBonus;
    remaining -= fromBonus;
  }
  state[side].credits -= remaining;
}

/** Refills recurring credits on a side's active cards ("before your turn begins"). */
export function refillRecurringCredits(state: GameState, side: SideCode): void {
  for (const card of activeCards(state, side)) refillRecurring(card);
}

/** Refills one card's recurring credits (also when it is installed or rezzed). */
export function refillRecurring(card: CardInstance): void {
  const amount = getCardScript(card.cardCode)?.recurringCredits;
  if (amount !== undefined) card.tokens.credit = Math.max(counters(card, 'credit'), amount);
}

/**
 * A player gains credits through an ability on `source` (an agenda,
 * operation, asset...). Fires "credits_gained" for The Zwicky Group.
 */
export function gainFromCard(state: GameState, side: SideCode, amount: number, source: CardInstance): void {
  if (amount <= 0) return;
  state[side].credits += amount;
  fireTrigger(state, { type: 'credits_gained', side, amount, source }, [source]);
}

/** The rez cost of a Corp card right now (Tread Lightly, Fransofia Ward). */
export function rezCost(state: GameState, card: CardInstance): number {
  const def = cardDef(card);
  let cost = def.cost || 0;
  if (def.type_code === 'ice') cost += state.activeRun?.iceRezCostIncrease ?? 0;
  for (const c of activeCards(state)) cost += getCardScript(c.cardCode)?.modifiers?.rezCost?.(state, c, card) ?? 0;
  return Math.max(0, cost);
}

/** The trash cost of a Corp card right now (Mahkota Langit Grid), or null if it has none. */
export function trashCost(state: GameState, card: CardInstance): number | null {
  const printed = cardDef(card).trash_cost;
  if (printed == null) return null;
  const serverId = findInstalledCorpCard(state, card.instanceId)?.server.id;
  const run = state.activeRun;
  const persistent = (run?.persistentIds ?? []).flatMap(id => findCardAnywhere(state, id) ?? []);
  let cost = printed;
  for (const c of [...activeCards(state, 'corp'), ...persistent]) {
    const mod = getCardScript(c.cardCode)?.modifiers?.trashCost;
    if (!mod) continue;
    // A persistent card trashed this run still counts for the server it was in
    const where = run?.persistentServers[c.instanceId];
    if (where !== undefined && where !== serverId) continue;
    cost += mod(state, c, card, serverId);
  }
  return Math.max(0, cost);
}

// --- Threat, flipping, forfeiting -----------------------------------------------

/** The threat level: the highest number of agenda points either player has. */
export function threatLevel(state: GameState): number {
  return Math.max(state.corp.score, state.runner.score);
}

/** Turns an identity to its other side. */
export function flipIdentity(state: GameState, side: SideCode): void {
  const identity = state[side].identity;
  identity.flipped = !identity.flipped;
  addLog(state, side, `${cardDef(identity).title} flipped.`);
}

/** Forfeits an agenda from the Corp's score area: it is removed from the game and its points are lost. */
export function forfeitAgenda(state: GameState, card: CardInstance): void {
  if (!removeCard(state.corp.scoreArea, card)) return;
  state.corp.score -= cardDef(card).agenda_points || 0;
  state.removedFromGame.push(card);
  addLog(state, 'corp', `Corp forfeited ${cardDef(card).title}.`);
  fireTrigger(state, { type: 'agenda_forfeited', card }, [card]);
}

/** Removes tags from the Runner and fires "whenever a tag is removed" (Synapse Global). */
export function removeTags(state: GameState, count: number): number {
  const removed = Math.min(count, state.runner.tags);
  if (removed <= 0) return 0;
  state.runner.tags -= removed;
  bumpTurnFlag(state, TurnFlag.tagsRemoved, removed);
  fireTrigger(state, { type: 'tags_removed', count: removed });
  return removed;
}

/**
 * The Corp trashes cards from HQ and fires "hq_trashed" (AU Co.). They go
 * into Archives facedown, or faceup when they were revealed first (Shred,
 * Plutus): a card the Runner could see when it was trashed is faceup (rules 4.4.6b).
 */
export function corpTrashFromHQ(state: GameState, ids: string[], revealed = false): CardInstance[] {
  const trashed: CardInstance[] = [];
  for (const id of ids) {
    const card = state.corp.hq.find(c => c.instanceId === id);
    if (!card) continue;
    removeCard(state.corp.hq, card);
    (revealed ? state.corp.archives.faceUp : state.corp.archives.faceDown).push(card);
    trashed.push(card);
  }
  if (trashed.length > 0) fireTrigger(state, { type: 'hq_trashed', count: trashed.length });
  return trashed;
}

/** The Corp trashes the top `count` cards of R&D (sabotage). */
export function corpTrashFromRD(state: GameState, count: number): number {
  const trashed = state.corp.rd.splice(0, count);
  state.corp.archives.faceDown.push(...trashed);
  return trashed.length;
}

// --- Derived stats ----------------------------------------------------------

const BASE_HAND_SIZE = 5;
const BASE_MEMORY = 4;

/** Maximum hand size: 5, plus card modifiers, minus the Runner's core damage. */
export function maxHandSize(state: GameState, side: SideCode): number {
  const bonus = activeCards(state, side).reduce((n, c) => n + (getCardScript(c.cardCode)?.modifiers?.handSize ?? 0), 0);
  return BASE_HAND_SIZE + bonus - (side === 'runner' ? state.runner.coreDamage : 0);
}

/** The Runner's memory units: 4 plus hardware bonuses. */
export function memoryLimit(state: GameState): number {
  return BASE_MEMORY + activeCards(state, 'runner').reduce((n, c) => n + (getCardScript(c.cardCode)?.modifiers?.memory ?? 0), 0);
}

/** Copies derived stats into the state fields the UI reads. Called after every action. */
export function syncDerivedStats(state: GameState): void {
  state.corp.handSizeLimit = maxHandSize(state, 'corp');
  state.runner.handSizeLimit = maxHandSize(state, 'runner');
  state.runner.memoryUnitsTotal = memoryLimit(state);
}

// --- Installed cards --------------------------------------------------------

export function allInstalledCards(state: GameState): CardInstance[] {
  const { programs, hardware, resources } = state.runner.rig;
  const corp = Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);
  return [...corp, ...programs, ...hardware, ...resources];
}

export function installedIce(state: GameState): CardInstance[] {
  return Object.values(state.corp.servers).flatMap(s => s.ice);
}

/** Trashes any installed card (Corp cards go to Archives, Runner cards to the heap). */
export function trashInstalledCard(state: GameState, card: CardInstance): void {
  const corp = findInstalledCorpCard(state, card.instanceId);
  if (corp) {
    trashInstalledCorpCard(state, corp.server, card);
  } else {
    trashInstalledRunnerCard(state, card);
  }
}

/** Turns a rezzed Corp card facedown (Tranquilizer). */
export function derez(state: GameState, card: CardInstance): void {
  if (!card.isRezzed) return;
  card.isRezzed = false;
  addLog(state, 'runner', `${cardDef(card).title} was derezzed.`);
}

/** Removes an installed card from the game (Spin Doctor). */
export function removeFromGame(state: GameState, card: CardInstance): void {
  const corp = findInstalledCorpCard(state, card.instanceId);
  if (corp) {
    removeCard(corp.server.root, card) || removeCard(corp.server.ice, card);
  } else {
    const { rig } = state.runner;
    removeCard(rig.programs, card) || removeCard(rig.hardware, card) || removeCard(rig.resources, card);
  }
  card.tokens = {};
  card.advancementCounters = 0;
  state.removedFromGame.push(card);
}

/** Draws cards and logs it (for card effects). */
export function drawForEffect(state: GameState, side: SideCode, count: number, sourceTitle: string): void {
  const drawn = drawCards(state, side, count);
  addLog(state, side, `${side === 'corp' ? 'Corp' : 'Runner'} drew ${drawn} card(s) (${sourceTitle}).`);
}

/**
 * "Limit 1 console per player" and unique cards: if a newly active card shares
 * the restriction with an older active card, the older one is trashed.
 */
export function enforceInstallLimits(state: GameState, newCard: CardInstance): void {
  const def = cardDef(newCard);
  const isConsole = (c: CardInstance) => /\bconsole\b/i.test(cardDef(c).keywords ?? '');
  const others = activeCards(state, def.side_code).filter(c => c.instanceId !== newCard.instanceId);
  for (const old of others) {
    const sameUnique = def.uniqueness && cardDef(old).title === def.title;
    const twoConsoles = def.type_code === 'hardware' && isConsole(newCard) && isConsole(old);
    if (sameUnique || twoConsoles) {
      trashInstalledCard(state, old);
      addLog(state, def.side_code, `${cardDef(old).title} was trashed (${sameUnique ? 'unique' : 'limit 1 console'}).`);
    }
  }
}
