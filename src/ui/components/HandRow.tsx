import React from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { CardInstance, SideCode } from '../../core/types/card';
import { CardView } from './CardView';
import { IceTypeIcons, breakerTypes } from './IceTypeIcons';
import { iceSubtypes } from '../../core/engine/ice';

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

  return (
    <MotionConfig reducedMotion="user">
      <div
        data-testid={`hand-${side}`}
        className="hand-fan relative flex min-w-0 pt-2 pb-1 px-1"
      >
        <AnimatePresence initial={false} mode="popLayout" custom={discardedIds}>
          {cards.map(card => (
            <motion.div
              key={card.instanceId}
              layout
              custom={discardedIds}
              className="relative shrink-0 hover:z-10 rounded-xl"
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
              <CardView
                card={card}
                size="fit"
                notInstalled
                isFaceDown={!canSee}
                canPeek={canSee}
                isSelectable={isSelectable}
                isSelected={selectedCardId === card.instanceId}
                onClick={() => onSelect(card.instanceId)}
                onInspect={canSee ? onInspect : undefined}
              />
              {/* The same type icons as on the table, only for a viewer who can see the faces */}
              {canSee &&
                (side === 'corp' ? (
                  <IceTypeIcons types={iceSubtypes(card)} side="ice" className="absolute right-0.5 bottom-0.5" />
                ) : (
                  <IceTypeIcons types={breakerTypes(card)} side="breaker" className="absolute left-0.5 top-1/2 -translate-y-1/2" />
                ))}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
});
