import { groupMissingBySet } from '../../data/deckPlayability';
import React, { useMemo, useState } from 'react';
import { DEFAULT_FORMAT, FORMATS, FormatId, describeFormatStatuses, formatStatuses, getFormat, influenceCost, requiredAgendaPoints, validateDeck } from '../../core';
import { CardDefinition, CardTypeCode, FactionCode } from '../../core/types/card';
import { DeckList, deckCodes } from '../../data/decks';
import { ALL_CARDS, CARD_SETS, getCardImageUrl } from '../../data/cards';
import { CardZoomModal } from './CardZoomModal';
import { CardPopout } from './CardPopout';
import { FACTION_COLOR, FACTION_LABEL } from '../cardLabels';
import { BugReportButton } from './BugReportButton';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileDown, Minus, Plus, Save, Search, ZoomIn } from 'lucide-react';
import { TYPE_LABEL, TYPE_ORDER, asInstance, byTitle, sortCards } from '../deckBuilderUtils';
import { CardBadges, FormatMarker, InfluencePips, Stat, TypeIcons, useCardHover } from './DeckBuilderCards';

export { DeckViewer } from './DeckViewer';

interface DeckBuilderProps {
  /** The deck to edit: a saved custom deck, a copy of another deck, or a new empty one. */
  initial: DeckList;
  onSave: (deck: DeckList) => void;
  onCancel: () => void;
  /** Opens the NetrunnerDB import window. */
  onImport?: () => void;
}

/** Pick an identity, add and remove cards, and see the deck's legality as you go. */
export const DeckBuilder: React.FC<DeckBuilderProps> = ({ initial, onSave, onCancel, onImport }) => {
  const side = initial.side;
  const [name, setName] = useState(initial.name);
  const [identityTitle, setIdentityTitle] = useState(initial.identity);
  const [cards, setCards] = useState<Record<string, number>>(initial.cards);
  const [formatId, setFormatId] = useState<FormatId>(initial.format ?? DEFAULT_FORMAT);
  const format = getFormat(formatId);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<CardTypeCode | 'all'>('all');
  const [factionFilter, setFactionFilter] = useState<'all' | 'playable' | FactionCode>('all');
  const [setFilter, setSetFilter] = useState<string>('all');
  const [zoomCode, setZoomCode] = useState<string | null>(null);
  const { hover, setHover, hoverProps } = useCardHover();

  const identities = useMemo(
    () => ALL_CARDS.filter(c => c.side_code === side && c.type_code === 'identity'),
    [side]
  );
  const identity = byTitle.get(identityTitle) ?? identities[0];
  const pool = useMemo(
    () => ALL_CARDS.filter(c => c.side_code === side && c.type_code !== 'identity').sort(sortCards),
    [side]
  );
  const factions = [...new Set(pool.map(c => c.faction_code))];

  const draft: DeckList = { ...initial, name: name.trim() || 'Untitled deck', identity: identity.title, cards, format: formatId, source: 'custom' };
  const codes = deckCodes(draft);
  const defs = codes.cards.map(code => ALL_CARDS.find(c => c.code === code)!);
  const problems = validateDeck(codes);
  const size = defs.length;
  const influence = defs.reduce((n, d) => n + influenceCost(identity, d), 0);
  const points = defs.reduce((n, d) => n + (d.agenda_points ?? 0), 0);
  const [minPoints, maxPoints] = requiredAgendaPoints(size);

  const countOf = (c: CardDefinition) => cards[c.title] ?? 0;
  const change = (c: CardDefinition, delta: number) => {
    setCards(prev => {
      const n = Math.max(0, Math.min(c.deck_limit ?? 3, (prev[c.title] ?? 0) + delta));
      const next = { ...prev };
      if (n === 0) delete next[c.title];
      else next[c.title] = n;
      return next;
    });
  };

  const q = query.trim().toLowerCase();
  const shown = pool.filter(c => {
    if (typeFilter !== 'all' && c.type_code !== typeFilter) return false;
    if (setFilter !== 'all' && c.pack_code !== setFilter) return false;
    if (factionFilter === 'playable') {
      // Hide out-of-faction agendas and cards whose influence would not fit at all
      const cost = influenceCost(identity, c);
      if (c.type_code === 'agenda' && cost > 0) return false;
      if (identity.influence_limit != null && cost > identity.influence_limit) return false;
    } else if (factionFilter !== 'all' && c.faction_code !== factionFilter) return false;
    if (q && !`${c.title} ${c.keywords ?? ''} ${c.stripped_text ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const inDeck = Object.keys(cards)
    .map(t => byTitle.get(t)!)
    .sort(sortCards);
  const accent = side === 'corp' ? 'cyan' : 'pink';
  const accentText = side === 'corp' ? 'text-cyan-400' : 'text-pink-400';

  const influencePips = (c: CardDefinition) => <InfluencePips identity={identity} card={c} />;
  const formatMarker = (c: CardDefinition) => <FormatMarker card={c} />;
  // Deck cards (and the identity) that some format bans or restricts
  const limited = [identity, ...inDeck]
    .map(c => ({ card: c, text: describeFormatStatuses(formatStatuses(c)) }))
    .filter(x => x.text);

  const stat = (label: string, value: string, ok: boolean) => <Stat label={label} value={value} ok={ok} />;

  return (
    <div className="min-h-screen text-slate-100 font-mono px-4 py-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-xs font-bold flex items-center gap-1.5 active:translate-y-[1px] active:border-b-[1px]"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h1 className={`font-cyber font-black tracking-widest text-lg ${accentText}`}>
            {side === 'corp' ? 'CORP' : 'RUNNER'} DECKBUILDER
          </h1>
          <BugReportButton screen="deck builder" />
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Deck name"
            aria-label="Deck name"
            data-testid="deck-name"
            className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-700 rounded-[2px] px-3 py-1.5 text-sm focus:outline-none focus:border-slate-400"
          />
          {onImport && (
            <button
              onClick={onImport}
              data-testid="import-deck"
              title="Import a deck from a NetrunnerDB export, file or link"
              className="px-3 py-1.5 rounded-[2px] border border-indigo-500/70 border-b-2 border-b-indigo-400 bg-indigo-950/50 text-xs font-bold flex items-center gap-1.5 active:translate-y-[1px] active:border-b-[1px]"
            >
              <FileDown className="w-3.5 h-3.5" /> Import from NetrunnerDB
            </button>
          )}
          <button
            onClick={() => onSave(draft)}
            data-testid="save-deck"
            className={`px-4 py-1.5 rounded-[2px] text-sm font-bold border-b-2 active:translate-y-[1px] active:border-b-[1px] flex items-center gap-1.5 text-white ${
              accent === 'cyan' ? 'bg-cyan-700 hover:bg-cyan-600 border-cyan-500' : 'bg-pink-700 hover:bg-pink-600 border-pink-500'
            }`}
          >
            <Save className="w-4 h-4" /> Save deck
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Card pool */}
          <section className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-2 mb-3">
              <label className="flex items-center gap-2 flex-1 min-w-[12rem] bg-slate-900 border border-slate-700 rounded-[2px] px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-slate-500" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search title, subtype or text"
                  className="bg-transparent flex-1 text-sm focus:outline-none"
                />
              </label>
              <select
                value={factionFilter}
                onChange={e => setFactionFilter(e.target.value as typeof factionFilter)}
                aria-label="Faction filter"
                className="bg-slate-900 border border-slate-700 rounded-[2px] px-2 py-1.5 text-sm"
              >
                <option value="all">All factions</option>
                <option value="playable">Playable with this identity</option>
                {factions.map(f => (
                  <option key={f} value={f}>{FACTION_LABEL[f]}</option>
                ))}
              </select>
              <select
                value={setFilter}
                onChange={e => setSetFilter(e.target.value)}
                aria-label="Set filter"
                data-testid="set-filter"
                className="bg-slate-900 border border-slate-700 rounded-[2px] px-2 py-1.5 text-sm"
              >
                <option value="all">All sets</option>
                {CARD_SETS.map(set => (
                  <option key={set.code} value={set.code}>{set.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {(['all', ...TYPE_ORDER[side]] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-2.5 py-1 rounded-[2px] text-xs border border-b-2 active:translate-y-[1px] active:border-b-[1px] ${
                    typeFilter === t ? 'border-slate-300 bg-slate-800 text-white' : 'border-slate-800 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {t === 'all' ? 'All' : TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3" data-testid="card-pool">
              {shown.map(c => {
                const n = countOf(c);
                const limit = c.deck_limit ?? 3;
                return (
                  <div
                    key={c.code}
                    data-testid={`pool-${c.code}`}
                    className={`rounded-[2px] border border-slate-800 p-1.5 bg-[#080d14] flex flex-col gap-1 ${
                      n > 0 ? (accent === 'cyan' ? 'border-cyan-600' : 'border-pink-600') : 'border-slate-800'
                    }`}
                  >
                    <button onClick={() => change(c, 1)} className="relative group" {...hoverProps(c.code)}>
                      <img
                        src={getCardImageUrl(c.code)}
                        alt={c.title}
                        loading="lazy"
                        className="w-full aspect-[63/88] object-cover rounded-[2px]"
                      />
                      <CardBadges card={c} format={format} count={n} />
                    </button>
                    <div className="text-[12px] leading-tight truncate" title={c.title}>{c.title}</div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className={`truncate ${FACTION_COLOR[c.faction_code]}`}>{FACTION_LABEL[c.faction_code]}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        {formatMarker(c)}
                        {influencePips(c)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => change(c, -1)}
                        disabled={n === 0}
                        aria-label={`Remove ${c.title}`}
                        className="flex-1 py-0.5 rounded-[2px] bg-slate-800 hover:bg-slate-700 border border-slate-700/80 border-b-2 border-b-slate-600 active:translate-y-[1px] active:border-b-[1px] disabled:opacity-30 flex justify-center"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setZoomCode(c.code)}
                        aria-label={`Inspect ${c.title}`}
                        className="py-0.5 px-1.5 rounded-[2px] bg-slate-800 hover:bg-slate-700 border border-slate-700/80 border-b-2 border-b-slate-600 active:translate-y-[1px] active:border-b-[1px]"
                      >
                        <ZoomIn className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => change(c, 1)}
                        disabled={n >= limit}
                        aria-label={`Add ${c.title}`}
                        className="flex-1 py-0.5 rounded-[2px] bg-slate-800 hover:bg-slate-700 border border-slate-700/80 border-b-2 border-b-slate-600 active:translate-y-[1px] active:border-b-[1px] disabled:opacity-30 flex justify-center"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {shown.length === 0 && <p className="text-sm text-slate-500 col-span-full">No cards match.</p>}
            </div>
          </section>

          {/* Deck summary */}
          <aside className="lg:w-80 shrink-0 flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
            <div className="flex gap-3 items-start">
              <img
                src={getCardImageUrl(identity.code)}
                alt={identity.title}
                {...hoverProps(identity.code)}
                className="w-16 h-[5.6rem] object-cover rounded-[2px] border border-slate-700 shrink-0"
              />
              <label className="flex-1 min-w-0">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">Identity</span>
                <select
                  value={identity.title}
                  onChange={e => { setIdentityTitle(e.target.value); setHover(null); }}
                  aria-label="Identity"
                  {...hoverProps(identity.code)}
                  data-testid="identity-select"
                  className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-[2px] px-2 py-1.5 text-xs"
                >
                  {identities.map(i => (
                    <option key={i.code} value={i.title}>{i.title}</option>
                  ))}
                </select>
                <span className={`text-[12px] ${FACTION_COLOR[identity.faction_code]}`}>{FACTION_LABEL[identity.faction_code]}</span>
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Format</span>
              <select
                value={formatId}
                onChange={e => setFormatId(e.target.value as FormatId)}
                aria-label="Format"
                data-testid="format-select"
                className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-[2px] px-2 py-1.5 text-xs"
              >
                {FORMATS.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <span className="text-[12px] text-slate-500">
                {format.description}
                {format.banList && <> Ban list: {format.banList.name}.</>}
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              {stat('Cards', `${size} / ${identity.minimum_deck_size ?? 0}`, size >= (identity.minimum_deck_size ?? 0))}
              {identity.influence_limit != null &&
                stat('Influence', `${influence} / ${identity.influence_limit}`, influence <= identity.influence_limit)}
              {side === 'corp' &&
                stat('Agenda pts', `${points} / ${minPoints}-${maxPoints}`, points >= minPoints && points <= maxPoints)}
            </div>

            {problems.length === 0 ? (
              <div className="text-xs text-emerald-400 flex items-center gap-1.5" data-testid="deck-legal">
                <CheckCircle2 className="w-4 h-4" /> Legal deck
              </div>
            ) : (
              <ul className="text-xs text-amber-400 flex flex-col gap-1" data-testid="deck-problems">
                {problems.map(p => (
                  <li key={p} className="flex gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {p}
                  </li>
                ))}
              </ul>
            )}

            {initial.missing && (
              <div className="rounded-[2px] border border-amber-900/60 bg-amber-950/20 p-2.5" data-testid="import-left-out">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Left out of the import (not in this game)</div>
                {groupMissingBySet(initial.missing).map(g => (
                  <div key={g.set} className="text-xs mb-1">
                    <div className="text-[12px] text-amber-300">{g.set}</div>
                    <ul className="text-amber-200/80 ml-3">
                      {g.cards.map(m => (
                        <li key={m.title}>
                          {m.count}x {m.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {limited.length > 0 && (
              <div className="rounded-[2px] border border-red-900/60 bg-red-950/20 p-2.5" data-testid="format-limits">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Banned or restricted</div>
                <ul className="flex flex-col gap-1 text-xs">
                  {limited.map(({ card, text }) => (
                    <li key={card.code}>
                      <button onClick={() => setZoomCode(card.code)} className="hover:underline text-left" {...hoverProps(card.code)}>{card.title}</button>
                      <div className="text-[12px] text-red-300/90">{text}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-[2px] border border-slate-800 bg-[#080d14] p-2.5 max-h-[60vh] overflow-y-auto">
              {inDeck.length === 0 && <p className="text-xs text-slate-500">Click cards on the left to add them.</p>}
              {TYPE_ORDER[side].map(t => {
                const group = inDeck.filter(c => c.type_code === t);
                if (group.length === 0) return null;
                const total = group.reduce((n, c) => n + countOf(c), 0);
                return (
                  <div key={t} className="mb-2 last:mb-0">
                    <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                      {TYPE_LABEL[t]} ({total})
                    </div>
                    {group.map(c => (
                      <div key={c.code} className="flex items-center gap-1.5 text-xs py-0.5">
                        <button onClick={() => change(c, -1)} aria-label={`Remove ${c.title}`} className="text-slate-500 hover:text-slate-200">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-4 text-right font-bold">{countOf(c)}</span>
                        <button
                          onClick={() => change(c, 1)}
                          disabled={countOf(c) >= (c.deck_limit ?? 3)}
                          aria-label={`Add ${c.title}`}
                          className="text-slate-500 hover:text-slate-200 disabled:opacity-30"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button onClick={() => setZoomCode(c.code)} className="truncate text-left hover:underline flex-1" {...hoverProps(c.code)}>
                          {c.title}
                        </button>
                        {formatMarker(c)}
                        {influencePips(c)}
                        <TypeIcons card={c} className="text-[8px] shrink-0" />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
      {hover && !zoomCode && <CardPopout card={asInstance(hover.code)} targetRect={hover.rect} />}
      <CardZoomModal
        card={zoomCode ? asInstance(zoomCode) : null}
        onClose={() => setZoomCode(null)}
      />
    </div>
  );
};
