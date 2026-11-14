import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CardInstance } from '../../core/types/card';
import { cardDef, getCardImageUrl } from '../../data/cards';
import { FACTION_COLOR, FACTION_LABEL, typeLine } from '../cardLabels';
import { X, Shield, Trash2, AlertCircle } from 'lucide-react';
import { cardTextHtml } from '../cardText';
import { GLOSSARY, cardKeywords } from '../glossary';
import { Keyword } from './Keyword';
import { AgendaDiamondIcon, CreditIcon, Credits, MuIcon } from './CreditIcon';
import { liveCardModifiers, useLiveGameState } from '../liveValues';

interface CardZoomModalProps {
  card: CardInstance | null;
  onClose: () => void;
}

export const CardZoomModal: React.FC<CardZoomModalProps> = ({
  card,
  onClose,
}) => {
  const gameState = useLiveGameState();

  useEffect(() => {
    if (!card) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [card, onClose]);

  if (!card) return null;
  const def = cardDef(card);
  const isCorp = def.side_code === 'corp';
  const mods = gameState ? liveCardModifiers(gameState, card) : undefined;
  const keywords = def.text ? cardKeywords(def.text) : [];

  return createPortal(
    <div
      onClick={onClose}
      data-testid="card-zoom-modal"
      className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-2.5 sm:p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative max-w-2xl w-full max-h-[calc(100dvh-1.25rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto bg-[#090d15] border rounded-[2px] p-4 sm:p-6 shadow-2xl flex flex-col md:flex-row gap-4 sm:gap-6 font-mono text-slate-100 ${
          isCorp ? 'border-cyan-600/80 shadow-cyan-950/50' : 'border-pink-600/80 shadow-pink-950/50'
        }`}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close card inspect"
          data-testid="close-card-zoom"
          className="sticky md:absolute top-0 md:top-4 right-0 md:right-4 self-end -mb-8 md:mb-0 p-2 sm:p-1.5 bg-[#0e1422]/95 hover:bg-slate-800 rounded-[2px] text-slate-300 hover:text-white border border-slate-700 border-b-2 border-b-slate-600 active:translate-y-[1px] active:border-b-[1px] transition-colors z-20"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Large Crisp Card Image */}
        <div className="w-full md:w-72 shrink-0 flex items-center justify-center">
          <img
            src={getCardImageUrl(card.cardCode)}
            alt={def.title}
            className="w-auto max-w-full h-auto max-h-[36dvh] sm:max-h-[42dvh] md:max-h-[460px] object-contain rounded-[2px] shadow-2xl border border-slate-800"
          />
        </div>

        {/* Details & Rules Panel */}
        <div className="flex-1 flex flex-col justify-between md:overflow-y-auto md:max-h-[460px]">
          <div>
            {/* Header info */}
            <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider pr-8 md:pr-10">
              <span
                className={`px-2 py-0.5 rounded border ${
                  isCorp
                    ? 'bg-cyan-950 border-cyan-700 text-cyan-300'
                    : 'bg-pink-950 border-pink-700 text-pink-300'
                }`}
              >
                {def.side_code} // {def.type_code}
              </span>
              {!card.isRezzed && !card.faceUp && (
                <span className="px-2 py-0.5 rounded border bg-amber-950 border-amber-600 text-amber-300 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> <Keyword id="unrezzed">Unrezzed</Keyword>
                </span>
              )}
            </div>

            <h2 className={`text-xl sm:text-2xl font-cyber font-black ${isCorp ? 'text-cyan-300' : 'text-pink-300'}`}>
              {def.title}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 italic mb-3 sm:mb-4">
              {typeLine(def, card)} · <span className={`not-italic ${FACTION_COLOR[def.faction_code]}`}>{FACTION_LABEL[def.faction_code]}</span>
            </p>

            {/* Stats row */}
            <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-3 sm:mb-4 text-xs">
              {def.cost !== null && def.cost !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-[2px]">
                  <CreditIcon className="w-4 h-4 text-amber-400" />
                  <Keyword id="credit" className="text-slate-400">Cost:</Keyword>
                  {mods?.cost ? (
                    <span className={`font-bold ${mods.cost.current < mods.cost.printed ? 'text-emerald-300' : 'text-amber-300'}`}>
                      <Credits amount={mods.cost.current} />{' '}
                      <span className="text-slate-400 font-normal">(was {mods.cost.printed})</span>
                    </span>
                  ) : (
                    <span className="font-bold text-amber-300">{def.cost} Credits</span>
                  )}
                </div>
              )}
              {def.strength !== null && def.strength !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-[2px]">
                  <Shield className="w-4 h-4 text-cyan-400" />
                  <Keyword id="strength" className="text-slate-400">Strength:</Keyword>
                  {mods?.strength ? (
                    <span className={`font-bold ${mods.strength.current > mods.strength.printed ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {mods.strength.current}{' '}
                      <span className="text-slate-400 font-normal">(was {mods.strength.printed})</span>
                    </span>
                  ) : (
                    <span className="font-bold text-cyan-300">{def.strength}</span>
                  )}
                </div>
              )}
              {def.agenda_points !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-[2px]">
                  <AgendaDiamondIcon className="w-4 h-4 text-cyan-400" />
                  <Keyword id="advancement-requirement" className="text-slate-400">Agenda Points:</Keyword>
                  <span className="font-bold text-cyan-300">
                    {def.agenda_points} (Req: {def.advancement_cost || 0})
                  </span>
                </div>
              )}
              {def.memory_cost !== null && def.memory_cost !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-[2px]">
                  <MuIcon className="w-4 h-4 text-pink-400" />
                  <Keyword id="mu" className="text-slate-400">Memory:</Keyword>
                  <span className="font-bold text-pink-300 inline-flex items-center gap-[0.15em]">{def.memory_cost}<MuIcon /></span>
                </div>
              )}
              {def.trash_cost !== null && def.trash_cost !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-[2px]">
                  <Trash2 className="w-4 h-4 text-red-400" />
                  <Keyword id="trash-cost" className="text-slate-400">Trash:</Keyword>
                  <span className="font-bold text-red-300">{def.trash_cost} Credits</span>
                </div>
              )}
            </div>

            {/* Rules Text */}
            {def.text && (
              <div className="bg-[#0b101b]/90 rounded-[2px] p-3 sm:p-4 border border-slate-800 text-xs sm:text-sm leading-relaxed mb-3 sm:mb-4">
                <div
                  className="card-rules-text space-y-1"
                  dangerouslySetInnerHTML={{
                    __html: cardTextHtml(def.text),
                  }}
                />
              </div>
            )}

            {/* Glossary definitions for terms on the card (shown on mobile/tablet where hover isn't used) */}
            {keywords.length > 0 && (
              <div className="md:hidden mb-3 space-y-1 text-[11px] leading-snug bg-[#06090e]/70 border border-slate-800/80 rounded-[2px] p-2.5" data-testid="zoom-keywords">
                {keywords.map(id => (
                  <div key={id}>
                    <span className="font-bold text-amber-300">{GLOSSARY[id].term}:</span>{' '}
                    <span className="text-slate-400">{GLOSSARY[id].text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Flavor Text */}
          {def.flavor && (
            <div className="text-xs text-slate-400 italic border-t border-slate-900 pt-2.5 sm:pt-3">
              "{def.flavor}"
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
