import React, { useRef, useState } from 'react';
import { CardInstance } from '../../core/types/card';
import { cardDef, getCardImageUrl, getCardBackUrl } from '../../data/cards';
import { Lock, Eye } from 'lucide-react';
import { CardPopout } from './CardPopout';
import { motion } from 'framer-motion';
import { Credits } from './CreditIcon';
import { Keyword } from './Keyword';
import { useZoom } from './ZoomPanel';
import { createPortal } from 'react-dom';
import { usePromptHighlight } from '../promptHighlight';
import { IceTypeIcons, breakerTypes } from './IceTypeIcons';
import { iceSubtypes } from '../../core/engine/ice';
import type { IceSubtype } from '../../core/scripts/types';

export interface CardViewProps {
  card: CardInstance;
  isFaceDown?: boolean;
  canPeek?: boolean;
  /** Face down with nothing to explain (an R&D access the Corp can't see): just the card back, no text popout. */
  plainBack?: boolean;
  isSelectable?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onInspect?: (card: CardInstance) => void;
  /** fit and fit-sm follow the window height (--card-w in index.css); the rest are fixed. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'fit' | 'fit-sm';
  /** Only installed cards are rezzed or unrezzed; hide the badge for cards in hand or in a pile. */
  notInstalled?: boolean;
  /**
   * Show the ice or icebreaker type icons (never on a hidden card): true reads them from the card,
   * a list gives them (ice with a subtype granted by Chromatophores).
   */
  typeIcons?: boolean | IceSubtype[];
  /** Turned 90 degrees by its parent (ice on the table); the badges are laid out upright all the same. */
  sideways?: boolean;
  /** A tag under the card's status, e.g. the ice a trojan is installed on. */
  tag?: React.ReactNode;
  /** Buttons over the card (Rez, Advance, Score), kept between the top and bottom badges. */
  actions?: React.ReactNode;
  /**
   * A facedown Corp card shown from the Runner's memory: they saw it before (rezzed or accessed) and may
   * remember it (rules 1.12.5, 10.2.2b). Faded and marked Seen so it never passes for a rezzed card.
   */
  seen?: boolean;
}

const CardFace: React.FC<CardViewProps> = ({
  card,
  isFaceDown = false,
  canPeek = true,
  isSelectable = false,
  isSelected = false,
  onClick,
  onInspect,
  size = 'md',
  notInstalled = false,
  plainBack = false,
  typeIcons = false,
  sideways = false,
  tag,
  actions,
  seen = false,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [imageError, setImageError] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // When a button over the card was last clicked: a quick second click near it (Advance, then the Score button
  // that takes its place) is a double click, and must not open the inspect view
  const lastButtonClick = useRef(-Infinity);
  const def = cardDef(card);

  // Sizing definitions: Much larger than original 64x96!
  // sm: 112x160 (75% larger than original sm)
  // md: 144x208 (2.25x larger)
  // lg: 176x256 (3x larger)
  // xl: 224x320 (4x larger)
  const sizeClasses = {
    xs: 'w-20 h-28 text-[10px]',
    sm: 'w-28 h-40 text-xs',
    md: 'w-36 h-52 text-xs',
    lg: 'w-44 h-64 text-sm',
    xl: 'w-56 h-80 text-base',
    fit: 'card-fit',
    'fit-sm': 'card-fit-sm',
  }[size];

  // Hover opens the text popout beside the card; on the table it also fills the zoom panel
  const zoom = useZoom();
  const hidden = isFaceDown && !canPeek;
  const handleMouseEnter = () => {
    zoom?.show({ card, hidden, seen: seen && !hidden });
    setShowTooltip(true);
  };
  const handleMouseLeave = () => setShowTooltip(false);

  // When face-down and viewer cannot peek (e.g. Runner looking at Corp ICE/Root)
  if (isFaceDown && !canPeek) {
    return (
      <div
        ref={cardRef}
        onClick={isSelectable ? onClick : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`relative ${sizeClasses} [container-type:inline-size] rounded-xl border-2 transition-all duration-200 select-none flex flex-col items-center justify-center p-2 shadow-lg ${
          isSelected
            ? 'border-cyber-neonCyan ring-2 ring-cyber-neonCyan scale-105'
            : 'border-slate-800 bg-gradient-to-b from-slate-900 to-black hover:border-slate-600'
        } ${isSelectable ? 'cursor-pointer hover:scale-105' : ''}`}
      >
        <img
          src={getCardBackUrl(def.side_code || 'corp')}
          alt="Secured card back"
          className="w-full h-full object-cover rounded-lg shadow-inner"
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = 'none';
          }}
        />

        {/* Fallback circuit badge if image is hidden */}
        <div className="absolute inset-1.5 rounded-lg border border-dashed border-slate-800/80 flex flex-col items-center justify-center opacity-70 pointer-events-none -z-0">
          <Lock className="w-6 h-6 text-slate-500 mb-1" />
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono font-bold">
            SECURED
          </span>
        </div>

        <CardOverlays card={card} sideways={sideways} tag={tag} actions={actions} />

        {showTooltip && !plainBack && (
          <CardPopout
            card={card}
            targetRect={cardRef.current?.getBoundingClientRect() || null}
            isFaceDown={true}
            canPeek={false}
          />
        )}
      </div>
    );
  }

  // Card is visible (or Corp is peeking at their own unrezzed card!)
  const isCorp = def.side_code === 'corp';
  const isUnrezzed = !notInstalled && (isFaceDown || !card.isRezzed);
  const imageUrl = getCardImageUrl(card.cardCode);

  return (
    <div
      ref={cardRef}
      onClick={isSelectable ? onClick : undefined}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('button')) lastButtonClick.current = e.timeStamp;
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button') || e.timeStamp - lastButtonClick.current < 800) return;
        onInspect?.(card);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative ${sizeClasses} [container-type:inline-size] rounded-xl border-2 transition-all duration-200 select-none overflow-hidden group shadow-md ${
        isSelected
          ? 'border-cyber-neonCyan ring-4 ring-cyber-neonCyan/50 scale-105 z-20 shadow-cyan-500/30'
          : isUnrezzed
          ? 'border-cyan-700/80 bg-slate-950 hover:border-cyan-400 hover:shadow-cyan-500/20'
          : isCorp
          ? 'border-cyan-800 hover:border-cyan-400 bg-slate-950 hover:shadow-cyan-500/20'
          : 'border-pink-800 hover:border-pink-400 bg-slate-950 hover:shadow-pink-500/20'
      } ${isSelectable ? 'cursor-pointer hover:scale-105' : ''}`}
    >
      {/* High-Resolution Card Image */}
      {!imageError ? (
        <img
          src={imageUrl}
          alt={def.title}
          className={`w-full h-full object-cover object-center rounded-lg transition-opacity duration-200 ${
            seen ? 'opacity-60 grayscale-[50%]' : isUnrezzed ? 'opacity-85 brightness-95' : 'opacity-100'
          }`}
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        /* Fallback graphic placeholder if image completely fails */
        <div className="w-full h-full flex flex-col justify-between p-2 bg-slate-900 font-mono text-center">
          <div className="text-[10px] font-bold text-cyan-400 line-clamp-2">{def.title}</div>
          <div className="text-[9px] text-slate-500">{def.type_code}</div>
          <div className="text-[9px] text-amber-400">{def.cost != null && <Credits amount={def.cost} />}</div>
        </div>
      )}

      {/* Remembered, not visible: a card-back tint with scanlines over the faded art */}
      {seen && <div data-testid="seen-veil" className="seen-veil absolute inset-0 rounded-lg pointer-events-none" />}

      <CardOverlays
        card={card}
        sideways={sideways}
        tag={tag}
        actions={actions}
        status={seen ? 'seen' : isUnrezzed ? (card.faceUp ? 'faceup' : 'unrezzed') : undefined}
        types={typeIcons === false ? [] : typeIcons === true ? (def.type_code === 'ice' ? iceSubtypes(card) : breakerTypes(card)) : typeIcons}
        typeSide={def.type_code === 'ice' ? 'ice' : 'breaker'}
        onInspect={onInspect}
      />

      {/* Hover Card Detail Popout (Rendered via Portal to Document Body) */}
      {showTooltip && (
        <CardPopout
          card={card}
          targetRect={cardRef.current?.getBoundingClientRect() || null}
          isFaceDown={isUnrezzed}
          canPeek={canPeek}
        />
      )}
    </div>
  );
};

// Overlay sizes are in em, and the layer's font follows the card's width, so the layout keeps its proportions at every card size
const badge = 'pointer-events-auto shrink-0 font-extrabold px-[0.5em] py-[0.1em] rounded-full leading-[1.2em] shadow-lg border';
const tagClass = 'pointer-events-auto max-w-full min-w-0 px-[0.4em] py-[0.1em] rounded text-[0.85em] leading-[1.2em] font-bold tracking-wider uppercase shadow border flex items-center gap-[0.3em]';

/**
 * Every badge and button over a card, laid out in rows and columns so none can cover another at any card size:
 * status and tags top-left, advancement top-right, Rez/Advance/Score buttons in between, type icons and the
 * inspect button bottom-left, hosted counters bottom-right. A sideways card's layer is turned back upright.
 * Its font is 12% of the card's width (capped at 12px), and every size in it is in em.
 */
const CardOverlays: React.FC<{
  card: CardInstance;
  sideways: boolean;
  tag?: React.ReactNode;
  actions?: React.ReactNode;
  status?: 'unrezzed' | 'faceup' | 'seen';
  types?: IceSubtype[];
  typeSide?: 'ice' | 'breaker';
  onInspect?: (card: CardInstance) => void;
}> = ({ card, sideways, tag, actions, status, types = [], typeSide = 'ice', onInspect }) => {
  const t = card.tokens;
  const tokens = (t.credit ?? 0) > 0 || (t.virus ?? 0) > 0 || (t.power ?? 0) > 0 || (t.agenda ?? 0) > 0;
  const top = status || card.flipped || tag || card.advancementCounters > 0;
  return (
    <div
      data-testid="card-overlays"
      className={`absolute z-20 pointer-events-none flex flex-col gap-[0.2em] p-[0.2em] ${
        sideways ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90' : 'inset-0'
      }`}
      // Sideways, the layer is the card's box turned: as wide as the card is tall (140%)
      style={{ fontSize: 'min(12cqw, 12px)', ...(sideways ? { width: '140cqw', height: '100cqw' } : {}) }}
    >
      {top && (
        <div className="flex items-start gap-[0.2em] min-w-0">
          <div className="flex-1 min-w-0 flex flex-col items-start gap-[0.2em]">
            {status === 'faceup' && <div className={`${tagClass} bg-amber-950/90 text-amber-300 border-amber-700/80`}><span className="truncate">Faceup</span></div>}
            {status === 'unrezzed' && (
              <div className={`${tagClass} bg-cyan-950/90 text-cyan-300 border-cyan-700/80`}>
                <Eye className="w-[1em] h-[1em] shrink-0 text-cyan-400" />
                <Keyword id="unrezzed" className="truncate">Unrezzed</Keyword>
              </div>
            )}
            {status === 'seen' && (
              <div data-testid="seen-tag" className={`${tagClass} bg-slate-950/90 text-slate-200 border-slate-500`}>
                <Eye className="w-[1em] h-[1em] shrink-0 text-slate-400" />
                <Keyword id="seen" className="truncate">Seen</Keyword>
              </div>
            )}
            {/* A flipped identity (Nebula Talent Management) */}
            {card.flipped && <div className={`${tagClass} bg-violet-950/90 text-violet-200 border-violet-600`}><span className="truncate">Flipped</span></div>}
            {tag}
          </div>
          {card.advancementCounters > 0 && (
            <span data-kw="advance" className={`${badge} bg-amber-400 text-black border-amber-200`}>
              ★ {card.advancementCounters}
            </span>
          )}
        </div>
      )}
      <div className={`flex-1 min-h-0 flex justify-end gap-[0.2em] ${sideways ? 'flex-row items-end' : 'flex-col'}`}>{actions}</div>
      <div className="flex items-end justify-between gap-[0.2em]">
        <div className={`flex gap-[0.2em] ${sideways ? 'flex-row items-end' : 'flex-col items-start'}`}>
          <IceTypeIcons types={types} side={typeSide} row={sideways} />
          {/* Quick inspect, shown on hover; it keeps its place so nothing moves under the pointer */}
          {onInspect && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onInspect(card);
              }}
              className="pointer-events-auto bg-black/80 hover:bg-slate-800 text-slate-300 hover:text-white p-[0.2em] rounded-md opacity-0 group-hover:opacity-100 transition-opacity border border-slate-700"
              title="Inspect full card details"
            >
              <Eye className="w-[1.4em] h-[1.4em]" />
            </button>
          )}
        </div>
        {tokens && (
          <div className="flex flex-col items-end gap-[0.2em]">
            {(t.credit ?? 0) > 0 && (
              <span className={`${badge} bg-amber-500 text-black border-amber-200`} data-kw="credit">
                <Credits amount={t.credit ?? 0} />
              </span>
            )}
            {(t.virus ?? 0) > 0 && (
              <span className={`${badge} bg-lime-500 text-black border-lime-200`} data-kw="virus-counter">
                ☣ {t.virus}
              </span>
            )}
            {(t.power ?? 0) > 0 && (
              <span className={`${badge} bg-violet-500 text-white border-violet-200`} title="Power counters">
                ⚡ {t.power}
              </span>
            )}
            {(t.agenda ?? 0) > 0 && (
              <span className={`${badge} bg-teal-400 text-black border-teal-100`} title="Agenda counters">
                ◆ {t.agenda}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * A card that flips when it turns over: dealt face down or face up, rezzed,
 * or revealed. The key changes with what the viewer sees, which replays the flip.
 */
export const CardView: React.FC<CardViewProps> = props => {
  const showsBack = Boolean(props.isFaceDown) && props.canPeek === false;
  const face = showsBack ? 'back' : props.card.isRezzed ? 'rezzed' : props.seen ? 'seen' : 'face';
  // Only table cards (inside the zoom provider) answer to the prompt's hover; the prompt's own copies don't
  const onTable = useZoom() !== null;
  const mark = usePromptHighlight(props.card.instanceId);
  const ref = useRef<HTMLDivElement>(null);
  const markClass = !onTable ? '' : mark.hovered ? 'prompt-target-hover' : mark.selected ? 'prompt-target-picked' : '';
  return (
    <motion.div
      key={face}
      ref={ref}
      className={`shrink-0 rounded-xl ${markClass}`}
      initial={{ rotateY: 90, opacity: 0.3 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      style={{ transformPerspective: 700 }}
    >
      <CardFace {...props} />
      {onTable && mark.hovered && <PromptTargetLabel anchor={ref.current} label={mark.label} />}
    </motion.div>
  );
};

/** The hovered option's position, floated above its board card and over the prompt panel. */
const PromptTargetLabel: React.FC<{ anchor: HTMLElement | null; label: string | null }> = ({ anchor, label }) => {
  if (!anchor || !label) return null;
  const rect = anchor.getBoundingClientRect();
  const above = rect.top > 40;
  return createPortal(
    <div
      data-testid="prompt-target-label"
      className="fixed z-[60] -translate-x-1/2 pointer-events-none whitespace-nowrap px-2 py-1 text-[11px] font-mono font-bold bg-black/90 border border-amber-300 text-amber-200 shadow-lg"
      // Kept clear of the window's edges: board columns at the far left would cut it off
      style={{ left: Math.min(Math.max(rect.left + rect.width / 2, 130), window.innerWidth - 130), top: above ? rect.top - 30 : rect.bottom + 6 }}
    >
      {label}
    </div>,
    document.body,
  );
};
