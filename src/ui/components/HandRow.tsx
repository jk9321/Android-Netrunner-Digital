import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { CardInstance, SideCode } from '../../core/types/card';
import { CardView } from './CardView';
import { Keyword } from './Keyword';
import { animationsEnabled, useAnimationsEnabled } from '../animations';
import { holdHover } from '../hoverHold';

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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
  /** Measured horizontal room (px) available inside DockedHandBar; when cards fit, they stay flat with no overlap. */
  availWidth?: number;
}

type ExitCustom = ReadonlySet<string>;

const FLAT_GAP_PX = 4;

/**
 * How much each card overlaps the one before it, as a share of a card's width. Hands start fairly tight and
 * tighten as they grow; the opponent's hand (hidden faces, count shown elsewhere) is always tightest.
 */
export function handOverlap(count: number, hidden: boolean): number {
  if (hidden) return 0.75;
  if (count <= 3) return 0.5;
  return Math.min(0.72, 0.5 + (count - 3) * 0.037);
}

/**
 * Overlap for a full-width docked hand: 0 (flat side-by-side) whenever every card fits inside `avail` pixels,
 * tightening smoothly only once the hand outgrows the available space beside the action bar.
 */
export function dockedHandOverlap(count: number, cardPx: number, avail: number): number {
  if (count <= 1 || cardPx <= 0 || avail <= 0) return 0;
  if (count * cardPx <= avail) return 0;
  const needed = 1 - (avail - cardPx) / ((count - 1) * cardPx);
  return Math.min(0.72, Math.max(0, needed));
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
 * A hand of cards that sits flat when room allows and fans/overlaps when cramped, animating its changes:
 * a drawn card slides in from the deck, a played or installed card lifts out toward the table, a discarded
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
  availWidth,
}) => {
  const glow = side === 'corp' ? 'rgb(var(--corp-400) / 0.55)' : 'rgb(var(--runner-500) / 0.55)';
  const animationsOn = useAnimationsEnabled();

  // Your own hand spreads out while the pointer is over it (or after a tap on touch screens) when cards overlap
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [spread, setSpread] = useState<{ left: number; top: number; shift: number; overlap: number } | null>(null);
  const [measuredCardPx, setMeasuredCardPx] = useState(0);

  // Track rendered card width (responds to viewport height & Normal/Large card size toggles) without reading overlap.
  useIsoLayoutEffect(() => {
    if (!docked) return;
    const wrap = wrapRef.current;
    const first = wrap?.querySelector<HTMLElement>('[data-hand-card]');
    if (!first) return;
    const update = () => {
      const w = first.getBoundingClientRect().width;
      if (w > 0) setMeasuredCardPx(prev => (Math.abs(prev - w) > 0.5 ? w : prev));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(first);
    return () => ro.disconnect();
  }, [docked, cards.length]);

  const overlap =
    docked && canSee
      ? availWidth && measuredCardPx > 0
        ? dockedHandOverlap(cards.length, measuredCardPx, availWidth)
        : 0
      : handOverlap(cards.length, !canSee);
  const flatGap =
    docked &&
    canSee &&
    overlap === 0 &&
    (!availWidth || measuredCardPx === 0 || cards.length <= 1 || cards.length * measuredCardPx + (cards.length - 1) * FLAT_GAP_PX <= availWidth);
  const canSpread = canSee && cards.length > 1 && (!docked || overlap > 0.06);

  const open = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const first = wrap.querySelector<HTMLElement>('[data-hand-card]');
    const cardPx = first ? first.getBoundingClientRect().width : 0;
    const rect = (first?.parentElement ?? wrap).getBoundingClientRect();
    // Stay inside this tabletop column so the spread never covers the sidebar controls or log
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
  // A hand that changes while spread (a card played) or no longer needs spreading closes
  useEffect(() => setSpread(null), [cards.length]);
  useEffect(() => {
    if (!canSpread) setSpread(null);
  }, [canSpread]);
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
  const flatDockCards = docked && canSee && !canSpread;
  // Don't let Framer Motion record a pre-measurement overlap=0 FLIP snapshot on mount.
  const layoutReady = !docked || !canSee || (availWidth !== undefined && measuredCardPx > 0);

  return (
    <MotionConfig reducedMotion={animationsOn ? 'user' : 'always'}>
      <div
        ref={wrapRef}
        data-testid={`hand-${side}`}
        data-spread={spread ? 'open' : undefined}
        className={`hand-fan relative flex min-w-0 px-1 ${docked ? 'py-0.5' : 'pt-2 pb-1'} ${flatGap ? 'gap-1' : ''}`}
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
          {cards.map(card => {
            const isSelected = selectedCardId === card.instanceId;
            const liftClass = flatDockCards
              ? isSelected
                ? `${position === 'top' ? 'translate-y-2' : '-translate-y-2'} transition-transform`
                : `${position === 'top' ? 'hover:translate-y-1.5' : 'hover:-translate-y-1.5'} transition-transform`
              : undefined;
            return (
              <motion.div
                key={card.instanceId}
                layout={layoutReady}
                data-hand-card
                custom={discardedIds}
                // isolate: a card's type icons stay in its own layer, under the next card in the fan until hovered
                className={`relative isolate shrink-0 rounded-[2px] ${liftClass ? (isSelected ? 'z-10' : 'hover:z-10') : ''}`}
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
                {liftClass ? <div className={liftClass}>{cardView(card)}</div> : cardView(card)}
              </motion.div>
            );
          })}
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
            {cards.map(card => {
              const isSelected = selectedCardId === card.instanceId;
              return (
                <motion.div
                  key={card.instanceId}
                  className={`relative isolate shrink-0 rounded-[2px] ${
                    isSelected
                      ? `z-10 ${position === 'top' ? 'translate-y-2' : '-translate-y-2'}`
                      : `hover:z-10 ${position === 'top' ? 'hover:translate-y-1.5' : 'hover:-translate-y-1.5'}`
                  } transition-transform`}
                  initial={{ ['--hand-overlap' as string]: overlap }}
                  animate={{ ['--hand-overlap' as string]: spread.overlap }}
                  transition={{ duration }}
                >
                  {cardView(card)}
                </motion.div>
              );
            })}
          </motion.div>,
          document.body,
        )}
    </MotionConfig>
  );
});

/**
 * Full-width hand dock placed at the bottom of the tabletop for single-seat / hotseat play (and at the top
 * for Corp only in Open Table mode when both hands are visible), with the hand on the left and actions on the right.
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
  /** Common click actions + Play/Install + End Turn placed on the right side of the dock beside the sidebar. */
  actions?: React.ReactNode;
}) {
  const isCorp = side === 'corp';
  const overLimit = cards.length > handSizeLimit;
  const handSlotRef = useRef<HTMLDivElement>(null);
  const [handAvail, setHandAvail] = useState<number | undefined>(undefined);

  // handSlotRef is `md:flex-1 min-w-0` beside the `shrink-0` action panel, so its clientWidth is always
  // the exact room available for the hand without ever letting a large hand crush the action buttons.
  useIsoLayoutEffect(() => {
    const slot = handSlotRef.current;
    if (!slot) return;
    const measure = () => {
      const next = Math.max(120, Math.floor(slot.clientWidth) - 8); // HandRow px-1 horizontal padding
      setHandAvail(prev => (prev !== undefined && Math.abs(prev - next) <= 2 ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(slot);
    return () => ro.disconnect();
  }, []);

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
      <div ref={handSlotRef} className="w-full md:w-auto md:flex-1 min-w-0 flex flex-col items-start gap-0.5">
        {handLabel}
        <div className="min-w-0 max-w-full flex items-center justify-start">
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
              availWidth={handAvail}
            />
          )}
        </div>
      </div>
      <div className="shrink-0 max-w-full ml-auto flex justify-end">
        {actions ?? (
          <span className="hidden sm:inline text-[11px] text-slate-500 font-mono text-right">
            {cards.length === 0 ? 'Hand empty' : isSelectable ? 'Click card to select' : 'Hover card to inspect'}
          </span>
        )}
      </div>
    </div>
  );
}
