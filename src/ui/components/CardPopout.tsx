import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardInstance } from '../../core/types/card';
import { cardDef, getCardImageUrl } from '../../data/cards';
import { FACTION_COLOR, FACTION_LABEL, typeLine } from '../cardLabels';
import { Shield, Trash2, AlertCircle, Lock, X } from 'lucide-react';
import { GLOSSARY, cardKeywords } from '../glossary';
import { cardTextHtml } from '../cardText';
import { AdvancementIcon, AgendaDiamondIcon, CreditIcon, Credits, MuIcon } from './CreditIcon';
import { liveCardModifiers, useLiveGameState } from '../liveValues';

interface CardPopoutProps {
  card: CardInstance;
  targetRect: DOMRect | null;
  isFaceDown?: boolean;
  canPeek?: boolean;
  seen?: boolean;
  /** Optional close handler when pinned open via tap on touch devices. */
  onClose?: () => void;
}

export const CardPopout: React.FC<CardPopoutProps> = ({
  card,
  targetRect,
  isFaceDown = false,
  canPeek = true,
  seen = false,
  onClose,
}) => {
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const def = cardDef(card);
  const gameState = useLiveGameState();

  const isHiddenSecured = isFaceDown && !canPeek;
  const mods = gameState && !isHiddenSecured && !seen ? liveCardModifiers(gameState, card) : undefined;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const isCompactViewport = vw < 640;
  // Visible cards show the whole card image beside the details on desktop, and a compact header + full-width text on mobile
  const popoutWidth = isHiddenSecured
    ? Math.min(330, vw - 16)
    : isCompactViewport
      ? Math.min(400, vw - 16)
      : Math.min(620, vw - 24);

  useLayoutEffect(() => {
    if (!targetRect) return;
    const padding = isCompactViewport ? 8 : 12;

    const place = () => {
      const curVw = window.innerWidth;
      const curVh = window.innerHeight;
      // The real height once rendered (long card text makes it taller than the estimate)
      const popoutHeight = boxRef.current?.offsetHeight || (isHiddenSecured ? 260 : isCompactViewport ? 320 : 420);

      let left: number;
      let top: number;

      if (curVw < 640) {
        // On narrow mobile screens, center horizontally and place above or below the target so it never clips off-screen
        left = Math.max(padding, Math.round((curVw - popoutWidth) / 2));
        const spaceBelow = curVh - targetRect.bottom - padding;
        const spaceAbove = targetRect.top - padding;
        if (spaceBelow >= Math.min(popoutHeight, 260) || spaceBelow >= spaceAbove) {
          top = Math.min(targetRect.bottom + 8, curVh - popoutHeight - padding);
        } else {
          top = targetRect.top - popoutHeight - 8;
        }
        top = Math.max(padding, Math.min(curVh - popoutHeight - padding, top));
      } else {
        // Determine horizontal position: prefer right, fallback to left
        left = targetRect.right + padding;
        if (left + popoutWidth > curVw - padding) {
          left = targetRect.left - popoutWidth - padding;
        }
        // Clamp to viewport edges
        left = Math.max(padding, Math.min(curVw - popoutWidth - padding, left));

        // Determine vertical position: align with top of card, clamp inside window
        top = targetRect.top - 10;
        if (top + popoutHeight > curVh - padding) {
          top = curVh - popoutHeight - padding;
        }
        top = Math.max(padding, top);
      }

      setCoords(prev => (prev.top === top && prev.left === left ? prev : { top, left }));
    };
    place();
    // The card image loads after the first placement and grows the box, so place it again
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(place);
    observer.observe(box);
    return () => observer.disconnect();
  }, [targetRect, popoutWidth, isHiddenSecured, isCompactViewport]);

  if (!targetRect) return null;

  const isCorp = def.side_code === 'corp';

  const rulesAndFooter = (
    <>
      {/* Formatted Ability Rules Text */}
      {def.text && (
        <div className="bg-[#06090e]/80 rounded-[2px] p-2.5 sm:p-3 border border-slate-800/90 text-xs leading-relaxed text-slate-200">
          <div
            className="card-rules-text font-mono space-y-1"
            dangerouslySetInnerHTML={{
              __html: cardTextHtml(def.text),
            }}
          />
        </div>
      )}

      {/* The popout can't be hovered, so list what this card's rules terms mean */}
      {def.text && cardKeywords(def.text).length > 0 && (
        <div className="mt-2 space-y-1 text-[11px] leading-snug" data-testid="popout-keywords">
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
        <div className="mt-2 text-[11px] text-slate-400 italic border-t border-slate-900 pt-2 leading-relaxed">
          "{def.flavor}"
        </div>
      )}
    </>
  );

  const popoutContent = (
    <div
      ref={boxRef}
      onClick={onClose ? e => e.stopPropagation() : undefined}
      style={{
        position: 'fixed',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 9999,
        width: `${popoutWidth}px`,
        maxHeight: isCompactViewport ? `${Math.min(Math.round(vh * 0.78), 520)}px` : '90vh',
      }}
      className={`${onClose ? 'pointer-events-auto' : 'pointer-events-none'} rounded-[2px] p-3 sm:p-4 font-mono shadow-2xl backdrop-blur-xl border transition-opacity duration-150 animate-in fade-in zoom-in-95 overflow-y-auto ${
        isHiddenSecured
          ? 'bg-[#090d15]/95 border-slate-700 shadow-slate-900/80 text-slate-300'
          : isCorp
          ? 'bg-[#070d18]/95 border-cyan-600/80 shadow-[0_0_30px_rgb(var(--corp-400)/0.25)] text-slate-100'
          : 'bg-[#140810]/95 border-pink-600/80 shadow-[0_0_30px_rgb(var(--runner-500)/0.25)] text-slate-100'
      }`}
    >
      {/* Hidden Corp Card View for Runner */}
      {isHiddenSecured ? (
        <div className="flex flex-col items-center justify-center py-6 sm:py-8 text-center">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-[2px] bg-[#0c121d] border border-slate-700 flex items-center justify-center mb-3 text-cyan-400">
            <Lock className="w-6 h-6 sm:w-7 sm:h-7" />
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
            <div className="mt-3 px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded-[2px] text-amber-300 text-xs font-bold inline-flex items-center gap-1.5">
              <AdvancementIcon className="w-3.5 h-3.5" />
              <span>{card.advancementCounters} Advancement Counter{card.advancementCounters > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex gap-3 sm:gap-4 items-start">
            {/* The whole card, uncropped (compact thumbnail on phones, full side column on sm+) */}
            <div className="relative w-24 sm:w-[44%] sm:max-w-[260px] shrink-0">
              <img
                src={getCardImageUrl(card.cardCode)}
                alt={def.title}
                className="w-full h-auto aspect-[63/88] rounded-[2px] border border-slate-800 shadow-inner bg-black/60"
              />
              {card.advancementCounters > 0 && (
                <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 bg-amber-400 text-black font-black text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-[2px] shadow-lg border border-amber-200 flex items-center gap-1">
                  <AdvancementIcon className="w-3 h-3" />
                  <span>{card.advancementCounters} ADV</span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {/* Top Pill / Badge Header */}
              <div className="flex items-center justify-between gap-1 pb-1.5 sm:pb-2 mb-1.5 sm:mb-2 border-b border-slate-800 text-[11px] sm:text-[12px]">
                <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider truncate">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isCorp ? 'bg-cyan-400 shadow-[0_0_6px_#00f0ff]' : 'bg-pink-400 shadow-[0_0_6px_#ff0055]'
                    }`}
                  />
                  <span className={`truncate ${isCorp ? 'text-cyan-400' : 'text-pink-400'}`}>
                    {def.side_code.toUpperCase()} // {def.type_code.toUpperCase()}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isFaceDown && !card.isRezzed && (
                    <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold bg-amber-950/80 text-amber-400 border border-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> UNREZZED
                    </span>
                  )}
                  {card.faceUp && !card.isRezzed && (
                    <span className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-600 flex items-center gap-1">
                      FACE UP
                    </span>
                  )}
                  {onClose && (
                    <button
                      onClick={onClose}
                      aria-label="Close card preview"
                      className="p-1 rounded-[2px] bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Title & Subtypes */}
              <div className="mb-2 sm:mb-2.5">
                <h3
                  className={`text-sm sm:text-base font-bold leading-tight font-cyber ${
                    isCorp ? 'text-cyan-300' : 'text-pink-300'
                  }`}
                >
                  {def.title}
                </h3>
                <div className="text-[11px] sm:text-[12px] text-slate-400 italic mt-0.5">
                  {typeLine(def)} · <span className={`not-italic ${FACTION_COLOR[def.faction_code]}`}>{FACTION_LABEL[def.faction_code]}</span>
                </div>
              </div>

              {/* Key Stat Badges Row */}
              <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 gap-1 sm:gap-1.5 mb-1 sm:mb-3 text-[11px] sm:text-xs">
                {def.cost !== null && def.cost !== undefined && (
                  <div
                    className={`flex items-center gap-1.5 bg-[#0c121d] border px-2 sm:px-2.5 py-1 rounded-[2px] ${
                      mods?.cost
                        ? mods.cost.current < mods.cost.printed
                          ? 'border-emerald-600/80'
                          : 'border-amber-500/80'
                        : 'border-slate-800'
                    }`}
                  >
                    <CreditIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-slate-400">Cost:</span>
                    {mods?.cost ? (
                      <span className={`font-bold ${mods.cost.current < mods.cost.printed ? 'text-emerald-300' : 'text-amber-300'}`}>
                        <Credits amount={mods.cost.current} />{' '}
                        <span className="text-slate-400 font-normal">(was {mods.cost.printed})</span>
                      </span>
                    ) : (
                      <span className="font-bold text-amber-300"><Credits amount={def.cost} /></span>
                    )}
                  </div>
                )}

                {def.strength !== null && def.strength !== undefined && (
                  <div
                    className={`flex items-center gap-1.5 bg-[#0c121d] border px-2 sm:px-2.5 py-1 rounded-[2px] ${
                      mods?.strength
                        ? mods.strength.current > mods.strength.printed
                          ? 'border-emerald-600/80'
                          : 'border-amber-500/80'
                        : 'border-slate-800'
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="text-slate-400">Strength:</span>
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
                  <div className="flex items-center gap-1.5 bg-[#0c121d] border border-slate-800 px-2 sm:px-2.5 py-1 rounded-[2px]">
                    <AgendaDiamondIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="text-slate-400">Points:</span>
                    <span className="font-bold text-cyan-300">
                      {def.agenda_points} {def.advancement_cost ? `(${def.advancement_cost} req)` : ''}
                    </span>
                  </div>
                )}

                {def.memory_cost !== null && def.memory_cost !== undefined && (
                  <div className="flex items-center gap-1.5 bg-[#0c121d] border border-slate-800 px-2 sm:px-2.5 py-1 rounded-[2px]">
                    <MuIcon className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                    <span className="text-slate-400">Memory:</span>
                    <span className="font-bold text-pink-300 inline-flex items-center gap-[0.15em]">{def.memory_cost}<MuIcon /></span>
                  </div>
                )}

                {def.trash_cost !== null && def.trash_cost !== undefined && (
                  <div className="flex items-center gap-1.5 bg-[#0c121d] border border-slate-800 px-2 sm:px-2.5 py-1 rounded-[2px]">
                    <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="text-slate-400">Trash:</span>
                    <span className="font-bold text-red-300"><Credits amount={def.trash_cost} /></span>
                  </div>
                )}
              </div>

              {/* Desktop (sm+): rules & keywords stay in the right column */}
              <div className="hidden sm:block">{rulesAndFooter}</div>
            </div>
          </div>

          {/* Mobile (< sm): rules & keywords span full popout width so nothing is squished */}
          <div className="sm:hidden">{rulesAndFooter}</div>
        </div>
      )}
    </div>
  );

  return createPortal(popoutContent, document.body);
};
