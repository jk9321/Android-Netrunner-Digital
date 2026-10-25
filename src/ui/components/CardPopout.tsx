import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardInstance } from '../../core/types/card';
import { cardDef, getCardImageUrl } from '../../data/cards';
import { FACTION_COLOR, FACTION_LABEL, typeLine } from '../cardLabels';
import { Shield, Award, Trash2, AlertCircle, Lock } from 'lucide-react';
import { GLOSSARY, annotateKeywords, cardKeywords } from '../glossary';
import { CreditIcon, Credits, CREDIT_ICON_HTML, RECURRING_CREDIT_ICON_HTML, MU_ICON_HTML, MuIcon } from './CreditIcon';

interface CardPopoutProps {
  card: CardInstance;
  targetRect: DOMRect | null;
  isFaceDown?: boolean;
  canPeek?: boolean;
}

export const CardPopout: React.FC<CardPopoutProps> = ({
  card,
  targetRect,
  isFaceDown = false,
  canPeek = true,
}) => {
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const def = cardDef(card);

  const isHiddenSecured = isFaceDown && !canPeek;
  // Visible cards show the whole card image beside the details, so nothing is cropped
  const popoutWidth = isHiddenSecured ? 330 : Math.min(620, window.innerWidth - 24);

  useLayoutEffect(() => {
    if (!targetRect) return;

    const popoutHeight = isHiddenSecured ? 300 : 420;
    const padding = 12;

    // Determine horizontal position: prefer right, fallback to left
    let left = targetRect.right + padding;
    if (left + popoutWidth > window.innerWidth - padding) {
      left = targetRect.left - popoutWidth - padding;
    }
    // Clamp to viewport edges
    left = Math.max(padding, Math.min(window.innerWidth - popoutWidth - padding, left));

    // Determine vertical position: align with top of card, clamp inside window
    let top = targetRect.top - 10;
    if (top + popoutHeight > window.innerHeight - padding) {
      top = window.innerHeight - popoutHeight - padding;
    }
    top = Math.max(padding, top);

    setCoords({ top, left });
  }, [targetRect, popoutWidth, isHiddenSecured]);

  if (!targetRect) return null;

  const isCorp = def.side_code === 'corp';

  const popoutContent = (
    <div
      style={{
        position: 'fixed',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 9999,
        width: `${popoutWidth}px`,
        maxHeight: '90vh',
      }}
      className={`pointer-events-none rounded-2xl p-4 font-mono shadow-2xl backdrop-blur-xl border-2 transition-opacity duration-150 animate-in fade-in zoom-in-95 overflow-y-auto ${
        isHiddenSecured
          ? 'bg-slate-950/95 border-slate-700 shadow-slate-900/80 text-slate-300'
          : isCorp
          ? 'bg-cyan-950/95 border-cyan-500 shadow-[0_0_30px_rgb(var(--corp-400)/0.25)] text-slate-100'
          : 'bg-pink-950/95 border-pink-500 shadow-[0_0_30px_rgb(var(--runner-500)/0.25)] text-slate-100'
      }`}
    >
      {/* Hidden Corp Card View for Runner */}
      {isHiddenSecured ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center mb-3 text-cyan-400">
            <Lock className="w-7 h-7" />
          </div>
          <h4 className={`font-bold text-sm tracking-wider uppercase mb-1 ${def.side_code === 'runner' ? 'text-pink-400' : 'text-cyan-400'}`}>
            {def.side_code === 'runner' ? '[HIDDEN RUNNER CARD]' : '[SECURED CORP NODE]'}
          </h4>
          <p className="text-xs text-slate-400 max-w-[240px] leading-relaxed">
            {def.side_code === 'runner'
              ? 'In the Runner\'s grip. Only the Runner can see it.'
              : 'Hidden from the Runner until it is rezzed or accessed.'}
          </p>
          {card.advancementCounters > 0 && (
            <div className="mt-3 px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded-full text-amber-300 text-xs font-bold">
              ★ {card.advancementCounters} Advancement Counter{card.advancementCounters > 1 ? 's' : ''}
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-4 items-start">
          {/* The whole card, uncropped (some cards have their art at the bottom) */}
          <div className="relative w-[44%] max-w-[260px] shrink-0">
            <img
              src={getCardImageUrl(card.cardCode)}
              alt={def.title}
              className="w-full h-auto rounded-xl border border-slate-800 shadow-inner bg-black/60"
            />
            {card.advancementCounters > 0 && (
              <div className="absolute top-2 right-2 bg-amber-400 text-black font-black text-xs px-2 py-0.5 rounded-full shadow-lg border border-amber-200">
                ★ {card.advancementCounters} ADVANCED
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
          {/* Top Pill / Badge Header */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[11px]">
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
              <span
                className={`w-2 h-2 rounded-full ${
                  isCorp ? 'bg-cyan-400 shadow-[0_0_6px_#00f0ff]' : 'bg-pink-400 shadow-[0_0_6px_#ff0055]'
                }`}
              />
              <span className={isCorp ? 'text-cyan-400' : 'text-pink-400'}>
                {def.side_code.toUpperCase()} // {def.type_code.toUpperCase()}
              </span>
            </div>

            {isFaceDown && !card.isRezzed && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-400 border border-amber-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> UNREZZED
              </span>
            )}
          </div>

          {/* Title & Subtypes */}
          <div className="mb-2.5">
            <h3
              className={`text-base font-bold leading-tight font-cyber ${
                isCorp ? 'text-cyan-300' : 'text-pink-300'
              }`}
            >
              {def.title}
            </h3>
            <div className="text-[11px] text-slate-400 italic mt-0.5">
              {typeLine(def)} · <span className={`not-italic ${FACTION_COLOR[def.faction_code]}`}>{FACTION_LABEL[def.faction_code]}</span>
            </div>
          </div>

          {/* Key Stat Badges Row */}
          <div className="grid grid-cols-2 gap-1.5 mb-3 text-xs">
            {def.cost !== null && def.cost !== undefined && (
              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded-lg">
                <CreditIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-slate-400">Cost:</span>
                <span className="font-bold text-amber-300"><Credits amount={def.cost} /></span>
              </div>
            )}

            {def.strength !== null && def.strength !== undefined && (
              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded-lg">
                <Shield className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-slate-400">Strength:</span>
                <span className="font-bold text-cyan-300">{def.strength}</span>
              </div>
            )}

            {def.agenda_points !== undefined && (
              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded-lg">
                <Award className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-slate-400">Points:</span>
                <span className="font-bold text-cyan-300">
                  {def.agenda_points} {def.advancement_cost ? `(${def.advancement_cost} req)` : ''}
                </span>
              </div>
            )}

            {def.memory_cost !== null && def.memory_cost !== undefined && (
              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded-lg">
                <MuIcon className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                <span className="text-slate-400">Memory:</span>
                <span className="font-bold text-pink-300 inline-flex items-center gap-[0.15em]">{def.memory_cost}<MuIcon /></span>
              </div>
            )}

            {def.trash_cost !== null && def.trash_cost !== undefined && (
              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded-lg">
                <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="text-slate-400">Trash:</span>
                <span className="font-bold text-red-300"><Credits amount={def.trash_cost} /></span>
              </div>
            )}
          </div>

          {/* Formatted Ability Rules Text */}
          {def.text && (
            <div className="bg-black/60 rounded-xl p-3 border border-slate-800/90 text-xs leading-relaxed text-slate-200">
              <div
                className="card-rules-text font-mono space-y-1"
                dangerouslySetInnerHTML={{
                  __html: annotateKeywords(def.text)
                    .replace(/\[credit\]/g, `<span data-kw="credit" class="kw-label text-amber-400 font-bold inline-flex items-center">${CREDIT_ICON_HTML}</span>`)
                    .replace(/\[click\]/g, '<span data-kw="click" class="kw-label text-red-400 font-bold inline-flex items-center">⏱️</span>')
                    .replace(/\[subroutine\]/g, '<span data-kw="subroutine" class="kw-label text-cyan-400 font-bold block mt-1">↳ <strong class="text-white">Subroutine:</strong></span>')
                    .replace(/\[trash\]/g, '<span data-kw="trash" class="kw-label text-red-400 font-bold inline-flex items-center">🗑️</span>')
                    .replace(/\[recurring-credit\]/g, `<span data-kw="recurring-credit" class="kw-label text-amber-300 font-bold inline-flex items-center">${RECURRING_CREDIT_ICON_HTML}</span>`)
                    .replace(/\[mu\]/g, `<span data-kw="mu" class="kw-label text-pink-300 font-bold inline-flex items-center">${MU_ICON_HTML}</span>`)
                    .replace(/\[link\]/g, '<span data-kw="link" class="kw-label text-emerald-400 font-bold inline-flex items-center">🔗</span>')
                    .replace(/\n/g, '<br />'),
                }}
              />
            </div>
          )}

          {/* The popout can't be hovered, so list what this card's rules terms mean */}
          {def.text && cardKeywords(def.text).length > 0 && (
            <div className="mt-2 space-y-1 text-[10px] leading-snug" data-testid="popout-keywords">
              {cardKeywords(def.text).map(id => (
                <div key={id}>
                  <span className="font-bold text-amber-300">{GLOSSARY[id].term}:</span>{' '}
                  <span className="text-slate-400">{GLOSSARY[id].text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Flavor Text */}
          {def.flavor && (
            <div className="mt-2 text-[10px] text-slate-400 italic border-t border-slate-900 pt-2 leading-relaxed">
              "{def.flavor}"
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(popoutContent, document.body);
};
