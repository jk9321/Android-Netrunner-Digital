import React, { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FormatId, SideCode } from '../../core';
import { DECKS, DeckList } from '../../data/decks';
import { loadCustomDecks, newCustomDeckId, saveCustomDecks } from '../../data/customDecks';
import { favoritesFirst, loadFavoriteDecks, loadHiddenDecks, saveFavoriteDecks, saveHiddenDecks, toggleId } from '../../data/deckPrefs';
import type { Difficulty } from '../../ai';
import type { OnlineSession } from '../../net/client';
import { playerId } from '../../net/client';
import { LobbyFailure, createGame, joinGame, lookupGame, onlineDeckProblems } from '../../net/lobby';
import { parseRoomCode } from '../../net/protocol';
import type { LobbyInfo } from '../../net/protocol';
import { showConfirm } from './Dialog';
import { BugReportButton } from './BugReportButton';
import { DeckListColumn } from './DeckListColumn';
import { OnlineLobbyPanel } from './OnlineLobbyPanel';
import {
  AI_DIFFICULTY,
  ColumnOpts,
  MODE_KEY,
  OPPONENT_KEY,
  OnlineRole,
  Opponent,
  PlayMode,
  deckFullyVisible,
  deckListElement,
  emptyDeck,
  other,
  remember,
  savedHostFormat,
  savedMode,
  savedOpponent,
  scrollDeckIntoView,
  sideName,
  summarize,
} from '../deckPickerUtils';

export type { OnlineRole, PlayMode };
import { WhatsNewButton } from './WhatsNewButton';

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
  const [hostFormat, setHostFormat] = useState<FormatId>(() => initialHost?.format ?? savedHostFormat());
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
    const onScroll = () => (scrollMemory.current.page = window.scrollY);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
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

  return (
    <div className="min-h-screen relative text-slate-100 font-mono flex flex-col items-center px-4 py-6">
      <div className="w-full flex justify-between items-center gap-2 mb-3 sm:mb-0 sm:w-auto sm:absolute sm:top-4 sm:inset-x-4 sm:pointer-events-none">
        <div className="flex items-center gap-2 sm:pointer-events-auto">
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
        <WhatsNewButton className="sm:pointer-events-auto" />
      </div>

      <div className="flex flex-col items-center mb-5">
        <h1 className="font-cyber font-black tracking-wider text-3xl sm:text-5xl select-none" data-testid="app-title">
          <span className="text-cyan-400">STACK</span>
          <span className="text-amber-400 mx-1.5 font-mono font-normal">//</span>
          <span className="text-pink-500">HEAP</span>
        </h1>
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
      {storageFailed && (
        <p className="text-xs text-amber-400 mb-4">This browser would not save your decks, so they will be lost when the page closes.</p>
      )}
      <OnlineLobbyPanel
        mode={mode}
        onChooseMode={chooseMode}
        opponent={opponent}
        onChooseOpponent={chooseOpponent}
        role={role}
        onChooseRole={chooseRole}
        hostSide={hostSide}
        onHostSide={setHostSide}
        hostFormat={hostFormat}
        onHostFormat={setHostFormat}
        codeText={codeText}
        onCodeTextChange={text => {
          setCodeText(text);
          setLobby(null);
        }}
        lobby={lobby}
        onlineError={onlineError}
        busy={busy}
        onFindGame={() => void findGame()}
        selectedProblemsCount={selectedProblems.length}
        hostProblemsCount={hostProblems.length}
        joinProblemsCount={joinProblems.length}
        onStartLocal={() => {
          const deck = (id: string) => summaries.find(s => s.deck.id === id)!.deck;
          onStart(deck(corpId), deck(runnerId), mode === 'computer' ? (opponent === 'ai-corp' ? 'corp' : 'runner') : null, AI_DIFFICULTY);
        }}
        onCreateGame={async () => {
          const deck = deckById(selectedFor(hostSide));
          if (!deck || !onOnline) return;
          setBusy('create');
          setOnlineError(null);
          const res = await createGame({ side: hostSide, deck, format: hostFormat, playerId: playerId() }, lobbyFetch);
          setBusy(null);
          if (res.ok) onOnline({ ...res.session, inviting: true });
          else setOnlineError(res);
        }}
        onJoinGame={async () => {
          if (!lobby) return;
          const deck = deckById(selectedFor(other(lobby.hostSide)));
          if (!deck || !onOnline) return;
          setBusy('join');
          setOnlineError(null);
          const res = await joinGame(lobby.code, { deck, playerId: playerId() }, lobbyFetch);
          setBusy(null);
          if (res.ok) onOnline(res.session);
          else setOnlineError(res);
        }}
      />
      {/* 3. Only the decks that choice needs */}
      {deckColumns.length > 0 ? (
        <div className="w-full max-w-5xl flex flex-col md:flex-row gap-6" data-testid="deck-columns">
          {deckColumns.map(c => (
            <DeckListColumn
              key={c.side}
              side={c.side}
              selected={selectedFor(c.side)}
              onSelect={selectFor(c.side)}
              opts={c.opts}
              summaries={summaries}
              favorites={favorites}
              hidden={hidden}
              showHidden={showHidden[c.side]}
              onToggleShowHidden={() => setShowHidden(v => ({ ...v, [c.side]: !v[c.side] }))}
              listedDecks={listedDecks}
              onToggleFavorite={id => storeFavorites(toggleId(favorites, id))}
              onViewDeck={setViewing}
              onEditDeck={setEditing}
              onNewDeck={side => setEditing(emptyDeck(side))}
              onCopyDeck={copyDeck}
              onDeleteDeck={deleteDeck}
              onHideDeck={hideDeck}
              onRestoreDeck={id => storeHidden(hidden.filter(h => h !== id))}
              onRememberScroll={rememberScroll}
              onScrollList={(side, scrollTop) => (scrollMemory.current[side] = scrollTop)}
            />
          ))}
        </div>
      ) : (
        <div className="w-full max-w-lg rounded-[2px] border border-dashed border-slate-800 bg-[#080d14] p-6 text-center space-y-1.5" data-testid="deck-columns">
          <p className="text-xs font-bold text-slate-200">Enter a game code above and click Find game</p>
          <p className="text-xs text-slate-400">Once found, you&apos;ll see the host&apos;s identity and format, and your legal decks for the other side will appear here.</p>
        </div>
      )}
      <p className="mt-8 max-w-3xl text-center text-xs text-slate-400">
        New to the game? Start with the Starter decks. Use <strong className="text-slate-200">New deck</strong> to build or import from NetrunnerDB, or copy any deck to tweak it.
      </p>
      <p className="mt-3 max-w-3xl text-center text-[11px] text-slate-500">
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
