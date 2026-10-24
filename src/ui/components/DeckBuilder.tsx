import React, { useMemo, useState } from 'react';
import { DEFAULT_FORMAT, FORMATS, FormatId, getFormat, influenceCost, isBanned, isInCardPool, requiredAgendaPoints, validateDeck } from '../../core';
import { CardDefinition, CardTypeCode, FactionCode, SideCode } from '../../core/types/card';
import { DeckList, deckCodes } from '../../data/decks';
import { ALL_CARDS, CARD_SETS, getCardImageUrl } from '../../data/cards';
import { getCardScript } from '../../core/scripts';
import { CardZoomModal } from './CardZoomModal';
import { FACTION_COLOR, FACTION_LABEL } from '../cardLabels';
import { AlertTriangle, ArrowLeft, CheckCircle2, Minus, Plus, Save, Search, ZoomIn } from 'lucide-react';

interface DeckBuilderProps {
  /** The deck to edit: a saved custom deck, a copy of another deck, or a new empty one. */
  initial: DeckList;
  onSave: (deck: DeckList) => void;
  onCancel: () => void;
}

const TYPE_ORDER: Record<SideCode, CardTypeCode[]> = {
  corp: ['agenda', 'asset', 'upgrade', 'operation', 'ice'],
  runner: ['event', 'hardware', 'resource', 'program'],
};

const TYPE_LABEL: Partial<Record<CardTypeCode, string>> = {
  agenda: 'Agendas', asset: 'Assets', upgrade: 'Upgrades', operation: 'Operations', ice: 'Ice',
  event: 'Events', hardware: 'Hardware', resource: 'Resources', program: 'Programs',
};

const byTitle = new Map(ALL_CARDS.map(c => [c.title, c]));
/** Elevation cards whose abilities aren't in the engine yet (every System Gateway card is). */
const unscripted = (c: CardDefinition) => c.pack_code !== 'sg' && !!c.text && !getCardScript(c.code);
const typeRank = (c: CardDefinition) => TYPE_ORDER[c.side_code].indexOf(c.type_code);
const sortCards = (a: CardDefinition, b: CardDefinition) => typeRank(a) - typeRank(b) || a.title.localeCompare(b.title);

/** Pick an identity, add and remove cards, and see the deck's legality as you go. */
export const DeckBuilder: React.FC<DeckBuilderProps> = ({ initial, onSave, onCancel }) => {
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

  const influencePips = (c: CardDefinition) => {
    const cost = influenceCost(identity, c);
    return cost > 0 ? <span className="text-amber-400" title={`${cost} influence`}>{'●'.repeat(cost)}</span> : null;
  };

  const stat = (label: string, value: string, ok: boolean) => (
    <div className="flex-1 min-w-[5.5rem] rounded-xl border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-bold ${ok ? 'text-slate-100' : 'text-amber-400'}`}>{value}</div>
    </div>
  );

  return (
    <div className="min-h-screen text-slate-100 font-mono px-4 py-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-xl border border-slate-700 hover:border-slate-500 text-xs flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h1 className={`font-cyber font-black tracking-widest text-lg ${accentText}`}>
            {side === 'corp' ? 'CORP' : 'RUNNER'} DECKBUILDER
          </h1>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Deck name"
            aria-label="Deck name"
            data-testid="deck-name"
            className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-slate-400"
          />
          <button
            onClick={() => onSave(draft)}
            data-testid="save-deck"
            className={`px-4 py-1.5 rounded-xl text-sm font-bold flex items-center gap-1.5 text-white ${
              accent === 'cyan' ? 'bg-cyan-700 hover:bg-cyan-600' : 'bg-pink-700 hover:bg-pink-600'
            }`}
          >
            <Save className="w-4 h-4" /> Save deck
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Card pool */}
          <section className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-2 mb-3">
              <label className="flex items-center gap-2 flex-1 min-w-[12rem] bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5">
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
                className="bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-sm"
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
                className="bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-sm"
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
                  className={`px-2.5 py-1 rounded-lg text-xs border ${
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
                    className={`rounded-xl border p-1.5 bg-slate-950/80 flex flex-col gap-1 ${
                      n > 0 ? (accent === 'cyan' ? 'border-cyan-600' : 'border-pink-600') : 'border-slate-800'
                    }`}
                  >
                    <button onClick={() => change(c, 1)} title={`Add ${c.title}`} className="relative group">
                      <img
                        src={getCardImageUrl(c.code)}
                        alt={c.title}
                        loading="lazy"
                        className="w-full aspect-[63/88] object-cover rounded-md"
                      />
                      {(isBanned(format, c) || !isInCardPool(format, c)) && (
                        <span
                          className="absolute top-1 left-1 rounded bg-red-900/90 text-red-200 text-[9px] font-bold px-1 py-0.5"
                          title={isBanned(format, c) ? `Banned in ${format.name} (${format.banList?.name})` : `Not in the ${format.name} card pool`}
                          data-testid={`banned-${c.code}`}
                        >
                          {isBanned(format, c) ? 'BANNED' : 'NOT LEGAL'}
                        </span>
                      )}
                      {unscripted(c) && (
                        <span
                          className="absolute bottom-1 left-1 right-1 rounded bg-amber-900/90 text-amber-200 text-[9px] font-bold text-center py-0.5"
                          title="This card's abilities are not implemented yet"
                        >
                          NOT SCRIPTED YET
                        </span>
                      )}
                      {n > 0 && (
                        <span className="absolute top-1 right-1 min-w-[1.5rem] h-6 px-1 rounded-full bg-black/85 border border-slate-500 text-xs font-bold flex items-center justify-center">
                          {n}
                        </span>
                      )}
                    </button>
                    <div className="text-[11px] leading-tight truncate" title={c.title}>{c.title}</div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className={FACTION_COLOR[c.faction_code]}>{FACTION_LABEL[c.faction_code]}</span>
                      {influencePips(c)}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => change(c, -1)}
                        disabled={n === 0}
                        aria-label={`Remove ${c.title}`}
                        className="flex-1 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-30 flex justify-center"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setZoomCode(c.code)}
                        aria-label={`Inspect ${c.title}`}
                        className="py-0.5 px-1.5 rounded-md bg-slate-800 hover:bg-slate-700"
                      >
                        <ZoomIn className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => change(c, 1)}
                        disabled={n >= limit}
                        aria-label={`Add ${c.title}`}
                        className="flex-1 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-30 flex justify-center"
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
                className="w-16 h-[5.6rem] object-cover rounded-md border border-slate-700 shrink-0"
              />
              <label className="flex-1 min-w-0">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">Identity</span>
                <select
                  value={identity.title}
                  onChange={e => setIdentityTitle(e.target.value)}
                  aria-label="Identity"
                  data-testid="identity-select"
                  className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-xs"
                >
                  {identities.map(i => (
                    <option key={i.code} value={i.title}>{i.title}</option>
                  ))}
                </select>
                <span className={`text-[11px] ${FACTION_COLOR[identity.faction_code]}`}>{FACTION_LABEL[identity.faction_code]}</span>
              </label>
            </div>

            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Format</span>
              <select
                value={formatId}
                onChange={e => setFormatId(e.target.value as FormatId)}
                aria-label="Format"
                data-testid="format-select"
                className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-xs"
              >
                {FORMATS.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <span className="text-[11px] text-slate-500">
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

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 max-h-[60vh] overflow-y-auto">
              {inDeck.length === 0 && <p className="text-xs text-slate-500">Click cards on the left to add them.</p>}
              {TYPE_ORDER[side].map(t => {
                const group = inDeck.filter(c => c.type_code === t);
                if (group.length === 0) return null;
                const total = group.reduce((n, c) => n + countOf(c), 0);
                return (
                  <div key={t} className="mb-2 last:mb-0">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
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
                        <button onClick={() => setZoomCode(c.code)} className="truncate text-left hover:underline flex-1">
                          {c.title}
                        </button>
                        {influencePips(c)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
      <CardZoomModal
        card={
          zoomCode
            ? { instanceId: 'deckbuilder-zoom', cardCode: zoomCode, isRezzed: true, advancementCounters: 0, tokens: {}, hostedCardIds: [] }
            : null
        }
        onClose={() => setZoomCode(null)}
      />
    </div>
  );
};
