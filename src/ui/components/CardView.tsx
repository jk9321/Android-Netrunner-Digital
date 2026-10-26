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

export interface CardViewProps {
  card: CardInstance;
  isFaceDown?: boolean;
  canPeek?: boolean;
  isSelectable?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onInspect?: (card: CardInstance) => void;
  /** fit and fit-sm follow the window height (--card-w in index.css); the rest are fixed. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'fit' | 'fit-sm';
  /** Only installed cards are rezzed or unrezzed; hide the badge for cards in hand or in a pile. */
  notInstalled?: boolean;
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
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [imageError, setImageError] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
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
    zoom?.show({ card, hidden });
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
        className={`relative ${sizeClasses} rounded-xl border-2 transition-all duration-200 select-none flex flex-col items-center justify-center p-2 shadow-lg ${
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

        {/* Counter badges if advanced */}
        {card.advancementCounters > 0 && (
          <div data-kw="advance" className="absolute -top-2 -right-2 bg-amber-400 text-black font-bold px-2 py-0.5 rounded-full text-xs shadow-md z-20">
            ★ {card.advancementCounters}
          </div>
        )}

        {showTooltip && (
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
      onDoubleClick={() => onInspect && onInspect(card)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative ${sizeClasses} rounded-xl border-2 transition-all duration-200 select-none overflow-hidden group shadow-md ${
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
            isUnrezzed ? 'opacity-85 brightness-95' : 'opacity-100'
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

      {/* Unrezzed Blueprint Indicator for Corp */}
      {isUnrezzed && card.faceUp && (
        <div className="absolute top-1 left-1 bg-amber-950/90 text-amber-300 border border-amber-700/80 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase shadow z-10">
          Faceup
        </div>
      )}
      {isUnrezzed && !card.faceUp && (
        <div className="absolute top-1 left-1 bg-cyan-950/90 text-cyan-300 border border-cyan-700/80 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase shadow z-10 flex items-center gap-1">
          <Eye className="w-2.5 h-2.5 text-cyan-400" />
          <Keyword id="unrezzed">Unrezzed</Keyword>
        </div>
      )}

      {/* Advancement Counter Badge */}
      {card.advancementCounters > 0 && (
        <div data-kw="advance" className="absolute top-1 right-1 bg-amber-400 text-black font-extrabold px-1.5 py-0.5 rounded-full text-[10px] shadow-lg z-20 border border-amber-200">
          ★ {card.advancementCounters}
        </div>
      )}

      {/* A flipped identity (Nebula Talent Management) */}
      {card.flipped && (
        <div className="absolute bottom-1 left-1 bg-violet-950/90 text-violet-200 border border-violet-600 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase shadow z-10">
          Flipped
        </div>
      )}

      {/* Hosted credit, virus, power and agenda counters */}
      {((card.tokens.credit ?? 0) > 0 || (card.tokens.virus ?? 0) > 0 || (card.tokens.power ?? 0) > 0 || (card.tokens.agenda ?? 0) > 0) && (
        <div className="absolute bottom-1 right-1 flex flex-col items-end gap-0.5 z-20">
          {(card.tokens.credit ?? 0) > 0 && (
            <span className="bg-amber-500 text-black font-extrabold px-1.5 py-0.5 rounded-full text-[10px] shadow-lg border border-amber-200" data-kw="credit">
              <Credits amount={card.tokens.credit ?? 0} />
            </span>
          )}
          {(card.tokens.virus ?? 0) > 0 && (
            <span className="bg-lime-500 text-black font-extrabold px-1.5 py-0.5 rounded-full text-[10px] shadow-lg border border-lime-200" data-kw="virus-counter">
              ☣ {card.tokens.virus}
            </span>
          )}
          {(card.tokens.power ?? 0) > 0 && (
            <span className="bg-violet-500 text-white font-extrabold px-1.5 py-0.5 rounded-full text-[10px] shadow-lg border border-violet-200" title="Power counters">
              ⚡ {card.tokens.power}
            </span>
          )}
          {(card.tokens.agenda ?? 0) > 0 && (
            <span className="bg-teal-400 text-black font-extrabold px-1.5 py-0.5 rounded-full text-[10px] shadow-lg border border-teal-100" title="Agenda counters">
              ◆ {card.tokens.agenda}
            </span>
          )}
        </div>
      )}

      {/* Quick Inspect Button on Hover (Clicking opens large Modal) */}
      {onInspect && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInspect(card);
          }}
          className="absolute bottom-1 right-1 bg-black/80 hover:bg-slate-800 text-slate-300 hover:text-white p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity z-20 border border-slate-700"
          title="Inspect full card details"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}

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

/**
 * A card that flips when it turns over: dealt face down or face up, rezzed,
 * or revealed. The key changes with what the viewer sees, which replays the flip.
 */
export const CardView: React.FC<CardViewProps> = props => {
  const showsBack = Boolean(props.isFaceDown) && props.canPeek === false;
  const face = showsBack ? 'back' : props.card.isRezzed ? 'rezzed' : 'face';
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
