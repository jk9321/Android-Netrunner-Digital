import React, { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SideCode, getCardDefinition, getFormat, influenceCost, validateDeck } from '../../core';
import { DECKS, DeckList, deckCodes, pickRandomDeck, randomDeckPool } from '../../data/decks';
import { ALL_CARDS, getCardImageUrl } from '../../data/cards';
import { loadCustomDecks, newCustomDeckId, saveCustomDecks } from '../../data/customDecks';
import { favoritesFirst, loadFavoriteDecks, loadHiddenDecks, saveFavoriteDecks, saveHiddenDecks, toggleId } from '../../data/deckPrefs';
import type { Difficulty } from '../../ai';
import { CheckCircle2, AlertTriangle, Play, Plus, Pencil, Copy, Trash2, Dices, Eye, EyeOff, RotateCcw, Star } from 'lucide-react';
import { showConfirm } from './Dialog';

// Loaded on first use, so the start screen doesn't wait for them
const DeckBuilder = lazy(() => import('./DeckBuilder').then(m => ({ default: m.DeckBuilder })));
const DeckViewer = lazy(() => import('./DeckBuilder').then(m => ({ default: m.DeckViewer })));
const ImportDeckModal = lazy(() => import('./ImportDeckModal').then(m => ({ default: m.ImportDeckModal })));

interface DeckPickerProps {
  initialCorpDeckId: string;
  initialRunnerDeckId: string;
  onStart: (corpDeck: DeckList, runnerDeck: DeckList, ai: SideCode | null, difficulty: Difficulty) => void;
}

type Opponent = 'people' | 'ai-corp' | 'ai-runner';
const OPPONENT_KEY = 'netrunner.opponent';
const DIFFICULTY_KEY = 'netrunner.difficulty';

function savedDifficulty(): Difficulty {
  try {
    return window.localStorage.getItem(DIFFICULTY_KEY) === 'hard' ? 'hard' : 'normal';
  } catch {
    return 'normal';
  }
}

const DIFFICULTIES: { id: Difficulty; label: string; hint: string }[] = [
  { id: 'normal', label: 'Normal', hint: 'Rule-based: plays a solid, readable game and moves quickly' },
  { id: 'hard', label: 'Hard', hint: 'Looks ahead by playing out its best options many times before each move (thinks for a second or two)' },
];

function savedOpponent(): Opponent {
  try {
    const v = window.localStorage.getItem(OPPONENT_KEY);
    if (v === 'people' || v === 'ai-corp' || v === 'ai-runner') return v;
  } catch {
    // Storage blocked: use the default
  }
  return 'people';
}

// Corp before Runner, matching the deck columns below; each side's button wears its side colour
const OPPONENTS: { id: Opponent; label: string; hint: string; on: string; off: string }[] = [
  {
    id: 'people',
    label: 'Two players',
    hint: 'Pass and play, or one person playing both sides',
    on: 'bg-indigo-600 border-indigo-400 text-white',
    off: 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500',
  },
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
export const DeckPicker: React.FC<DeckPickerProps> = ({ initialCorpDeckId, initialRunnerDeckId, onStart }) => {
  const [customDecks, setCustomDecks] = useState<DeckList[]>(loadCustomDecks);
  const [storageFailed, setStorageFailed] = useState(false);
  const [editing, setEditing] = useState<DeckList | null>(null);
  const [viewing, setViewing] = useState<DeckList | null>(null);
  const [importing, setImporting] = useState(false);
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
  const [opponent, setOpponent] = useState<Opponent>(savedOpponent);
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
  const [difficulty, setDifficulty] = useState<Difficulty>(savedDifficulty);
  const chooseDifficulty = (id: Difficulty) => {
    setDifficulty(id);
    try {
      window.localStorage.setItem(DIFFICULTY_KEY, id);
    } catch {
      // Not saved; the choice still applies now
    }
  };
  const chooseOpponent = (id: Opponent) => {
    setOpponent(id);
    try {
      window.localStorage.setItem(OPPONENT_KEY, id);
    } catch {
      // Not saved; the choice still applies now
    }
  };

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

  const column = (side: SideCode, selected: string, select: (id: string) => void) => {
    const accent = side === 'corp' ? 'cyan' : 'pink';
    // Random deck never picks a hidden deck
    const allDecks = summaries.map(s => s.deck).filter(d => !hidden.includes(d.id));
    const hiddenCount = summaries.filter(s => s.deck.side === side && hidden.includes(s.deck.id)).length;
    const listed = listedDecks(side, selected, showHidden[side]);
    const canRandomize = randomDeckPool(allDecks, side).some(d => d.id !== selected);
    return (
      <section className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className={`font-cyber font-bold text-sm tracking-wider ${side === 'corp' ? 'text-cyan-400' : 'text-pink-400'}`}>
            {side === 'corp' ? 'CORP DECK' : 'RUNNER DECK'}
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
              className="disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg border border-slate-700 hover:border-slate-500 text-xs flex items-center gap-1"
            >
              <Dices className="w-3.5 h-3.5" /> Random deck
            </button>
            <button
              onClick={() => {
                rememberScroll();
                setEditing(emptyDeck(side));
              }}
              data-testid={`new-${side}-deck`}
              className="px-2.5 py-1 rounded-lg border border-slate-700 hover:border-slate-500 text-xs flex items-center gap-1"
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
              return (
                <button
                  key={s.deck.id}
                  onClick={() => select(s.deck.id)}
                  data-testid={`deck-${s.deck.id}`}
                  className={`flex items-center gap-3 p-2.5 chamfer border text-left transition-all ${
                    isSelected
                      ? accent === 'cyan'
                        ? 'border-cyan-400 bg-cyan-950/60 shadow-[inset_0_0_18px_rgb(var(--corp-400)/0.3)]'
                        : 'border-pink-400 bg-pink-950/60 shadow-[inset_0_0_18px_rgb(var(--runner-500)/0.3)]'
                      : 'border-slate-800 bg-slate-950/70 hover:border-slate-600'
                  }${isHidden ? ' opacity-50' : ''}`}
                >
                  <img
                    src={getCardImageUrl(s.identityCode)}
                    alt={s.deck.identity}
                    className="w-14 h-20 object-cover rounded-md border border-slate-700 shrink-0"
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
                      {s.problems.length === 0 ? (
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
      <h1 className="font-cyber font-black tracking-widest text-2xl sm:text-4xl glitch-title mb-1">
        NETRUNNER
      </h1>
      <p className="text-xs text-slate-400 mb-6 text-center">
        Choose a deck for each side. The starter decks are the best place to begin. Build your own with New deck (where you can also import from NetrunnerDB), or copy any deck to tweak it.
      </p>
      {storageFailed && (
        <p className="text-xs text-amber-400 mb-4">This browser would not save your decks, so they will be lost when the page closes.</p>
      )}
      <div className="w-full max-w-5xl mb-6 flex flex-wrap items-start justify-center gap-x-8 gap-y-4" data-testid="game-settings">
        <div className="flex flex-col items-center gap-2">
          <span className="text-[12px] uppercase tracking-wider text-slate-500 font-bold">Opponent</span>
          <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Opponent">
            {OPPONENTS.map(o => (
              <button
                key={o.id}
                role="radio"
                aria-checked={opponent === o.id}
                onClick={() => chooseOpponent(o.id)}
                title={o.hint}
                data-testid={`opponent-${o.id}`}
                className={`px-4 py-2 rounded-xl border text-xs font-bold transition-colors ${
                  opponent === o.id ? o.on : o.off
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-slate-500">{OPPONENTS.find(o => o.id === opponent)!.hint}</span>
        </div>
        {opponent !== 'people' && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-[12px] uppercase tracking-wider text-slate-500 font-bold">Difficulty</span>
            <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Difficulty">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.id}
                  role="radio"
                  aria-checked={difficulty === d.id}
                  onClick={() => chooseDifficulty(d.id)}
                  title={d.hint}
                  data-testid={`difficulty-${d.id}`}
                  className={`px-4 py-2 rounded-xl border text-xs font-bold transition-colors ${
                    difficulty === d.id
                      ? d.id === 'hard'
                        ? 'bg-red-700 border-red-400 text-white'
                        : 'bg-indigo-600 border-indigo-400 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <span className="text-[12px] text-slate-500 text-center max-w-xs">{DIFFICULTIES.find(d => d.id === difficulty)!.hint}</span>
          </div>
        )}
        <div className="flex flex-col items-center gap-2 self-center">
          {selectedProblems.length > 0 && (
            <p className="text-xs text-amber-400 text-center max-w-xs">A selected deck is not legal yet. Fix it in the deckbuilder to play it.</p>
          )}
          <button
            onClick={() => {
              const deck = (id: string) => summaries.find(s => s.deck.id === id)!.deck;
              onStart(deck(corpId), deck(runnerId), opponent === 'ai-corp' ? 'corp' : opponent === 'ai-runner' ? 'runner' : null, difficulty);
            }}
            disabled={selectedProblems.length > 0}
            data-testid="start-game"
            className="disabled:opacity-40 disabled:cursor-not-allowed px-8 py-3 bg-amber-400 hover:bg-amber-300 text-black font-cyber tracking-widest font-bold rounded-2xl shadow-lg flex items-center gap-2"
          >
            <Play className="w-4 h-4" /> Start game
          </button>
        </div>
      </div>
      <div className="w-full max-w-5xl flex flex-col md:flex-row gap-6">
        {column('corp', corpId, setCorpId)}
        {column('runner', runnerId, setRunnerId)}
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
