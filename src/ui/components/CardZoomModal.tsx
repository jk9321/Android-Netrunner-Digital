import React from 'react';
import { createPortal } from 'react-dom';
import { CardInstance } from '../../core/types/card';
import { cardDef, getCardImageUrl } from '../../data/cards';
import { FACTION_COLOR, FACTION_LABEL, typeLine } from '../cardLabels';
import { X, Shield, Trash2, AlertCircle } from 'lucide-react';
import { cardTextHtml } from '../cardText';
import { Keyword } from './Keyword';
import { AgendaDiamondIcon, CreditIcon, MuIcon } from './CreditIcon';

interface CardZoomModalProps {
  card: CardInstance | null;
  onClose: () => void;
}

export const CardZoomModal: React.FC<CardZoomModalProps> = ({
  card,
  onClose,
}) => {
  if (!card) return null;
  const def = cardDef(card);
  const isCorp = def.side_code === 'corp';

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative max-w-2xl w-full bg-[#090d15] border rounded-[2px] p-6 shadow-2xl flex flex-col md:flex-row gap-6 font-mono text-slate-100 ${
          isCorp ? 'border-cyan-600/80 shadow-cyan-950/50' : 'border-pink-600/80 shadow-pink-950/50'
        }`}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 bg-[#0e1422] hover:bg-slate-800 rounded-[2px] text-slate-400 hover:text-white border border-slate-700 border-b-2 border-b-slate-600 active:translate-y-[1px] active:border-b-[1px] transition-colors z-20"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Large Crisp Card Image */}
        <div className="w-full md:w-72 shrink-0 flex items-center justify-center">
          <img
            src={getCardImageUrl(card.cardCode)}
            alt={def.title}
            className="w-full h-auto max-h-[460px] object-contain rounded-[2px] shadow-2xl border border-slate-800"
          />
        </div>

        {/* Details & Rules Panel */}
        <div className="flex-1 flex flex-col justify-between overflow-y-auto max-h-[460px]">
          <div>
            {/* Header info */}
            <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider">
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

            <h2 className={`text-2xl font-cyber font-black ${isCorp ? 'text-cyan-300' : 'text-pink-300'}`}>
              {def.title}
            </h2>
            <p className="text-sm text-slate-400 italic mb-4">
              {typeLine(def)} · <span className={`not-italic ${FACTION_COLOR[def.faction_code]}`}>{FACTION_LABEL[def.faction_code]}</span>
            </p>

            {/* Stats row */}
            <div className="flex flex-wrap gap-2 mb-4 text-xs">
              {def.cost !== null && def.cost !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-3 py-1.5 rounded-[2px]">
                  <CreditIcon className="w-4 h-4 text-amber-400" />
                  <Keyword id="credit" className="text-slate-400">Cost:</Keyword>
                  <span className="font-bold text-amber-300">{def.cost} Credits</span>
                </div>
              )}
              {def.strength !== null && def.strength !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-3 py-1.5 rounded-[2px]">
                  <Shield className="w-4 h-4 text-cyan-400" />
                  <Keyword id="strength" className="text-slate-400">Strength:</Keyword>
                  <span className="font-bold text-cyan-300">{def.strength}</span>
                </div>
              )}
              {def.agenda_points !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-3 py-1.5 rounded-[2px]">
                  <AgendaDiamondIcon className="w-4 h-4 text-cyan-400" />
                  <Keyword id="advancement-requirement" className="text-slate-400">Agenda Points:</Keyword>
                  <span className="font-bold text-cyan-300">
                    {def.agenda_points} (Req: {def.advancement_cost || 0})
                  </span>
                </div>
              )}
              {def.memory_cost !== null && def.memory_cost !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-3 py-1.5 rounded-[2px]">
                  <MuIcon className="w-4 h-4 text-pink-400" />
                  <Keyword id="mu" className="text-slate-400">Memory:</Keyword>
                  <span className="font-bold text-pink-300 inline-flex items-center gap-[0.15em]">{def.memory_cost}<MuIcon /></span>
                </div>
              )}
              {def.trash_cost !== null && def.trash_cost !== undefined && (
                <div className="flex items-center gap-1.5 bg-[#0b101b] border border-slate-800 px-3 py-1.5 rounded-[2px]">
                  <Trash2 className="w-4 h-4 text-red-400" />
                  <Keyword id="trash-cost" className="text-slate-400">Trash:</Keyword>
                  <span className="font-bold text-red-300">{def.trash_cost} Credits</span>
                </div>
              )}
            </div>

            {/* Rules Text */}
            {def.text && (
              <div className="bg-[#0b101b]/90 rounded-[2px] p-4 border border-slate-800 text-sm leading-relaxed mb-4">
                <div
                  dangerouslySetInnerHTML={{
                    __html: cardTextHtml(def.text),
                  }}
                />
              </div>
            )}
          </div>

          {/* Flavor Text */}
          {def.flavor && (
            <div className="text-xs text-slate-400 italic border-t border-slate-900 pt-3">
              "{def.flavor}"
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
