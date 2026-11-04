import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { CardInstance, SideCode } from '../../core/types/card';
import { CardView } from './CardView';
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
    // Stay inside this hand's own board section, so it opens leftward and never covers the zoom view or the log
    const board = wrap.closest('section')?.getBoundingClientRect();
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
      isFaceDown={!canSee}
      canPeek={canSee}
      isSelectable={isSelectable}
      isSelected={selectedCardId === card.instanceId}
      onClick={() => {
        onSelect(card.instanceId);
        setSpread(null);
      }}
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
        className="hand-fan relative flex min-w-0 pt-2 pb-1 px-1"
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
            className="hand-fan fixed z-40 flex pt-2 pb-1 px-1"
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
                className="relative isolate shrink-0 rounded-[2px] hover:z-10 hover:-translate-y-1 transition-transform"
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
