import React, { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FormatId, SideCode, getCardDefinition, getFormat, influenceCost, validateDeck } from '../../core';
import { DECKS, DeckList, deckCodes, pickRandomDeck, randomDeckPool } from '../../data/decks';
import { ALL_CARDS, getCardImageUrl } from '../../data/cards';
import { loadCustomDecks, newCustomDeckId, saveCustomDecks } from '../../data/customDecks';
import { favoritesFirst, loadFavoriteDecks, loadHiddenDecks, saveFavoriteDecks, saveHiddenDecks, toggleId } from '../../data/deckPrefs';
import type { Difficulty } from '../../ai';
import { CheckCircle2, AlertTriangle, Play, Plus, Pencil, Copy, Trash2, Dices, Eye, EyeOff, RotateCcw, Star, Search, Globe, Loader2 } from 'lucide-react';
import type { OnlineSession } from '../../net/client';
import { playerId } from '../../net/client';
import { LobbyFailure, createGame, joinGame, lookupGame, onlineDeckProblems } from '../../net/lobby';
import { ONLINE_FORMATS, parseRoomCode } from '../../net/protocol';
import type { LobbyInfo } from '../../net/protocol';
import { showConfirm } from './Dialog';
import { BugReportButton } from './BugReportButton';

// Loaded on first use, so the start screen doesn't wait for them
const DeckBuilder = lazy(() => import('./DeckBuilder').then(m => ({ default: m.DeckBuilder })));
const DeckViewer = lazy(() => import('./DeckBuilder').then(m => ({ default: m.DeckViewer })));
const ImportDeckModal = lazy(() => import('./ImportDeckModal').then(m => ({ default: m.ImportDeckModal })));
// Beta builds only: __BETA_TOOLS__ is false elsewhere, so the bundler drops this chunk from main builds
const BulkImportModal = __BETA_TOOLS__ ? lazy(() => import('../../beta/BulkImportModal').then(m => ({ default: m.BulkImportModal }))) : null;

interface DeckPickerProps {
  initialCorpDeckId: string;
  initialRunnerDeckId: string;
  onStart: (corpDeck: DeckList, runnerDeck: DeckList, ai: SideCode | null, difficulty: Difficulty) => void;
  /** Hosted or joined an online game: the session to play it with. */
  onOnline?: (session: OnlineSession) => void;
  /** Opened from an invite link (/play/K7QM-2X): Join, with this code filled in and looked up. */
  joinCode?: string | null;
  /** The person left the invite link's Join screen: the address goes back to /. */
  onLeaveLink?: () => void;
  /** Tests: the online lobby calls (default: the site's /api/games). */
  lobbyFetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Tests: open on this mode and role. */
  initialMode?: PlayMode;
  initialRole?: OnlineRole;
  /** Tests: a looked-up game to show (as Find game would). */
  initialLobby?: LobbyInfo;
  /** Tests: the host's side and format to start on. */
  initialHost?: { side: SideCode; format: FormatId };
}

/** How the person wants to play: the first choice on the start screen. */
export type PlayMode = 'computer' | 'hotseat' | 'online';
export type OnlineRole = 'host' | 'join';
const MODE_KEY = 'netrunner.playMode';
const HOST_FORMAT_KEY = 'netrunner.hostFormat';

const MODES: { id: PlayMode; label: string; hint: string }[] = [
  { id: 'computer', label: 'Play the computer', hint: 'You play one side, the computer the other' },
  { id: 'hotseat', label: 'Pass and play', hint: 'Two people on this device, or one person playing both sides' },
  { id: 'online', label: 'Play online', hint: 'Play someone on another device: host a game and send the link, or join with a code' },
];

/** Which side the computer plays (kept from the old opponent setting). */
type Opponent = 'people' | 'ai-corp' | 'ai-runner';
const OPPONENT_KEY = 'netrunner.opponent';
/** Hard is switched off until it is clearly stronger than Normal; every AI game uses Normal (an old stored 'hard' choice is ignored). */
const AI_DIFFICULTY: Difficulty = 'normal';

function savedOpponent(): Opponent {
  try {
    const v = window.localStorage.getItem(OPPONENT_KEY);
    if (v === 'people' || v === 'ai-corp' || v === 'ai-runner') return v;
  } catch {
    // Storage blocked: use the default
  }
  return 'people';
}

/** The mode last used; before modes existed, the old opponent setting (two players: pass and play). */
function savedMode(): PlayMode {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    if (v === 'computer' || v === 'hotseat' || v === 'online') return v;
    const old = window.localStorage.getItem(OPPONENT_KEY);
    if (old === 'people') return 'hotseat';
  } catch {
    // Storage blocked: use the default
  }
  return 'computer';
}

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not saved; the choice still applies now
  }
}

const other = (side: SideCode): SideCode => (side === 'corp' ? 'runner' : 'corp');
const sideName = (side: SideCode) => (side === 'corp' ? 'Corp' : 'Runner');

const choiceClass = (on: boolean, onClass: string, offClass = 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500') =>
  `px-4 py-2 rounded-[2px] border border-b-2 text-xs font-bold transition-all active:translate-y-[1px] active:border-b-[1px] ${on ? onClass : offClass}`;

const SIDE_ON: Record<SideCode, string> = { corp: 'bg-cyan-700 border-cyan-400 text-white', runner: 'bg-pink-600 border-pink-400 text-white' };
const SIDE_OFF: Record<SideCode, string> = {
  corp: 'bg-slate-900 border-cyan-800 text-cyan-300 hover:border-cyan-500',
  runner: 'bg-slate-900 border-pink-800 text-pink-300 hover:border-pink-500',
};

const FORMAT_HINTS: Record<FormatId, string> = {
  startup: 'Startup: the newest sets only, with its ban list',
  standard: 'Standard: the current card pool, with its ban list',
  casual: 'Casual: any card, no ban list (deck-building rules still apply)',
};

// Corp before Runner, matching the deck columns below; each side's button wears its side colour
const OPPONENTS: { id: Exclude<Opponent, 'people'>; label: string; hint: string; on: string; off: string }[] = [
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

interface DeckSummary {
  deck: DeckList;
  identityCode: string;
  size: number;
  agendaPoints: number;
  influence: number;
  influenceLimit: number | null;
  problems: string[];
}

function summarize(deck: DeckList): DeckSummary {
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
type ColumnOpts = { title?: string; online?: { format: FormatId; problems: Map<string, string[]> } };

const goClass =
  'disabled:opacity-40 disabled:cursor-not-allowed px-8 py-3 bg-gradient-to-b from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-cyber text-sm tracking-widest font-bold rounded-[2px] border border-amber-300 border-b-4 border-b-amber-600 shadow-xl flex items-center gap-2 active:translate-y-[2px] active:border-b-2 transition-all';

/** An identity's title from its code, for the joiner's look at the host (the code if it isn't a card here). */
function identityTitle(code: string): string {
  try {
    return getCardDefinition(code).title;
  } catch {
    return code;
  }
}

function emptyDeck(side: SideCode): DeckList {
  const identity = ALL_CARDS.find(c => c.side_code === side && c.type_code === 'identity')!;
  return { id: newCustomDeckId(), name: 'New deck', side, identity: identity.title, cards: {}, source: 'custom' };
}

const deckListElement = (side: SideCode) => document.querySelector<HTMLElement>(`[data-testid="deck-list-${side}"]`);

/** Scrolls only the deck list column (not the page) so the deck sits in the middle. */
function scrollDeckIntoView(side: SideCode, deckId: string, behavior: ScrollBehavior = 'smooth') {
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
function deckFullyVisible(side: SideCode, deckId: string): boolean {
  const list = deckListElement(side);
  const item = list?.querySelector<HTMLElement>(`[data-testid="deck-${deckId}"]`);
  if (!list || !item) return true;
  const l = list.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  return r.top >= l.top && r.bottom <= l.bottom;
}

/** Start screen: choose a Corp deck and a Runner deck, or build your own. */
export const DeckPicker: React.FC<DeckPickerProps> = ({
  initialCorpDeckId,
  initialRunnerDeckId,
  onStart,
  onOnline,
  joinCode = null,
  onLeaveLink,
  lobbyFetch,
  initialMode,
  initialRole,
  initialLobby,
  initialHost,
}) => {
  const [customDecks, setCustomDecks] = useState<DeckList[]>(loadCustomDecks);
  const [storageFailed, setStorageFailed] = useState(false);
  const [editing, setEditing] = useState<DeckList | null>(null);
  const [viewing, setViewing] = useState<DeckList | null>(null);
  const [importing, setImporting] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const summaries = useMemo(() => [...DECKS, ...customDecks].map(summarize), [customDecks]);
  const [favorites, setFavorites] = useState<string[]>(loadFavoriteDecks);
  // Premade decks the player hid; they stay listed (faded) while that side's "Show hidden" is on
  const [hidden, setHidden] = useState<string[]>(loadHiddenDecks);
  // A hidden starting deck (such as the default starter) gives way to the top of the list
  const startingDeck = (side: SideCode, id: string) =>
    !hidden.includes(id)
      ? id
      : (favoritesFirst(summaries.filter(s => s.deck.side === side && !hidden.includes(s.deck.id)), favorites, s => s.deck.id)[0]?.deck.id ?? id);
  const [corpId, setCorpId] = useState(() => startingDeck('corp', initialCorpDeckId));
  const [runnerId, setRunnerId] = useState(() => startingDeck('runner', initialRunnerDeckId));
  const [opponent, setOpponent] = useState<Exclude<Opponent, 'people'>>(() => {
    const o = savedOpponent();
    return o === 'people' ? 'ai-corp' : o;
  });
  const [mode, setMode] = useState<PlayMode>(() => initialMode ?? (joinCode ? 'online' : savedMode()));
  const [role, setRole] = useState<OnlineRole>(() => initialRole ?? (joinCode ? 'join' : 'host'));
  const [hostSide, setHostSide] = useState<SideCode>(initialHost?.side ?? 'corp');
  // Casual first (every deck that follows the deck-building rules), then whatever was last hosted
  const [hostFormat, setHostFormat] = useState<FormatId>(() => {
    if (initialHost) return initialHost.format;
    try {
      const f = window.localStorage.getItem(HOST_FORMAT_KEY);
      if (f && (ONLINE_FORMATS as string[]).includes(f)) return f as FormatId;
    } catch {
      // Storage blocked: the default
    }
    return 'casual';
  });
  const [codeText, setCodeText] = useState(joinCode ? `${joinCode.slice(0, 4)}-${joinCode.slice(4)}` : '');
  const [lobby, setLobby] = useState<LobbyInfo | null>(initialLobby ?? null);
  const [onlineError, setOnlineError] = useState<LobbyFailure | null>(null);
  const [busy, setBusy] = useState<'create' | 'find' | 'join' | null>(null);
  const [showHidden, setShowHidden] = useState({ corp: false, runner: false });
  // Where the page and each deck list were scrolled, so coming back from the deckbuilder or a decklist lands in the same place
  const scrollMemory = useRef({ page: 0, corp: 0, runner: 0 });
  const showingList = !editing && !viewing;
  useEffect(() => {
    if (!showingList) return;
    const remember = () => (scrollMemory.current.page = window.scrollY);
    window.addEventListener('scroll', remember);
    return () => window.removeEventListener('scroll', remember);
  }, [showingList]);
  const rememberScroll = () => {
    scrollMemory.current.page = window.scrollY;
    for (const side of ['corp', 'runner'] as const) scrollMemory.current[side] = deckListElement(side)?.scrollTop ?? 0;
  };
  useLayoutEffect(() => {
    if (!showingList) return;
    const memory = scrollMemory.current;
    for (const side of ['corp', 'runner'] as const) {
      const list = deckListElement(side);
      if (list) list.scrollTop = memory[side];
      // A deck picked or saved on the other screen may be off the remembered view
      const selected = side === 'corp' ? corpId : runnerId;
      if (!deckFullyVisible(side, selected)) scrollDeckIntoView(side, selected, 'auto');
    }
    window.scrollTo?.(0, memory.page);
    // Only on returning to the list; later selections scroll themselves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingList]);
  const chooseOpponent = (id: Exclude<Opponent, 'people'>) => {
    setOpponent(id);
    remember(OPPONENT_KEY, id);
  };
  // Leaving the invite link's Join screen puts the address back to /
  const leaveLink = () => {
    if (joinCode) onLeaveLink?.();
  };
  const chooseMode = (id: PlayMode) => {
    setMode(id);
    remember(MODE_KEY, id);
    setOnlineError(null);
    if (id !== 'online') leaveLink();
  };
  const chooseRole = (id: OnlineRole) => {
    setRole(id);
    setOnlineError(null);
    if (id !== 'join') leaveLink();
  };

  // --- Online: host, find, join ---
  const findGame = async (text = codeText) => {
    const code = parseRoomCode(text);
    setLobby(null);
    if (!code) {
      setOnlineError({ ok: false, message: 'That is not a game code (six letters and digits, like K7QM-2X)' });
      return;
    }
    setBusy('find');
    setOnlineError(null);
    const res = await lookupGame(code, lobbyFetch);
    setBusy(null);
    if (res.ok) setLobby(res.lobby);
    else setOnlineError(res);
  };
  // An invite link looks its game up at once
  const lookedUp = useRef(false);
  useEffect(() => {
    if (!joinCode || lookedUp.current || initialLobby) return;
    lookedUp.current = true;
    void findGame(joinCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinCode]);

  const storeDecks = (decks: DeckList[]) => {
    setCustomDecks(decks);
    setStorageFailed(!saveCustomDecks(decks));
  };
  const selectFor = (side: SideCode) => (side === 'corp' ? setCorpId : setRunnerId);
  const storeFavorites = (ids: string[]) => {
    setFavorites(ids);
    if (!saveFavoriteDecks(ids)) setStorageFailed(true);
  };
  const storeHidden = (ids: string[]) => {
    setHidden(ids);
    if (!saveHiddenDecks(ids)) setStorageFailed(true);
  };
  /** The side's decks in list order: favourites first, hidden ones left out unless shown. */
  const listedDecks = (side: SideCode, selected: string, includeHidden: boolean) =>
    favoritesFirst(
      summaries.filter(s => s.deck.side === side && (includeHidden || s.deck.id === selected || !hidden.includes(s.deck.id))),
      favorites,
      s => s.deck.id,
    );
  const hideDeck = (deck: DeckList) => {
    storeHidden([...hidden, deck.id]);
    const selected = deck.side === 'corp' ? corpId : runnerId;
    if (selected !== deck.id) return;
    // Move the selection to the first deck still on the list
    const next = listedDecks(deck.side, '', false).find(s => s.deck.id !== deck.id);
    if (next) selectFor(deck.side)(next.deck.id);
  };

  const saveDeck = (deck: DeckList) => {
    const exists = customDecks.some(d => d.id === deck.id);
    storeDecks(exists ? customDecks.map(d => (d.id === deck.id ? deck : d)) : [...customDecks, deck]);
    selectFor(deck.side)(deck.id);
    setEditing(null);
  };
  const deleteDeck = async (deck: DeckList) => {
    if (!(await showConfirm(`Delete "${deck.name}"? This cannot be undone.`, { title: 'Delete deck', confirmLabel: 'Delete', danger: true }))) return;
    storeDecks(customDecks.filter(d => d.id !== deck.id));
    if (favorites.includes(deck.id)) storeFavorites(favorites.filter(id => id !== deck.id));
    const fallback = DECKS.find(d => d.side === deck.side)!.id;
    if ((deck.side === 'corp' ? corpId : runnerId) === deck.id) selectFor(deck.side)(fallback);
  };
  const copyDeck = (deck: DeckList) =>
    setEditing({ ...deck, id: newCustomDeckId(), name: `${deck.name} (copy)`, cards: { ...deck.cards }, source: 'custom', credit: undefined });

  if (editing) {
    return (
      <Suspense fallback={<div className="p-6 font-mono text-xs text-slate-400">Loading deckbuilder…</div>}>
        <DeckBuilder key={editing.id} initial={editing} onSave={saveDeck} onCancel={() => setEditing(null)} onImport={() => setImporting(true)} />
        {importing && (
          <ImportDeckModal
            onClose={() => setImporting(false)}
            onSave={deck => {
              setImporting(false);
              saveDeck(deck);
            }}
            onEdit={deck => {
              setImporting(false);
              setEditing(deck);
            }}
          />
        )}
      </Suspense>
    );
  }

  if (viewing) {
    const selectedId = viewing.side === 'corp' ? corpId : runnerId;
    return (
      <Suspense fallback={<div className="p-6 font-mono text-xs text-slate-400">Loading decklist…</div>}>
        <DeckViewer
          key={viewing.id}
          deck={viewing}
          onClose={() => setViewing(null)}
          onSelect={selectedId === viewing.id ? undefined : () => {
            selectFor(viewing.side)(viewing.id);
            setViewing(null);
          }}
        />
      </Suspense>
    );
  }

  const selectedProblems = [corpId, runnerId].flatMap(id => summaries.find(s => s.deck.id === id)?.problems ?? ['missing']);
  const selectedFor = (side: SideCode) => (side === 'corp' ? corpId : runnerId);
  const deckById = (id: string) => summaries.find(s => s.deck.id === id)?.deck;
  // Online: each deck's problems for the game's format and side (the server's own test, checkDeck)
  const onlineFormat: FormatId | null = mode !== 'online' ? null : role === 'host' ? hostFormat : (lobby?.format ?? null);
  const onlineSide: SideCode | null = mode !== 'online' ? null : role === 'host' ? hostSide : lobby ? other(lobby.hostSide) : null;
  const onlineProblemMap = (() => {
    const map = new Map<string, string[]>();
    if (!onlineFormat || !onlineSide) return map;
    for (const s of summaries) if (s.deck.side === onlineSide) map.set(s.deck.id, onlineDeckProblems(s.deck, onlineFormat, onlineSide));
    return map;
  })();
  const hostProblems = mode === 'online' && role === 'host' ? (onlineProblemMap.get(selectedFor(hostSide)) ?? ['missing']) : [];
  const joinProblems = mode === 'online' && role === 'join' && lobby ? (onlineProblemMap.get(selectedFor(other(lobby.hostSide))) ?? ['missing']) : [];
  const mySide: SideCode = opponent === 'ai-corp' ? 'runner' : 'corp';
  const deckColumns: { side: SideCode; opts?: ColumnOpts }[] =
    mode === 'computer'
      ? // Corp on the left, Runner on the right, whichever side is yours
        (['corp', 'runner'] as const).map(side => ({
          side,
          opts: { title: `${side === mySide ? 'YOUR' : "COMPUTER'S"} ${sideName(side).toUpperCase()} DECK` },
        }))
      : mode === 'hotseat'
        ? [{ side: 'corp' }, { side: 'runner' }]
        : onlineFormat && onlineSide
          ? [{ side: onlineSide, opts: { title: `YOUR ${sideName(onlineSide).toUpperCase()} DECK`, online: { format: onlineFormat, problems: onlineProblemMap } } }]
          : [];

  const iconButton = (label: string, icon: React.ReactNode, onClick: () => void, testId: string, active = false) => (
    <span
      role="button"
      tabIndex={0}
      title={label}
      aria-label={label}
      data-testid={testId}
      onClick={e => {
        e.stopPropagation();
        rememberScroll();
        onClick();
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          rememberScroll();
          onClick();
        }
      }}
      aria-pressed={active || undefined}
      className={`p-1 rounded-md hover:bg-slate-800 cursor-pointer ${active ? 'text-amber-300 hover:text-amber-200' : 'text-slate-400 hover:text-white'}`}
    >
      {icon}
    </span>
  );

  const column = (side: SideCode, selected: string, select: (id: string) => void, opts: ColumnOpts = {}) => {
    const accent = side === 'corp' ? 'cyan' : 'pink';
    const onlineProblems = (id: string) => opts.online?.problems.get(id) ?? [];
    // Random deck never picks a hidden deck
    const allDecks = summaries.map(s => s.deck).filter(d => !hidden.includes(d.id));
    const hiddenCount = summaries.filter(s => s.deck.side === side && hidden.includes(s.deck.id)).length;
    const listed = listedDecks(side, selected, showHidden[side]);
    const canRandomize = randomDeckPool(allDecks, side).some(d => d.id !== selected);
    return (
      <section className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className={`font-cyber font-bold text-sm tracking-wider ${side === 'corp' ? 'text-cyan-400' : 'text-pink-400'}`}>
            {opts.title ?? (side === 'corp' ? 'CORP DECK' : 'RUNNER DECK')}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const deck = pickRandomDeck(allDecks, side, selected);
                if (!deck) return;
                select(deck.id);
                // Wait for the re-render, then bring the picked deck into view
                requestAnimationFrame(() => scrollDeckIntoView(side, deck.id));
              }}
              disabled={!canRandomize}
              title="Pick a random legal deck (never a starter deck)"
              data-testid={`random-${side}-deck`}
              className="disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-xs font-bold flex items-center gap-1 active:translate-y-[1px] active:border-b-[1px]"
            >
              <Dices className="w-3.5 h-3.5" /> Random deck
            </button>
            <button
              onClick={() => {
                rememberScroll();
                setEditing(emptyDeck(side));
              }}
              data-testid={`new-${side}-deck`}
              className="px-2.5 py-1 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-xs font-bold flex items-center gap-1 active:translate-y-[1px] active:border-b-[1px]"
            >
              <Plus className="w-3.5 h-3.5" /> New deck
            </button>
          </div>
        </div>
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowHidden(v => ({ ...v, [side]: !v[side] }))}
            data-testid={`show-hidden-${side}`}
            className="mb-2 text-[12px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
          >
            {showHidden[side] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {showHidden[side] ? 'Hide hidden decks' : `Show ${hiddenCount} hidden deck${hiddenCount === 1 ? '' : 's'}`}
          </button>
        )}
        <div
          className="flex flex-col gap-2 max-h-[50vh] md:max-h-[65vh] overflow-y-auto pr-1"
          data-testid={`deck-list-${side}`}
          onScroll={e => (scrollMemory.current[side] = e.currentTarget.scrollTop)}
        >
          {listed.map(s => {
              const isSelected = s.deck.id === selected;
              const isFavorite = favorites.includes(s.deck.id);
              const isHidden = hidden.includes(s.deck.id);
              // Online: a deck not legal in the game's format can't be picked; the reasons show on hover
              const notOnline = onlineProblems(s.deck.id);
              const blocked = notOnline.length > 0;
              return (
                <button
                  key={s.deck.id}
                  onClick={() => !blocked && select(s.deck.id)}
                  aria-disabled={blocked || undefined}
                  title={blocked ? `Not legal in ${getFormat(opts.online!.format).name} online:\n${notOnline.join('\n')}` : undefined}
                  data-testid={`deck-${s.deck.id}`}
                  className={`flex items-center gap-3 p-2.5 rounded-[2px] border text-left transition-all ${blocked ? 'cursor-not-allowed ' : ''}${
                    isSelected
                      ? accent === 'cyan'
                        ? 'border-cyan-400 border-l-4 bg-gradient-to-r from-cyan-950/80 to-[#080d14] shadow-lg'
                        : 'border-pink-400 border-l-4 bg-gradient-to-r from-pink-950/80 to-[#080d14] shadow-lg'
                      : 'border-slate-800/80 bg-[#080d14] hover:border-slate-600'
                  }${isHidden || blocked ? ' opacity-50' : ''}`}
                >
                  <img
                    src={getCardImageUrl(s.identityCode)}
                    alt={s.deck.identity}
                    className="w-14 h-20 object-cover rounded-[2px] border border-slate-700 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-100 truncate">{s.deck.name}</div>
                        {s.deck.name !== s.deck.identity && (
                          <div className="text-[12px] text-slate-400 truncate">{s.deck.identity}</div>
                        )}
                      </div>
                      <div className="flex shrink-0">
                        {iconButton(
                          isFavorite ? 'Remove from favourites' : 'Favourite (shows at the top)',
                          <Star className="w-3.5 h-3.5" fill={isFavorite ? 'currentColor' : 'none'} />,
                          () => storeFavorites(toggleId(favorites, s.deck.id)),
                          `favorite-${s.deck.id}`,
                          isFavorite,
                        )}
                        {iconButton('View decklist', <Eye className="w-3.5 h-3.5" />, () => setViewing(s.deck), `view-${s.deck.id}`)}
                        {s.deck.source === 'custom' &&
                          iconButton('Edit deck', <Pencil className="w-3.5 h-3.5" />, () => setEditing(s.deck), `edit-${s.deck.id}`)}
                        {iconButton('Copy into a new deck', <Copy className="w-3.5 h-3.5" />, () => copyDeck(s.deck), `copy-${s.deck.id}`)}
                        {s.deck.source === 'custom' &&
                          iconButton('Delete deck', <Trash2 className="w-3.5 h-3.5" />, () => deleteDeck(s.deck), `delete-${s.deck.id}`)}
                        {s.deck.source !== 'custom' &&
                          (isHidden
                            ? iconButton('Restore deck', <RotateCcw className="w-3.5 h-3.5" />, () => storeHidden(hidden.filter(id => id !== s.deck.id)), `restore-${s.deck.id}`)
                            : listedDecks(side, '', false).length > 1 &&
                              iconButton('Hide deck (restore it with Show hidden)', <EyeOff className="w-3.5 h-3.5" />, () => hideDeck(s.deck), `hide-${s.deck.id}`))}
                      </div>
                    </div>
                    <div className="text-[12px] text-slate-400 font-mono mt-0.5">
                      {s.size} cards
                      {side === 'corp' && <> · {s.agendaPoints} agenda points</>}
                      {s.influenceLimit !== null && (
                        <> · {s.influence}/{s.influenceLimit} influence</>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-[11px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300"
                        title={s.deck.credit}
                      >
                        {s.deck.source === 'official starter' ? 'Official starter' : s.deck.source === 'official sample' ? 'Official sample' : s.deck.source === 'netrunnerdb' ? 'NetrunnerDB' : 'Custom'}
                      </span>
                      {isHidden && (
                        <span className="text-[11px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">Hidden</span>
                      )}
                      {s.deck.format && s.deck.format !== 'casual' && (
                        <span
                          className="text-[11px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-slate-800 text-sky-300"
                          title={getFormat(s.deck.format).banList?.name}
                          data-testid={`format-${s.deck.id}`}
                        >
                          {getFormat(s.deck.format).name}
                        </span>
                      )}
                      {opts.online ? (
                        blocked ? (
                          <span className="text-[12px] text-amber-400 flex items-center gap-1" data-testid={`online-illegal-${s.deck.id}`}>
                            <AlertTriangle className="w-3 h-3" /> Not legal in {getFormat(opts.online.format).name}
                          </span>
                        ) : (
                          <span className="text-[12px] text-emerald-400 flex items-center gap-1" data-testid={`online-legal-${s.deck.id}`}>
                            <CheckCircle2 className="w-3 h-3" /> Legal in {getFormat(opts.online.format).name}
                          </span>
                        )
                      ) : s.problems.length === 0 ? (
                        <span className="text-[12px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Legal
                        </span>
                      ) : (
                        <span className="text-[12px] text-amber-400 flex items-center gap-1" title={s.problems.join('\n')}>
                          <AlertTriangle className="w-3 h-3" /> {s.problems.length} problem(s)
                        </span>
                      )}
                      {s.deck.missing && (
                        <span
                          className="text-[12px] text-amber-400 flex items-center gap-1"
                          title={`Not fully playable: the import left out cards this game doesn't have:\n${s.deck.missing.map(m => `${m.count}x ${m.title}${m.set ? ` (${m.set})` : ''}`).join('\n')}`}
                          data-testid={`incomplete-${s.deck.id}`}
                        >
                          <AlertTriangle className="w-3 h-3" /> {s.deck.missing.reduce((n, m) => n + m.count, 0)} cards left out
                        </span>
                      )}
                    </div>
                    {s.deck.credit && (
                      <div className="text-[11px] text-slate-500 mt-1 line-clamp-2" title={s.deck.credit} data-testid={`credit-${s.deck.id}`}>
                        {s.deck.credit}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen text-slate-100 font-mono flex flex-col items-center px-4 py-8">
      <div className="flex flex-col items-center mb-3">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <h1 className="font-cyber font-black tracking-wider text-2xl sm:text-4xl select-none" data-testid="app-title">
            <span className="text-cyan-400">STACK</span>
            <span className="text-amber-400 mx-1.5 font-mono font-normal">//</span>
            <span className="text-pink-500">HEAP</span>
          </h1>
          <BugReportButton screen="deck picker" />
          {BulkImportModal && (
            <button
              onClick={() => setBulkImporting(true)}
              data-testid="bulk-import"
              title="Beta only: fetch many NetrunnerDB decks at once"
              className="px-2.5 py-1 rounded-[2px] border border-fuchsia-600/80 border-b-2 border-b-fuchsia-500 bg-fuchsia-950/40 text-fuchsia-300 hover:border-fuchsia-400 text-xs font-bold active:translate-y-[1px] active:border-b-[1px]"
            >
              Bulk import (beta)
            </button>
          )}
        </div>
        <p className="text-xs font-mono text-slate-400 tracking-wide mt-1">
          <span className="text-slate-500">//</span> an unofficial netrunner client
        </p>
      </div>
      {BulkImportModal && bulkImporting && (
        <Suspense fallback={null}>
          <BulkImportModal
            saved={customDecks}
            onClose={() => setBulkImporting(false)}
            onSave={decks => {
              setBulkImporting(false);
              storeDecks([...customDecks, ...decks]);
            }}
          />
        </Suspense>
      )}
      <p className="text-xs text-slate-400 mb-6 text-center">
        Choose how you want to play, then the decks. The starter decks are the best place to begin. Build your own with New deck (where you can also import from NetrunnerDB), or copy any deck to tweak it.
      </p>
      {storageFailed && (
        <p className="text-xs text-amber-400 mb-4">This browser would not save your decks, so they will be lost when the page closes.</p>
      )}
      <div className="w-full max-w-5xl mb-6 flex flex-col items-center gap-4" data-testid="game-settings">
        {/* 1. How do you want to play? */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-[12px] uppercase tracking-wider text-slate-500 font-bold">How do you want to play?</span>
          <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="How do you want to play?">
            {MODES.map(m => (
              <button
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => chooseMode(m.id)}
                title={m.hint}
                data-testid={`mode-${m.id}`}
                className={choiceClass(mode === m.id, 'bg-indigo-600 border-indigo-400 text-white')}
              >
                {m.id === 'online' && <Globe className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />}
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-slate-500 text-center">{MODES.find(m => m.id === mode)!.hint}</span>
        </div>

        {/* 2. The settings for that choice */}
        <div className="flex flex-wrap items-start justify-center gap-x-8 gap-y-4">
          {mode === 'computer' && (
            <>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[12px] uppercase tracking-wider text-slate-500 font-bold">Your side</span>
                <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Your side">
                  {OPPONENTS.map(o => (
                    <button
                      key={o.id}
                      role="radio"
                      aria-checked={opponent === o.id}
                      onClick={() => chooseOpponent(o.id)}
                      title={o.hint}
                      data-testid={`opponent-${o.id}`}
                      className={choiceClass(opponent === o.id, o.on, o.off)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <span className="text-[12px] text-slate-500">{OPPONENTS.find(o => o.id === opponent)!.hint}</span>
              </div>
            </>
          )}
          {mode === 'online' && (
            <div className="flex flex-col items-center gap-2">
              <span className="text-[12px] uppercase tracking-wider text-slate-500 font-bold">Online</span>
              <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Host or join">
                <button role="radio" aria-checked={role === 'host'} onClick={() => chooseRole('host')} data-testid="online-host" className={choiceClass(role === 'host', 'bg-indigo-600 border-indigo-400 text-white')}>
                  Host a game
                </button>
                <button role="radio" aria-checked={role === 'join'} onClick={() => chooseRole('join')} data-testid="online-join" className={choiceClass(role === 'join', 'bg-indigo-600 border-indigo-400 text-white')}>
                  Join with a code
                </button>
              </div>
            </div>
          )}
          {mode === 'online' && role === 'host' && (
            <>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[12px] uppercase tracking-wider text-slate-500 font-bold">Your side</span>
                <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Your side">
                  {(['corp', 'runner'] as const).map(side => (
                    <button
                      key={side}
                      role="radio"
                      aria-checked={hostSide === side}
                      onClick={() => setHostSide(side)}
                      data-testid={`host-side-${side}`}
                      className={choiceClass(hostSide === side, SIDE_ON[side], SIDE_OFF[side])}
                    >
                      I play {sideName(side)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[12px] uppercase tracking-wider text-slate-500 font-bold">Format</span>
                <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Format">
                  {ONLINE_FORMATS.map(f => (
                    <button
                      key={f}
                      role="radio"
                      aria-checked={hostFormat === f}
                      onClick={() => {
                        setHostFormat(f);
                        remember(HOST_FORMAT_KEY, f);
                      }}
                      title={FORMAT_HINTS[f]}
                      data-testid={`host-format-${f}`}
                      className={choiceClass(hostFormat === f, 'bg-sky-700 border-sky-400 text-white')}
                    >
                      {getFormat(f).name}
                    </button>
                  ))}
                </div>
                <span className="text-[12px] text-slate-500 text-center max-w-xs">{FORMAT_HINTS[hostFormat]}</span>
              </div>
            </>
          )}
          {mode === 'online' && role === 'join' && (
            <form
              className="flex flex-col items-center gap-2"
              onSubmit={e => {
                e.preventDefault();
                void findGame();
              }}
            >
              <label htmlFor="join-code" className="text-[12px] uppercase tracking-wider text-slate-500 font-bold">
                Game code
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  id="join-code"
                  value={codeText}
                  onChange={e => {
                    setCodeText(e.target.value);
                    setLobby(null);
                  }}
                  placeholder="K7QM-2X"
                  maxLength={12}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="join-code"
                  className="w-36 bg-[#05080e] border border-slate-700 rounded-[2px] px-3 py-1.5 text-base font-bold tracking-[0.2em] uppercase text-amber-200 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={busy === 'find' || codeText.trim().length === 0}
                  data-testid="find-game"
                  className="disabled:opacity-40 px-3 py-1.5 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-xs font-bold flex items-center gap-1"
                >
                  {busy === 'find' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Find game
                </button>
              </div>
            </form>
          )}
        </div>

        {mode === 'online' && role === 'join' && lobby && (
          <div className="flex items-center gap-3 p-3 rounded-[2px] border border-slate-700 bg-[#080d14]" data-testid="lobby-info">
            <img src={getCardImageUrl(lobby.hostIdentity)} alt="" className="w-14 h-20 object-cover rounded-[2px] border border-slate-700 shrink-0" />
            <div className="text-xs space-y-1">
              <div>
                The host plays the <span className={lobby.hostSide === 'corp' ? 'text-cyan-300 font-bold' : 'text-pink-300 font-bold'}>{sideName(lobby.hostSide)}</span>:{' '}
                <span className="font-bold text-slate-100" data-testid="lobby-identity">{identityTitle(lobby.hostIdentity)}</span>
              </div>
              <div>
                Format: <span className="font-bold text-sky-300" data-testid="lobby-format">{getFormat(lobby.format).name}</span>
              </div>
              <div>
                You play the <span className={other(lobby.hostSide) === 'corp' ? 'text-cyan-300 font-bold' : 'text-pink-300 font-bold'} data-testid="lobby-your-side">{sideName(other(lobby.hostSide))}</span>. Pick your deck below.
              </div>
            </div>
          </div>
        )}

        {mode === 'online' && onlineError && (
          <div className="text-xs text-pink-300 text-center max-w-md" role="alert" data-testid="online-error">
            <p className="font-bold">{onlineError.message}</p>
            {onlineError.reasons && onlineError.reasons.length > 0 && (
              <ul className="mt-1 text-pink-200/90 list-disc list-inside text-left">
                {onlineError.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            {onlineError.refresh && (
              <button onClick={() => window.location.reload()} className="mt-2 px-3 py-1 rounded-[2px] bg-amber-500 text-black font-bold" data-testid="lobby-refresh">
                Refresh
              </button>
            )}
          </div>
        )}

        {/* The go button for the mode */}
        <div className="flex flex-col items-center gap-2">
          {mode !== 'online' && selectedProblems.length > 0 && (
            <p className="text-xs text-amber-400 text-center max-w-xs">A selected deck is not legal yet. Fix it in the deckbuilder to play it.</p>
          )}
          {mode !== 'online' && (
            <button
              onClick={() => {
                const deck = (id: string) => summaries.find(s => s.deck.id === id)!.deck;
                onStart(deck(corpId), deck(runnerId), mode === 'computer' ? (opponent === 'ai-corp' ? 'corp' : 'runner') : null, AI_DIFFICULTY);
              }}
              disabled={selectedProblems.length > 0}
              data-testid="start-game"
              className={goClass}
            >
              <Play className="w-4 h-4" /> Start game
            </button>
          )}
          {mode === 'online' && role === 'host' && (
            <>
              {hostProblems.length > 0 && (
                <p className="text-xs text-amber-400 text-center max-w-xs" data-testid="host-deck-illegal">Your deck is not legal in {getFormat(hostFormat).name}. Pick a legal one, or another format.</p>
              )}
              <button
                onClick={async () => {
                  const deck = deckById(selectedFor(hostSide));
                  if (!deck || !onOnline) return;
                  setBusy('create');
                  setOnlineError(null);
                  const res = await createGame({ side: hostSide, deck, format: hostFormat, playerId: playerId() }, lobbyFetch);
                  setBusy(null);
                  if (res.ok) onOnline({ ...res.session, inviting: true });
                  else setOnlineError(res);
                }}
                disabled={hostProblems.length > 0 || busy !== null}
                data-testid="create-game"
                className={goClass}
              >
                {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Create game
              </button>
            </>
          )}
          {mode === 'online' && role === 'join' && lobby && (
            <>
              {joinProblems.length > 0 && (
                <p className="text-xs text-amber-400 text-center max-w-xs" data-testid="join-deck-illegal">Your deck is not legal in {getFormat(lobby.format).name}. Pick a legal one.</p>
              )}
              <button
                onClick={async () => {
                  const deck = deckById(selectedFor(other(lobby.hostSide)));
                  if (!deck || !onOnline) return;
                  setBusy('join');
                  setOnlineError(null);
                  const res = await joinGame(lobby.code, { deck, playerId: playerId() }, lobbyFetch);
                  setBusy(null);
                  if (res.ok) onOnline(res.session);
                  else setOnlineError(res);
                }}
                disabled={joinProblems.length > 0 || busy !== null}
                data-testid="join-game"
                className={goClass}
              >
                {busy === 'join' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Join game
              </button>
            </>
          )}
        </div>
      </div>
      {/* 3. Only the decks that choice needs */}
      <div className="w-full max-w-5xl flex flex-col md:flex-row gap-6" data-testid="deck-columns">
        {deckColumns.map(c => (
          <React.Fragment key={c.side}>{column(c.side, selectedFor(c.side), selectFor(c.side), c.opts)}</React.Fragment>
        ))}
      </div>
      <p className="mt-8 max-w-3xl text-center text-[11px] text-slate-500">
        Game symbols by Null Signal Games,{' '}
        <a
          href="https://creativecommons.org/licenses/by-nd/4.0/"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-slate-300"
        >
          CC BY-ND 4.0
        </a>
        . Card data and art from{' '}
        <a href="https://netrunnerdb.com/" target="_blank" rel="noreferrer" className="underline hover:text-slate-300">
          NetrunnerDB
        </a>
        . Netrunner card text and art © Null Signal Games and/or Fantasy Flight Games. An unofficial, free fan
        project, not produced or endorsed by Null Signal Games or Fantasy Flight Games.
      </p>
    </div>
  );
};
