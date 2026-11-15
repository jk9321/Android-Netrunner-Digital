import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { DEFAULT_FORMAT, getCardDefinition, getFormat, influenceCost, requiredAgendaPoints, validateDeck } from '../../core';
import { getCardImageUrl } from '../../data/cards';
import { DeckList, deckCodes } from '../../data/decks';
import { FACTION_COLOR, FACTION_LABEL } from '../cardLabels';
import { TYPE_LABEL, TYPE_ORDER, asInstance, sortCards } from '../deckBuilderUtils';
import { BugReportButton } from './BugReportButton';
import { CardPopout } from './CardPopout';
import { CardZoomModal } from './CardZoomModal';
import { CardBadges, FormatMarker, InfluencePips, Stat, useCardHover } from './DeckBuilderCards';

interface DeckViewerProps {
  deck: DeckList;
  onClose: () => void;
  /** Picks this deck for the game, when it isn't already picked. */
  onSelect?: () => void;
}

/** Read-only look at a deck: its identity and its cards with their counts, laid out like the deckbuilder. */
export const DeckViewer: React.FC<DeckViewerProps> = ({ deck, onClose, onSelect }) => {
  const side = deck.side;
  const format = getFormat(deck.format ?? DEFAULT_FORMAT);
  const [zoomCode, setZoomCode] = useState<string | null>(null);
  const { hover, hoverProps } = useCardHover();

  const codes = deckCodes(deck);
  const identity = getCardDefinition(codes.identity);
  const defs = codes.cards.map(getCardDefinition);
  const problems = validateDeck(codes);
  const size = defs.length;
  const influence = defs.reduce((n, d) => n + influenceCost(identity, d), 0);
  const points = defs.reduce((n, d) => n + (d.agenda_points ?? 0), 0);
  const [minPoints, maxPoints] = requiredAgendaPoints(size);
  const counts = new Map<string, number>();
  for (const code of codes.cards) counts.set(code, (counts.get(code) ?? 0) + 1);
  const inDeck = [...counts.keys()].map(getCardDefinition).sort(sortCards);
  const accent = side === 'corp' ? 'cyan' : 'pink';
  const accentText = side === 'corp' ? 'text-cyan-400' : 'text-pink-400';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !zoomCode && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoomCode]);

  return (
    <div className="min-h-screen text-slate-100 font-mono px-4 py-6" data-testid="deck-viewer">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <button
            onClick={onClose}
            data-testid="close-deck-view"
            className="px-3 py-1.5 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-xs font-bold flex items-center gap-1.5 active:translate-y-[1px] active:border-b-[1px]"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <h1 className={`font-cyber font-black tracking-widest text-lg ${accentText}`}>
            {side === 'corp' ? 'CORP' : 'RUNNER'} DECKLIST
          </h1>
          <BugReportButton screen="decklist" />
          <div className="flex-1 min-w-[12rem] text-sm font-bold truncate" data-testid="viewed-deck-name">{deck.name}</div>
          {onSelect && (
            <button
              onClick={onSelect}
              data-testid="select-viewed-deck"
              className={`px-4 py-1.5 rounded-[2px] text-sm font-bold border-b-2 active:translate-y-[1px] active:border-b-[1px] flex items-center gap-1.5 text-white ${
                accent === 'cyan' ? 'bg-cyan-700 hover:bg-cyan-600 border-cyan-500' : 'bg-pink-700 hover:bg-pink-600 border-pink-500'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" /> Use this deck
            </button>
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* The deck's cards, grouped by type */}
          <section className="flex-1 min-w-0 flex flex-col gap-4" data-testid="deck-view-cards">
            {inDeck.length === 0 && <p className="text-sm text-slate-500">This deck has no cards yet.</p>}
            {TYPE_ORDER[side].map(t => {
              const group = inDeck.filter(c => c.type_code === t);
              if (group.length === 0) return null;
              const total = group.reduce((n, c) => n + counts.get(c.code)!, 0);
              return (
                <div key={t}>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                    {TYPE_LABEL[t]} ({total})
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
                    {group.map(c => (
                      <div
                        key={c.code}
                        data-testid={`view-${c.code}`}
                        className={`rounded-[2px] border border-slate-800 p-1.5 bg-[#080d14] flex flex-col gap-1 ${accent === 'cyan' ? 'border-cyan-600' : 'border-pink-600'}`}
                      >
                        <button onClick={() => setZoomCode(c.code)} aria-label={`Inspect ${c.title}`} className="relative" {...hoverProps(c.code)}>
                          <img
                            src={getCardImageUrl(c.code)}
                            alt={c.title}
                            loading="lazy"
                            className="w-full aspect-[63/88] object-cover rounded-[2px]"
                          />
                          <CardBadges card={c} format={format} count={counts.get(c.code)!} />
                        </button>
                        <div className="text-[12px] leading-tight truncate" title={c.title}>{c.title}</div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className={`truncate ${FACTION_COLOR[c.faction_code]}`}>{FACTION_LABEL[c.faction_code]}</span>
                          <span className="flex items-center gap-1 shrink-0">
                            <FormatMarker card={c} />
                            <InfluencePips identity={identity} card={c} />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>

          {/* Identity and legality */}
          <aside className="lg:w-80 shrink-0 flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
            <div className="flex gap-3 items-start">
              <button onClick={() => setZoomCode(identity.code)} aria-label={`Inspect ${identity.title}`} className="shrink-0" {...hoverProps(identity.code)}>
                <img
                  src={getCardImageUrl(identity.code)}
                  alt={identity.title}
                  className="w-16 h-[5.6rem] object-cover rounded-[2px] border border-slate-700"
                />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Identity</div>
                <div className="text-sm font-bold mt-1" data-testid="viewed-identity">{identity.title}</div>
                <span className={`text-[12px] ${FACTION_COLOR[identity.faction_code]}`}>{FACTION_LABEL[identity.faction_code]}</span>
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Format</div>
              <div className="text-xs mt-1">{format.name}</div>
              <span className="text-[12px] text-slate-500">
                {format.description}
                {format.banList && <> Ban list: {format.banList.name}.</>}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Stat label="Cards" value={`${size} / ${identity.minimum_deck_size ?? 0}`} ok={size >= (identity.minimum_deck_size ?? 0)} />
              {identity.influence_limit != null && (
                <Stat label="Influence" value={`${influence} / ${identity.influence_limit}`} ok={influence <= identity.influence_limit} />
              )}
              {side === 'corp' && (
                <Stat label="Agenda pts" value={`${points} / ${minPoints}-${maxPoints}`} ok={points >= minPoints && points <= maxPoints} />
              )}
            </div>

            {problems.length === 0 ? (
              <div className="text-xs text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Legal deck
              </div>
            ) : (
              <ul className="text-xs text-amber-400 flex flex-col gap-1">
                {problems.map(p => (
                  <li key={p} className="flex gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {p}
                  </li>
                ))}
              </ul>
            )}

            {deck.credit && <p className="text-[12px] text-slate-500">{deck.credit}</p>}
          </aside>
        </div>
      </div>
      {hover && !zoomCode && <CardPopout card={asInstance(hover.code)} targetRect={hover.rect} />}
      <CardZoomModal card={zoomCode ? asInstance(zoomCode) : null} onClose={() => setZoomCode(null)} />
    </div>
  );
};
