import { CardInstance, SideCode } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { getCardScript } from '../scripts';
import { CounterType, PaymentPurpose } from '../scripts/types';
import { addLog } from './log';
import { beforeCorpCardUninstalled, drawCards, findCardAnywhere, findInstalledCorpCard, removeCard, trashInstalledCorpCard } from './helpers';
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
  /** Double operations played this turn (Synchrocyclotron). */
  doublesPlayed: 'doubles_played',
  /** Pieces of ice rezzed this turn (Underdome Irregulars). */
  iceRezzed: 'ice_rezzed',
  /** Agendas scored or stolen this turn (Hype Machine). */
  agendasScoredOrStolen: 'agendas_scored_or_stolen',
  /** Agendas scored this turn that were not installed this turn (Myōshu). */
  scoredNotInstalledThisTurn: 'scored_not_installed_this_turn',
  /** Bad publicity taken this turn (Editorial Division). */
  badPublicityTaken: 'bad_publicity_taken',
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

/** Virus counters on all installed cards: what a purge would remove (rule 10.1.2). */
export function virusCountersInPlay(state: GameState): number {
  return allInstalledCards(state).reduce((n, card) => n + counters(card, 'virus'), 0);
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

const isStealth = (card: CardInstance) => /\bstealth\b/i.test(cardDef(card).keywords ?? '');

/** The run in progress, for the Runner's run-only credits (not Detente's access outside a run). */
const runnerRun = (state: GameState, side: SideCode) => (side === 'runner' && state.activeRun && !state.activeRun.accessOnly ? state.activeRun : null);

/** Cards whose hosted credits the Runner can spend on anything during this run (Aircheck, Methuselah, Touchstone). */
function runPayers(state: GameState, side: SideCode): CardInstance[] {
  const run = runnerRun(state, side);
  if (!run) return [];
  const hosts = (run.creditHosts ?? []).flatMap(id => findCardAnywhere(state, id) ?? []);
  const during = activeCards(state, 'runner').filter(c => getCardScript(c.cardCode)?.paysDuringRuns);
  return [...hosts, ...during].filter(c => counters(c, 'credit') > 0);
}

/**
 * Cards whose hosted credits can pay for this: recurring credits (Azimat,
 * Mahkota Langit Grid), restricted loaded credits (Open Market) and, during
 * a run, credits the Runner can spend during runs (Methuselah, Aircheck).
 * For 'stealth' only credits hosted on stealth cards count.
 */
export function creditSources(state: GameState, side: SideCode, purpose: PaymentPurpose): CardInstance[] {
  if (purpose.kind === 'stealth') return runPayers(state, side).filter(isStealth);
  const restricted =
    purpose.kind === 'other' ? [] : activeCards(state, side).filter(c => counters(c, 'credit') > 0 && getCardScript(c.cardCode)?.paysFor?.(state, c, purpose));
  const seen = new Set<string>();
  return [...restricted, ...runPayers(state, side)].filter(c => !seen.has(c.instanceId) && seen.add(c.instanceId));
}

/** Credits from stealth cards the Runner can spend right now ("Spend credits only from stealth cards"). */
export function stealthCredits(state: GameState): number {
  return availableCredits(state, 'runner', { kind: 'stealth' });
}

/** Run-only credits: Overclock's and the bad publicity fund (rules 10.6.2). */
function runOnlyCredits(state: GameState, side: SideCode): number {
  const run = runnerRun(state, side);
  return run ? run.bonusCredits + (run.badPublicityCredits ?? 0) : 0;
}

/** The Runner's credit pool, unless they can't spend from it this run (Aircheck). */
function spendablePool(state: GameState, side: SideCode): number {
  return side === 'runner' && runnerRun(state, side)?.poolLocked ? 0 : state[side].credits;
}

/**
 * Credits a side can spend right now: its pool, run-only credits (Overclock,
 * bad publicity) and hosted credits that may pay for `purpose`.
 */
export function availableCredits(state: GameState, side: SideCode, purpose: PaymentPurpose = { kind: 'other' }): number {
  const hosted = creditSources(state, side, purpose).reduce((n, c) => n + counters(c, 'credit'), 0);
  if (purpose.kind === 'stealth') return hosted;
  return spendablePool(state, side) + runOnlyCredits(state, side) + hosted;
}

/**
 * A rezzed card in the attacked server's root punishes spending credits from
 * outside the pool (Shackleton Grid): then the pool is spent first.
 */
function outsidePoolPunished(state: GameState): boolean {
  const run = state.activeRun;
  const server = run && state.corp.servers[run.server];
  return !!server && server.root.some(c => c.isRezzed && getCardScript(c.cardCode)?.triggers?.credits_spent_outside_pool);
}

/** Takes up to `amount` hosted credits from `source` to pay, trashing it if it empties ("when it is empty, trash it"). */
function payFromCard(state: GameState, side: SideCode, source: CardInstance, amount: number): number {
  const used = Math.min(amount, counters(source, 'credit'));
  if (used === 0) return 0;
  removeCounters(source, 'credit', used);
  addLog(state, side, `${used} [credit] paid from ${cardDef(source).title}.`);
  const script = getCardScript(source.cardCode);
  if (counters(source, 'credit') === 0 && script?.trashWhenEmpty) {
    trashInstalledCard(state, source);
    addLog(state, side, `${cardDef(source).title} is empty and was trashed.`);
    script.onEmptied?.({ state, card: source, side });
  }
  return used;
}

/**
 * Pays credits: restricted hosted credits first, then credits that only last
 * for this run (Aircheck's, the bad publicity fund, Overclock's), then
 * credits the Runner keeps after the run (Methuselah), then the credit pool.
 * With Shackleton Grid in the attacked server the pool goes before anything
 * outside it. Callers check availableCredits beforehand.
 */
export function spendCredits(state: GameState, side: SideCode, amount: number, purpose: PaymentPurpose = { kind: 'other' }): void {
  let remaining = amount;
  let fromPoolTotal = 0;
  const run = runnerRun(state, side);
  const sources = creditSources(state, side, purpose);
  const lasting = (c: CardInstance) => !!getCardScript(c.cardCode)?.paysDuringRuns && !(run?.creditHosts ?? []).includes(c.instanceId);
  const pool = () => {
    const fromPool = Math.min(remaining, spendablePool(state, side));
    state[side].credits -= fromPool;
    remaining -= fromPool;
    fromPoolTotal += fromPool;
  };
  if (purpose.kind !== 'stealth' && run && outsidePoolPunished(state)) pool();
  for (const source of sources.filter(c => !lasting(c))) remaining -= payFromCard(state, side, source, remaining);
  if (run && purpose.kind !== 'stealth') {
    const fromFund = Math.min(run.badPublicityCredits ?? 0, remaining);
    run.badPublicityCredits = (run.badPublicityCredits ?? 0) - fromFund;
    remaining -= fromFund;
    const fromBonus = Math.min(run.bonusCredits, remaining);
    run.bonusCredits -= fromBonus;
    remaining -= fromBonus;
  }
  for (const source of sources.filter(lasting)) remaining -= payFromCard(state, side, source, remaining);
  if (purpose.kind !== 'stealth') pool();
  // Whatever is left is a caller that didn't check (old behaviour: the pool goes negative)
  state[side].credits -= remaining;
  const outside = amount - remaining - fromPoolTotal;
  if (run && outside > 0) fireTrigger(state, { type: 'credits_spent_outside_pool', amount: outside });
}

/**
 * A player loses credits from their pool (as many as they have). During
 * Aircheck's run the Runner cannot lose credits from their pool. Hosted
 * credits are never lost this way (rules 1.13.3). Returns the credits lost.
 */
export function loseCredits(state: GameState, side: SideCode, amount: number): number {
  if (side === 'runner' && runnerRun(state, side)?.poolLocked) return 0;
  const lost = Math.max(0, Math.min(amount, state[side].credits));
  state[side].credits -= lost;
  return lost;
}

// --- Bad publicity ----------------------------------------------------------------

/** The Corp takes bad publicity (rules 10.6) and "whenever you take bad publicity" abilities fire (Editorial Division). */
export function takeBadPublicity(state: GameState, count: number): void {
  if (count <= 0) return;
  state.corp.badPublicity += count;
  bumpTurnFlag(state, TurnFlag.badPublicityTaken, count);
  addLog(state, 'corp', `The Corp took ${count} bad publicity (now ${state.corp.badPublicity}).`);
  fireTrigger(state, { type: 'bad_publicity_taken', count });
}

/** Removes bad publicity from the Corp. Returns how many were removed. */
export function removeBadPublicity(state: GameState, count: number): number {
  const removed = Math.max(0, Math.min(count, state.corp.badPublicity));
  if (removed === 0) return 0;
  state.corp.badPublicity -= removed;
  addLog(state, 'corp', `${removed} bad publicity removed from the Corp (now ${state.corp.badPublicity}).`);
  return removed;
}

/** The agenda points a card in a score area is worth (Myōshu, Word on the Street, Let Them Dream). */
export function agendaPoints(card: CardInstance): number {
  return card.asAgendaPoints ?? cardDef(card).agenda_points ?? 0;
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
  cost += getCardScript(card.cardCode)?.ownRezCostModifier?.(state, card) ?? 0;
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
  state.corp.score -= agendaPoints(card);
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
  const bonus = activeCards(state, side).reduce((n, c) => {
    const mod = getCardScript(c.cardCode)?.modifiers?.handSize ?? 0;
    return n + (typeof mod === 'function' ? mod(state, c) : mod);
  }, 0);
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
    beforeCorpCardUninstalled(state, card);
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

// --- Moving installed Corp cards ------------------------------------------------

/**
 * Swaps two installed pieces of ice (rules 8.8.3): each takes the other's
 * position, keeping what is hosted on it (8.8.3a). A Runner outside an
 * encounter stays in their position (6.2.7b, 6.2.7e).
 */
export function swapIce(state: GameState, aId: string, bId: string): boolean {
  const a = findInstalledCorpCard(state, aId);
  const b = findInstalledCorpCard(state, bId);
  if (!a || !b || a.location !== 'ice' || b.location !== 'ice' || aId === bId) return false;
  const ai = a.server.ice.indexOf(a.card);
  const bi = b.server.ice.indexOf(b.card);
  a.server.ice[ai] = b.card;
  b.server.ice[bi] = a.card;
  const name = (c: CardInstance) => (c.isRezzed ? cardDef(c).title : 'unrezzed ice');
  addLog(state, 'corp', `${name(a.card)} (${a.server.name}) and ${name(b.card)} (${b.server.name}) swapped positions.`);
  return true;
}

/** Can this upgrade be in the root of that server (rules 8.5.12; 3.6.5e: 1 region per server)? */
export function upgradeAllowedIn(state: GameState, upgrade: CardInstance, serverId: string): boolean {
  const server = state.corp.servers[serverId];
  if (!server) return false;
  const only = getCardScript(upgrade.cardCode)?.installOnly;
  if (only === 'central' && server.isRemote) return false;
  if (only === 'hq-rd' && serverId !== 'hq' && serverId !== 'rd') return false;
  const isRegion = (c: CardInstance) => /\bregion\b/i.test(cardDef(c).keywords ?? '');
  return !(isRegion(upgrade) && server.root.some(c => c.instanceId !== upgrade.instanceId && isRegion(c)));
}

/** Moves an installed upgrade to the root of another server (Lotus Haze). It stays installed and rezzed. */
export function moveUpgrade(state: GameState, upgrade: CardInstance, serverId: string): boolean {
  const from = findInstalledCorpCard(state, upgrade.instanceId);
  const to = state.corp.servers[serverId];
  if (!from || from.location !== 'root' || !to || from.server.id === serverId || !upgradeAllowedIn(state, upgrade, serverId)) return false;
  removeCard(from.server.root, upgrade);
  to.root.push(upgrade);
  addLog(state, 'corp', `${cardDef(upgrade).title} moved from ${from.server.name} to ${to.name}.`);
  return true;
}

/** Agendas in the Corp's score area that can be forfeited ("You cannot forfeit this agenda": Word on the Street). */
export function forfeitable(state: GameState): CardInstance[] {
  return state.corp.scoreArea.filter(c => cardDef(c).side_code === 'corp');
}

