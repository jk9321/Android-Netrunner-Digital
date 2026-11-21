import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { CardInstance, SideCode } from '../../core/types/card';
import { CardView } from './CardView';
import { Keyword } from './Keyword';
import { animationsEnabled, useAnimationsEnabled } from '../animations';
import { holdHover } from '../hoverHold';

interface HandRowProps {
  cards: CardInstance[];
  side: SideCode;
  /** Can this viewer see the faces? If not, cards come and go face down. */
  canSee: boolean;
  isSelectable: boolean;
  selectedCardId: string | null;
  onSelect: (instanceId: string) => void;
  onInspect?: (card: CardInstance) => void;
  /** Instance ids now in the heap or Archives, so a card that left the hand that way drops instead of lifting. */
  discardedIds: ReadonlySet<string>;
  /** Rendered in a full-width top/bottom hand dock (applies .hand-dock sizing to the spread portal too). */
  docked?: boolean;
  /** Dock edge: top-docked Corp cards nudge downward on hover so they stay clear of the header. */
  position?: 'top' | 'bottom';
}

type ExitCustom = ReadonlySet<string>;

/**
 * How much each card overlaps the one before it, as a share of a card's width. Hands start fairly tight and
 * tighten as they grow; the opponent's hand (hidden faces, count shown elsewhere) is always tightest.
 */
export function handOverlap(count: number, hidden: boolean): number {
  if (hidden) return 0.75;
  if (count <= 3) return 0.5;
  return Math.min(0.72, 0.5 + (count - 3) * 0.037);
}

/** The overlap a spread hand uses: loose, but tightened just enough to fit `avail` pixels. */
export function spreadOverlap(count: number, cardPx: number, avail: number): number {
  if (count <= 1 || cardPx <= 0) return 0;
  const needed = 1 - (avail - cardPx) / ((count - 1) * cardPx);
  return Math.min(0.72, Math.max(0.04, needed));
}

const CLOSE_DELAY_MS = 160;
const SPREAD_SECONDS = 0.2;

/**
 * A hand of cards, fanned so each overlaps the last, that animates its changes: a drawn card slides in from the
 * deck, a played or installed card lifts out toward the table, a discarded
 * card drops away, and the rest close the gap.
 * Memoized: the table re-renders whenever a card is selected, and a hand only
 * needs to when its own props change.
 */
export const HandRow: React.FC<HandRowProps> = React.memo(({
  cards,
  side,
  canSee,
  isSelectable,
  selectedCardId,
  onSelect,
  onInspect,
  discardedIds,
  docked = false,
  position = 'bottom',
}) => {
  const glow = side === 'corp' ? 'rgb(var(--corp-400) / 0.55)' : 'rgb(var(--runner-500) / 0.55)';
  const animationsOn = useAnimationsEnabled();
  const overlap = handOverlap(cards.length, !canSee);

  // Your own hand spreads out while the pointer is over it (or after a tap on touch screens), over the board
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [spread, setSpread] = useState<{ left: number; top: number; shift: number; overlap: number } | null>(null);
  const canSpread = canSee && cards.length > 1;

  const open = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const first = wrap.querySelector<HTMLElement>('[data-hand-card]');
    const cardPx = first ? first.getBoundingClientRect().width : 0;
    const rect = (first?.parentElement ?? wrap).getBoundingClientRect();
    // Stay inside this tabletop column, so the spread opens leftward and never covers the sidebar controls or log
    const board = wrap.closest('main, section')?.getBoundingClientRect();
    const minLeft = (board?.left ?? 0) + 6;
    const maxRight = (board?.right ?? window.innerWidth) - 6;
    const o = spreadOverlap(cards.length, cardPx, maxRight - minLeft);
    const width = cardPx + (cards.length - 1) * cardPx * (1 - o);
    const shift = Math.min(0, maxRight - (rect.left + width));
    // Hover previews wait while the cards slide apart
    if (animationsEnabled()) holdHover(SPREAD_SECONDS * 1000 + 60);
    setSpread({ left: rect.left, top: rect.top, shift: Math.max(shift, minLeft - rect.left), overlap: o });
  }, [cards.length]);
  const close = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setSpread(null), CLOSE_DELAY_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  // A hand that changes while spread (a card played) closes; so does a tap anywhere else
  useEffect(() => setSpread(null), [cards.length]);
  // The spread also closes on where the pointer is, not only on its own mouseleave: a pointer that leaves within
  // tens of ms of the spread opening gets no mouseout (the node under it is replaced as the cards slide apart)
  const isSpread = spread !== null;
  useEffect(() => {
    if (!isSpread) return;
    let outside = false;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !(e.target instanceof Node)) return;
      const over = !!wrapRef.current?.contains(e.target) || !!document.querySelector('[data-hand-spread]')?.contains(e.target);
      if (over) window.clearTimeout(closeTimer.current);
      else if (!outside) close();
      outside = !over;
    };
    document.addEventListener('pointermove', move);
    return () => document.removeEventListener('pointermove', move);
  }, [isSpread, close]);
  useEffect(() => {
    if (!spread) return;
    const away = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if (!(e.target instanceof Node)) return;
      if (wrapRef.current?.contains(e.target) || document.querySelector('[data-hand-spread]')?.contains(e.target)) return;
      setSpread(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [spread]);

  const cardView = (card: CardInstance) => (
    <CardView
      card={card}
      size="fit"
      notInstalled
      handTarget={canSee}
      isFaceDown={!canSee}
      canPeek={canSee}
      isSelectable={isSelectable}
      isSelected={selectedCardId === card.instanceId}
      onClick={() => onSelect(card.instanceId)}
      onInspect={canSee ? onInspect : undefined}
      typeIcons
    />
  );

  const duration = animationsOn ? SPREAD_SECONDS : 0;

  return (
    <MotionConfig reducedMotion={animationsOn ? 'user' : 'always'}>
      <div
        ref={wrapRef}
        data-testid={`hand-${side}`}
        data-spread={spread ? 'open' : undefined}
        className={`hand-fan relative flex min-w-0 px-1 ${docked ? 'py-0.5' : 'pt-2 pb-1'}`}
        style={{ ['--hand-overlap' as string]: overlap, opacity: spread ? 0 : undefined }}
        onMouseEnter={canSpread ? open : undefined}
        onMouseLeave={canSpread ? close : undefined}
        // On touch screens there is no hover: the first tap spreads the hand instead of picking a card
        onClickCapture={
          canSpread
            ? e => {
                if (!spread && window.matchMedia('(hover: none)').matches) {
                  e.stopPropagation();
                  e.preventDefault();
                  open();
                }
              }
            : undefined
        }
      >
        <AnimatePresence initial={false} mode="popLayout" custom={discardedIds}>
          {cards.map(card => (
            <motion.div
              key={card.instanceId}
              layout
              data-hand-card
              custom={discardedIds}
              // isolate: a card's type icons stay in its own layer, under the next card in the fan until hovered
              className="relative isolate shrink-0 rounded-[2px]"
              initial={{ opacity: 0, x: 40, y: -24, scale: 0.8, boxShadow: `0 0 0px ${glow}` }}
              animate={{
                opacity: 1,
                x: 0,
                y: 0,
                scale: 1,
                rotate: 0,
                boxShadow: [`0 0 18px ${glow}`, '0 0 0px rgba(0,0,0,0)'],
              }}
              variants={{
                leave: (discarded: ExitCustom) =>
                  discarded.has(card.instanceId)
                    ? { opacity: 0, y: 40, rotate: side === 'corp' ? -8 : 8, scale: 0.85, transition: { duration: 0.3, ease: 'easeIn' } }
                    : { opacity: 0, y: -36, scale: 1.08, transition: { duration: 0.28, ease: 'easeOut' } },
              }}
              exit="leave"
              transition={{ duration: 0.3, ease: 'easeOut', layout: { duration: 0.25 }, boxShadow: { duration: 0.7 } }}
            >
              {cardView(card)}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {spread &&
        createPortal(
          <motion.div
            data-hand-spread
            data-testid={`hand-${side}-spread`}
            className={`hand-fan ${docked ? 'hand-dock ' : ''}fixed z-40 flex px-1 ${docked ? 'py-0.5' : 'pt-2 pb-1'}`}
            style={{ left: spread.left, top: spread.top, ['--hand-overlap' as string]: overlap }}
            initial={{ x: 0 }}
            animate={{ x: spread.shift }}
            transition={{ duration }}
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={close}
          >
            {cards.map(card => (
              <motion.div
                key={card.instanceId}
                className={`relative isolate shrink-0 rounded-[2px] hover:z-10 ${
                  position === 'top' ? 'hover:translate-y-1.5' : 'hover:-translate-y-1.5'
                } transition-transform`}
                initial={{ ['--hand-overlap' as string]: overlap }}
                animate={{ ['--hand-overlap' as string]: spread.overlap }}
                transition={{ duration }}
              >
                {cardView(card)}
              </motion.div>
            ))}
          </motion.div>,
          document.body,
        )}
    </MotionConfig>
  );
});

/**
 * Full-width hand dock placed directly above the Corp board (when playing Corp) or below the Runner board
 * (when playing Runner), freeing the full horizontal width of servers and the rig.
 */
export function DockedHandBar({
  side,
  cards,
  handSizeLimit,
  isSelectable,
  selectedCardId,
  onSelect,
  onInspect,
  discardedIds,
  position,
  actions,
}: {
  side: SideCode;
  cards: CardInstance[];
  handSizeLimit: number;
  isSelectable: boolean;
  selectedCardId: string | null;
  onSelect: (instanceId: string) => void;
  onInspect?: (card: CardInstance) => void;
  discardedIds: ReadonlySet<string>;
  position: 'top' | 'bottom';
  /** Common click actions + Play/Install + End Turn placed right beside the hand on this side's turn. */
  actions?: React.ReactNode;
}) {
  const isCorp = side === 'corp';
  const overLimit = cards.length > handSizeLimit;
  const handLabel = (
    <div
      className={`flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider font-mono leading-none ${
        isCorp ? 'text-cyan-400' : 'text-pink-400'
      }`}
    >
      <span>
        <Keyword id={isCorp ? 'hq' : 'grip'}>{isCorp ? 'HQ' : 'Grip'}</Keyword> Hand
      </span>
      <span className={overLimit ? 'text-amber-300' : 'opacity-90'}>
        (<Keyword id="hand-size">{cards.length} / {handSizeLimit}</Keyword>)
      </span>
    </div>
  );

  return (
    <div
      data-testid={`hand-dock-${side}`}
      className={`hand-dock shrink-0 w-full flex flex-wrap md:flex-nowrap items-center justify-between gap-x-3 gap-y-1.5 px-2.5 py-1.5 rounded-[2px] border shadow-lg ${
        isCorp
          ? 'bg-gradient-to-r from-[#0a131d] to-[#070d14] border-cyan-900/70'
          : 'bg-gradient-to-r from-[#140a10] to-[#0a0609] border-pink-900/70'
      }`}
    >
      <div className="flex-1 min-w-0">
        {actions ?? (
          <span className="hidden sm:inline text-[11px] text-slate-500 font-mono">
            {cards.length === 0 ? 'Hand empty' : cards.length > 1 ? 'Hover hand to fan · click to select' : 'Click card to select'}
          </span>
        )}
      </div>
      <div className="min-w-0 flex flex-col items-end gap-0.5 ml-auto shrink-0">
        {handLabel}
        <div className="min-w-0 flex items-center justify-end overflow-x-auto overflow-y-hidden">
          {cards.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic px-2 py-1 font-mono" data-testid={`hand-${side}`}>
              No cards in hand
            </div>
          ) : (
            <HandRow
              cards={cards}
              side={side}
              canSee
              isSelectable={isSelectable}
              selectedCardId={selectedCardId}
              onSelect={onSelect}
              onInspect={onInspect}
              discardedIds={discardedIds}
              docked
              position={position}
            />
          )}
        </div>
      </div>
    </div>
  );
}
