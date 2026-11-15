import { FormatId, SideCode, getCardDefinition, influenceCost, validateDeck } from '../core';
import { ALL_CARDS } from '../data/cards';
import { newCustomDeckId } from '../data/customDecks';
import { DeckList, deckCodes } from '../data/decks';
import type { Difficulty } from '../ai';
import { ONLINE_FORMATS } from '../net/protocol';
import { readStorage, writeStorage } from './storage';

/** How the person wants to play: the first choice on the start screen. */
export type PlayMode = 'computer' | 'hotseat' | 'online';
export type OnlineRole = 'host' | 'join';
export type Opponent = 'people' | 'ai-corp' | 'ai-runner';

export const MODE_KEY = 'netrunner.playMode';
export const HOST_FORMAT_KEY = 'netrunner.hostFormat';
export const OPPONENT_KEY = 'netrunner.opponent';

/** Hard is switched off until it is clearly stronger than Normal; every AI game uses Normal (an old stored 'hard' choice is ignored). */
export const AI_DIFFICULTY: Difficulty = 'normal';

export const MODES: { id: PlayMode; label: string; hint: string }[] = [
  { id: 'computer', label: 'Play the computer', hint: 'You play one side, the computer the other' },
  { id: 'hotseat', label: 'Pass and play', hint: 'Two people on this device, or one person playing both sides' },
  { id: 'online', label: 'Play online', hint: 'Play someone on another device: host a game and send the link, or join with a code' },
];

export const FORMAT_HINTS: Record<FormatId, string> = {
  startup: 'Startup: the newest sets only, with its ban list',
  standard: 'Standard: the current card pool, with its ban list',
  casual: 'Casual: any card, no ban list (deck-building rules still apply)',
};

// Corp before Runner, matching the deck columns below; each side's button wears its side colour
export const OPPONENTS: { id: Exclude<Opponent, 'people'>; label: string; hint: string; on: string; off: string }[] = [
  {
    id: 'ai-runner',
    label: 'I play Corp',
    hint: 'The computer plays the Runner',
    on: 'bg-cyan-700 border-cyan-400 text-white',
    off: 'bg-slate-900 border-cyan-800 text-cyan-300 hover:border-cyan-500',
  },
  {
    id: 'ai-corp',
    label: 'I play Runner',
    hint: 'The computer plays the Corp',
    on: 'bg-pink-600 border-pink-400 text-white',
    off: 'bg-slate-900 border-pink-800 text-pink-300 hover:border-pink-500',
  },
];

export function savedOpponent(): Opponent {
  const v = readStorage(OPPONENT_KEY);
  if (v === 'people' || v === 'ai-corp' || v === 'ai-runner') return v;
  return 'people';
}

/** The mode last used; before modes existed, the old opponent setting (two players: pass and play). */
export function savedMode(): PlayMode {
  const v = readStorage(MODE_KEY);
  if (v === 'computer' || v === 'hotseat' || v === 'online') return v;
  if (readStorage(OPPONENT_KEY) === 'people') return 'hotseat';
  return 'computer';
}

export function savedHostFormat(): FormatId {
  const f = readStorage(HOST_FORMAT_KEY);
  if (f && (ONLINE_FORMATS as string[]).includes(f)) return f as FormatId;
  return 'casual';
}

export function remember(key: string, value: string) {
  writeStorage(key, value);
}

export const other = (side: SideCode): SideCode => (side === 'corp' ? 'runner' : 'corp');
export const sideName = (side: SideCode) => (side === 'corp' ? 'Corp' : 'Runner');

export const choiceClass = (
  on: boolean,
  onClass: string,
  offClass = 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500',
) =>
  `px-4 py-2 rounded-[2px] border border-b-2 text-xs font-bold transition-all active:translate-y-[1px] active:border-b-[1px] ${on ? onClass : offClass}`;

export const SIDE_ON: Record<SideCode, string> = {
  corp: 'bg-cyan-700 border-cyan-400 text-white',
  runner: 'bg-pink-600 border-pink-400 text-white',
};
export const SIDE_OFF: Record<SideCode, string> = {
  corp: 'bg-slate-900 border-cyan-800 text-cyan-300 hover:border-cyan-500',
  runner: 'bg-slate-900 border-pink-800 text-pink-300 hover:border-pink-500',
};

export const goClass =
  'disabled:opacity-40 disabled:cursor-not-allowed px-8 py-3 bg-gradient-to-b from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-cyber text-sm tracking-widest font-bold rounded-[2px] border border-amber-300 border-b-4 border-b-amber-600 shadow-xl flex items-center gap-2 active:translate-y-[2px] active:border-b-2 transition-all';

export interface DeckSummary {
  deck: DeckList;
  identityCode: string;
  size: number;
  agendaPoints: number;
  influence: number;
  influenceLimit: number | null;
  problems: string[];
}

export function summarize(deck: DeckList): DeckSummary {
  const codes = deckCodes(deck);
  const identity = getCardDefinition(codes.identity);
  const defs = codes.cards.map(getCardDefinition);
  return {
    deck,
    identityCode: codes.identity,
    size: defs.length,
    agendaPoints: defs.reduce((n, d) => n + (d.agenda_points ?? 0), 0),
    influence: defs.reduce((n, d) => n + influenceCost(identity, d), 0),
    influenceLimit: identity.influence_limit ?? null,
    problems: validateDeck(codes),
  };
}

/** A deck column's title, and online the game's format with each deck's problems in it. */
export type ColumnOpts = { title?: string; online?: { format: FormatId; problems: Map<string, string[]> } };

/** An identity's title from its code, for the joiner's look at the host (the code if it isn't a card here). */
export function identityTitle(code: string): string {
  try {
    return getCardDefinition(code).title;
  } catch {
    return code;
  }
}

export function emptyDeck(side: SideCode): DeckList {
  const identity = ALL_CARDS.find(c => c.side_code === side && c.type_code === 'identity')!;
  return { id: newCustomDeckId(), name: 'New deck', side, identity: identity.title, cards: {}, source: 'custom' };
}

export const deckListElement = (side: SideCode) => document.querySelector<HTMLElement>(`[data-testid="deck-list-${side}"]`);

/** Scrolls only the deck list column (not the page) so the deck sits in the middle. */
export function scrollDeckIntoView(side: SideCode, deckId: string, behavior: ScrollBehavior = 'smooth') {
  const list = deckListElement(side);
  const item = Array.from(list?.children ?? []).find(
    el => (el as HTMLElement).dataset.testid === `deck-${deckId}`,
  ) as HTMLElement | undefined;
  if (!list || !item) return;
  const offset = item.getBoundingClientRect().top - list.getBoundingClientRect().top;
  const top = list.scrollTop + offset - (list.clientHeight - item.offsetHeight) / 2;
  list.scrollTo?.({ top: Math.max(0, top), behavior });
}

/** Whether the deck's whole entry is inside its list's visible area. */
export function deckFullyVisible(side: SideCode, deckId: string): boolean {
  const list = deckListElement(side);
  const item = list?.querySelector<HTMLElement>(`[data-testid="deck-${deckId}"]`);
  if (!list || !item) return true;
  const l = list.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  return r.top >= l.top && r.bottom <= l.bottom;
}
