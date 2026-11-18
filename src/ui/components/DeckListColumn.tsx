import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Dices, Eye, EyeOff, Pencil, Plus, RotateCcw, Search, Star, Trash2, X } from 'lucide-react';
import { SideCode, getFormat } from '../../core';
import { getCardImageUrl } from '../../data/cards';
import { DeckList, pickRandomDeck, randomDeckPool } from '../../data/decks';
import { ColumnOpts, DeckSummary, matchesDeckQuery, scrollDeckIntoView } from '../deckPickerUtils';

interface DeckListColumnProps {
  side: SideCode;
  selected: string;
  onSelect: (id: string) => void;
  opts?: ColumnOpts;
  summaries: DeckSummary[];
  favorites: string[];
  hidden: string[];
  showHidden: boolean;
  onToggleShowHidden: () => void;
  listedDecks: (side: SideCode, selected: string, includeHidden: boolean) => DeckSummary[];
  onToggleFavorite: (id: string) => void;
  onViewDeck: (deck: DeckList) => void;
  onEditDeck: (deck: DeckList) => void;
  onNewDeck: (side: SideCode) => void;
  onCopyDeck: (deck: DeckList) => void;
  onDeleteDeck: (deck: DeckList) => void;
  onHideDeck: (deck: DeckList) => void;
  onRestoreDeck: (id: string) => void;
  onRememberScroll: () => void;
  onScrollList: (side: SideCode, scrollTop: number) => void;
}

/** One side's deck picker column: heading, search box, Random/New buttons, hidden toggle, and selectable deck cards. */
export const DeckListColumn: React.FC<DeckListColumnProps> = ({
  side,
  selected,
  onSelect,
  opts = {},
  summaries,
  favorites,
  hidden,
  showHidden,
  onToggleShowHidden,
  listedDecks,
  onToggleFavorite,
  onViewDeck,
  onEditDeck,
  onNewDeck,
  onCopyDeck,
  onDeleteDeck,
  onHideDeck,
  onRestoreDeck,
  onRememberScroll,
  onScrollList,
}) => {
  const [query, setQuery] = useState('');
  const accent = side === 'corp' ? 'cyan' : 'pink';
  const onlineProblems = (id: string) => opts.online?.problems.get(id) ?? [];
  // Random deck never picks a hidden deck
  const allDecks = summaries.map(s => s.deck).filter(d => !hidden.includes(d.id));
  const hiddenCount = summaries.filter(s => s.deck.side === side && hidden.includes(s.deck.id)).length;
  const listed = listedDecks(side, selected, showHidden);
  const trimmedQuery = query.trim();
  const filtered = trimmedQuery ? listed.filter(s => matchesDeckQuery(s.deck, trimmedQuery)) : listed;
  const canRandomize = randomDeckPool(allDecks, side).some(d => d.id !== selected);

  const iconButton = (label: string, icon: React.ReactNode, onClick: () => void, testId: string, active = false) => (
    <span
      role="button"
      tabIndex={0}
      title={label}
      aria-label={label}
      data-testid={testId}
      onClick={e => {
        e.stopPropagation();
        onRememberScroll();
        onClick();
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onRememberScroll();
          onClick();
        }
      }}
      aria-pressed={active || undefined}
      className={`p-1 rounded-md hover:bg-slate-800 cursor-pointer ${active ? 'text-amber-300 hover:text-amber-200' : 'text-slate-400 hover:text-white'}`}
    >
      {icon}
    </span>
  );

  return (
    <section className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className={`font-cyber font-bold text-sm tracking-wider shrink-0 ${side === 'corp' ? 'text-cyan-400' : 'text-pink-400'}`}>
          {opts.title ?? (side === 'corp' ? 'CORP DECK' : 'RUNNER DECK')}
        </h2>
        <label className="flex items-center gap-1.5 flex-1 min-w-[7rem] bg-slate-900 border border-slate-700/80 rounded-[2px] px-2 py-1 focus-within:border-slate-500">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search..."
            aria-label={`Search ${side === 'corp' ? 'Corp' : 'Runner'} decks`}
            data-testid={`search-${side}-decks`}
            className="bg-transparent flex-1 min-w-0 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              data-testid={`clear-search-${side}`}
              className="text-slate-500 hover:text-slate-300 shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </label>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <button
            onClick={() => {
              const deck = pickRandomDeck(allDecks, side, selected);
              if (!deck) return;
              onSelect(deck.id);
              // Wait for the re-render, then bring the picked deck into view
              requestAnimationFrame(() => scrollDeckIntoView(side, deck.id));
            }}
            disabled={!canRandomize}
            title="Pick a random legal deck (never a starter deck)"
            data-testid={`random-${side}-deck`}
            className="disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-xs font-bold flex items-center gap-1 active:translate-y-[1px] active:border-b-[1px]"
          >
            <Dices className="w-3.5 h-3.5" /> Random
          </button>
          <button
            onClick={() => {
              onRememberScroll();
              onNewDeck(side);
            }}
            data-testid={`new-${side}-deck`}
            className="px-2.5 py-1 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-xs font-bold flex items-center gap-1 active:translate-y-[1px] active:border-b-[1px]"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>
      </div>
      {hiddenCount > 0 && (
        <button
          onClick={onToggleShowHidden}
          data-testid={`show-hidden-${side}`}
          className="mb-2 text-[12px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
        >
          {showHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {showHidden ? 'Hide hidden decks' : `Show ${hiddenCount} hidden deck${hiddenCount === 1 ? '' : 's'}`}
        </button>
      )}
      <div
        className="flex flex-col gap-2 max-h-[50vh] md:max-h-[65vh] overflow-y-auto pr-1"
        data-testid={`deck-list-${side}`}
        onScroll={e => onScrollList(side, e.currentTarget.scrollTop)}
      >
        {filtered.length === 0 && trimmedQuery ? (
          <div
            className="rounded-[2px] border border-dashed border-slate-800 bg-[#080d14] p-4 text-center text-xs text-slate-400"
            data-testid={`no-decks-match-${side}`}
          >
            No decks match &ldquo;{query.trim()}&rdquo;
          </div>
        ) : (
          filtered.map(s => {
            const isSelected = s.deck.id === selected;
            const isFavorite = favorites.includes(s.deck.id);
            const isHidden = hidden.includes(s.deck.id);
            // Online: a deck not legal in the game's format can't be picked; the reasons show on hover
            const notOnline = onlineProblems(s.deck.id);
            const blocked = notOnline.length > 0;
            return (
              <button
                key={s.deck.id}
                onClick={() => !blocked && onSelect(s.deck.id)}
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
                        () => onToggleFavorite(s.deck.id),
                        `favorite-${s.deck.id}`,
                        isFavorite,
                      )}
                      {iconButton('View decklist', <Eye className="w-3.5 h-3.5" />, () => onViewDeck(s.deck), `view-${s.deck.id}`)}
                      {s.deck.source === 'custom' &&
                        iconButton('Edit deck', <Pencil className="w-3.5 h-3.5" />, () => onEditDeck(s.deck), `edit-${s.deck.id}`)}
                      {iconButton('Copy into a new deck', <Copy className="w-3.5 h-3.5" />, () => onCopyDeck(s.deck), `copy-${s.deck.id}`)}
                      {s.deck.source === 'custom' &&
                        iconButton('Delete deck', <Trash2 className="w-3.5 h-3.5" />, () => onDeleteDeck(s.deck), `delete-${s.deck.id}`)}
                      {s.deck.source !== 'custom' &&
                        (isHidden
                          ? iconButton('Restore deck', <RotateCcw className="w-3.5 h-3.5" />, () => onRestoreDeck(s.deck.id), `restore-${s.deck.id}`)
                          : listedDecks(side, '', false).length > 1 &&
                            iconButton('Hide deck (restore it with Show hidden)', <EyeOff className="w-3.5 h-3.5" />, () => onHideDeck(s.deck), `hide-${s.deck.id}`))}
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
          })
        )}
      </div>
    </section>
  );
};
