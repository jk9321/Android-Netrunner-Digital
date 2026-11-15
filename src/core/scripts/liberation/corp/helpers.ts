import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { beforeCorpCardUninstalled, findInstalledCorpCard, removeCard, revealInHand } from '../../../engine/helpers';
import { rezForFree } from '../../../engine/actions/corp';
import { corpInstallCost, installCorpCardFrom } from '../../../engine/actions/install';
import { trashInstalledRunnerCard } from '../../../engine/damage';
import { iceSubtypes } from '../../../engine/ice';
import { gainFromCard, rezCost, useOncePerTurn } from '../../../engine/cardEffects';
import { EffectAnswer, EffectContext } from '../../types';
import { advanceableInstalled, askCards, askChoice, corpInstallOptions, corpZoneOf } from '../../effects';
import { CardsQuestion, ChoiceQuestion } from '../../steps';

export const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;

export const type = (card: CardInstance) => cardDef(card).type_code;

export const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';

export const hasKeyword = (card: CardInstance, word: string) => new RegExp(`\\b${word}\\b`, 'i').test(keywords(card));

export const title = (card: CardInstance) => cardDef(card).title;

export const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);

export const onceKey = (card: CardInstance, n = 0) => `once:${card.instanceId}:${n}`;

export const archivesCards = (state: GameState) => [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];

export const serverOf = (state: GameState, card: CardInstance) => findInstalledCorpCard(state, card.instanceId)?.server;

export const installedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);

export const yesNo = (yes: string, no = 'No') => [
  { id: 'yes', label: yes },
  { id: 'no', label: no },
];

export const said = (answer: EffectAnswer, id = 'yes') => answer.kind === 'effect_choice' && answer.optionId === id;

export const picked = (answer: EffectAnswer) => (answer.kind === 'effect_cards' ? answer.cardInstanceIds : []);

/** A run is in progress against this card's server. */
export const runOnServerOf = (state: GameState, card: CardInstance) => {
  const run = state.activeRun;
  return !!run && !run.accessOnly && serverOf(state, card)?.id === run.server;
};

/** Cards from these that could be installed now (with these options). */
export const installable = (state: GameState, cards: CardInstance[], opts: Parameters<typeof corpInstallOptions>[2] = {}) =>
  cards.filter(c => type(c) !== 'operation' && corpInstallOptions(state, c, opts).length > 0);

/** Removes a card from whichever of R&D, HQ or Archives holds it. */
export function takeFromCorpZone(state: GameState, card: CardInstance): void {
  const { rd, hq, archives } = state.corp;
  removeCard(rd, card) || removeCard(hq, card) || removeCard(archives.faceUp, card) || removeCard(archives.faceDown, card);
}

/** Adds a card from Archives to HQ, revealing it if it was faceup. */
export function archivesToHQ(state: GameState, id: string, source: string): void {
  const card = archivesCards(state).find(c => c.instanceId === id);
  if (!card) return;
  const faceUp = state.corp.archives.faceUp.includes(card);
  takeFromCorpZone(state, card);
  state.corp.hq.push(card);
  if (faceUp) revealInHand(state, 'corp', [card]);
  addLog(state, 'corp', `Corp added ${faceUp ? title(card) : 'a facedown card'} from Archives to HQ (${source}).`);
}

/**
 * An installed Corp card goes back to HQ (Tatu-Bola, Descent, Hermes): it
 * leaves play, so programs hosted on it are trashed and its counters go.
 */
export function returnInstalledToHQ(state: GameState, card: CardInstance): boolean {
  const found = findInstalledCorpCard(state, card.instanceId);
  if (!found) return false;
  beforeCorpCardUninstalled(state, card);
  removeCard(found.server.root, card) || removeCard(found.server.ice, card);
  for (const hostedId of card.hostedCardIds) {
    const hosted = state.runner.rig.programs.find(c => c.instanceId === hostedId);
    if (hosted) trashInstalledRunnerCard(state, hosted);
  }
  card.hostedCardIds = [];
  card.tokens = {};
  card.isRezzed = false;
  card.advancementCounters = 0;
  delete card.faceUp;
  delete card.chosenSubtypes;
  delete card.runnerKnows;
  state.corp.hq.push(card);
  return true;
}

/** Asks where to install a card, among the given server options (ids from corpInstallOptions). */
export function askInstallAmong(ctx: EffectContext, cardId: string, step: string, options: { id: string; label: string }[], data: Record<string, string | number | boolean> = {}): boolean {
  if (options.length === 0) return false;
  const card = [...ctx.state.corp.hq, ...ctx.state.corp.rd, ...archivesCards(ctx.state)].find(c => c.instanceId === cardId);
  askChoice(ctx, 'corp', `Install ${card ? title(card) : 'the card'} where?`, options, step, { ...data, cardId, install: true });
  return true;
}

/** Nuvem SA: "The first time you trash a card from R&D during each of your turns, gain 2 credits." */
export function corpTrashedFromRD(state: GameState): void {
  if (state.corp.identity.cardCode !== NUVEM || state.activePlayer !== 'corp') return;
  if (!useOncePerTurn(state, `nuvem:${state.corp.identity.instanceId}`)) return;
  gainFromCard(state, 'corp', 2, state.corp.identity);
  addLog(state, 'corp', 'Corp gained 2 [credit] (Nuvem SA: Law of the Land).');
}

const NUVEM = '34121';

/** The Corp trashes the top card of R&D (Nuvem SA, The Basalt Spire). */
export function trashTopOfRD(state: GameState, source: string): CardInstance | undefined {
  const top = state.corp.rd.shift();
  if (!top) return undefined;
  state.corp.archives.faceDown.push(top);
  addLog(state, 'corp', `Corp trashed the top card of R&D (${source}).`);
  corpTrashedFromRD(state);
  return top;
}

/** Where to install a card, among the given server options (ids from corpInstallOptions); null if there are none. Ask it with data { cardId, install: true }. */
export function installAmongQuestion(state: GameState, cardId: string, options: { id: string; label: string }[]): ChoiceQuestion | null {
  if (options.length === 0) return null;
  const card = [...state.corp.hq, ...state.corp.rd, ...archivesCards(state)].find(c => c.instanceId === cardId);
  return { side: 'corp', message: `Install ${card ? title(card) : 'the card'} where?`, options };
}

/** Which installed card gets `n` advancement counters (only cards that can be advanced, if `advanceable`); null if none. Ask it with data { n }. */
export function placeAdvancementQuestion(ctx: EffectContext, n: number, advanceable = true, among?: CardInstance[]): CardsQuestion | null {
  const cards = among ?? (advanceable ? advanceableInstalled(ctx.state) : installedCorpCards(ctx.state));
  if (cards.length === 0) return null;
  return { side: 'corp', message: `${title(ctx.card)}: place ${n} advancement counter${n > 1 ? 's' : ''} on 1 installed card.`, candidateIds: ids(cards), min: 1, max: 1 };
}

/** Asks which installed card gets `n` advancement counters (only cards that can be advanced, if `advanceable`). */
export function askPlaceAdvancement(ctx: EffectContext, n: number, step: string, advanceable = true, among?: CardInstance[]): boolean {
  const cards = among ?? (advanceable ? advanceableInstalled(ctx.state) : installedCorpCards(ctx.state));
  if (cards.length === 0) return false;
  askCards(ctx, 'corp', `${title(ctx.card)}: place ${n} advancement counter${n > 1 ? 's' : ''} on 1 installed card.`, ids(cards), 1, 1, step, { n });
  return true;
}

export function placeAdvancement(state: GameState, id: string, n: number, source: string): void {
  const found = findInstalledCorpCard(state, id);
  if (!found) return;
  found.card.advancementCounters += n;
  addLog(state, 'corp', `Corp placed ${n} advancement counter(s) on a card in ${found.server.name} (${source}).`);
}

/** Card types among faceup cards in Archives (Armed Asset Protection, Logjam). */
export const faceUpTypes = (state: GameState, except?: CardInstance) =>
  new Set(state.corp.archives.faceUp.filter(c => c.instanceId !== except?.instanceId).map(c => type(c)));

// Tucana: Remote server only. Persistent -> Whenever an agenda is scored or stolen from the root
// of this server, you may search R&D for 1 piece of ice. Install and rez that ice, paying a total
// of 3 credits less.
/** Where `ice` could go when installing and rezzing it for a total of `discount` less, and what it costs there. */
export function installAndRezOptions(state: GameState, ice: CardInstance, discount: number, ignoreAll = false): { id: string; label: string }[] {
  const credits = state.corp.credits;
  const total = (serverId: string | null) => (ignoreAll ? 0 : Math.max(0, corpInstallCost(state, ice, serverId, false) + rezCost(state, ice) - discount));
  const options: { id: string; label: string }[] = [];
  const kinds = type(ice) === 'ice' ? Object.values(state.corp.servers) : Object.values(state.corp.servers).filter(s => s.isRemote || type(ice) === 'upgrade');
  // Where it may go at all: restrictions such as A Teia's 2 remote servers still apply when costs are ignored (rules 1.2.2)
  const allowed = new Set(corpInstallOptions(state, ice, { ignoreCosts: true }).map(o => o.id));
  if (allowed.has('new') && total(null) <= credits) options.push({ id: 'new', label: `New remote server (${total(null)}c)` });
  for (const s of kinds) if (total(s.id) <= credits && allowed.has(s.id)) options.push({ id: s.id, label: `${s.name} (${total(s.id)}c)` });
  return options;
}

/** Installs the chosen card ignoring costs, pays the combined cost less the discount, and rezzes it. */
export function installAndRez(state: GameState, cardId: string, serverOption: string, discount: number, ignoreAll = false): void {
  const card = [...state.corp.hq, ...state.corp.rd, ...archivesCards(state)].find(c => c.instanceId === cardId);
  const zone = card && corpZoneOf(state, cardId);
  if (!card || !zone) return;
  const serverId = serverOption === 'new' ? null : serverOption;
  const total = ignoreAll ? 0 : Math.max(0, corpInstallCost(state, card, serverId, false) + rezCost(state, card) - discount);
  if (state.corp.credits < total) return;
  const before = new Set(Object.keys(state.corp.servers));
  card.advancementCounters = 0;
  card.tokens = {};
  installCorpCardFrom(state, card, zone, serverId, true);
  state.corp.credits -= total;
  const installed = findInstalledCorpCard(state, cardId);
  if (!installed || type(card) === 'agenda') return;
  addLog(state, 'corp', `Corp paid ${total} [credit] to install and rez ${title(card)}.`, undefined, 'rez');
  rezForFree(state, card);
  void before;
}

export const lycianIs = (state: GameState, ice: CardInstance, subtype: 'barrier' | 'code gate' | 'sentry') => iceSubtypes(ice, state).includes(subtype);
