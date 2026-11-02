import React from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { AgendaDiamondIcon } from './CreditIcon';
import { CardFate, FateKind } from '../cardFates';
import { CardView } from './CardView';

export interface ShownFate extends CardFate {
  /** Unique per showing, so the same card can show again later. */
  key: string;
  /** May this viewer see the card's face? */
  canSee: boolean;
}

const STAMP: Record<FateKind, { label: string; className: string; icon: React.ReactNode }> = {
  stolen: {
    label: 'Stolen',
    className: 'bg-cyber-neonPink text-white border-pink-200 shadow-pink-500/50',
    icon: <AgendaDiamondIcon className="w-4 h-4" />,
  },
  trashed: {
    label: 'Trashed',
    className: 'bg-red-700 text-white border-red-300 shadow-red-500/50',
    icon: <Trash2 className="w-4 h-4" />,
  },
  scored: {
    label: 'Scored',
    className: 'bg-cyan-500 text-black border-cyan-100 shadow-cyan-400/50',
    icon: <AgendaDiamondIcon className="w-4 h-4" />,
  },
};

/** Where the card heads as it leaves: the Runner's score area is below, the Corp's above, the trash falls away. */
const EXIT: Record<FateKind, object> = {
  stolen: { opacity: 0, y: 260, scale: 0.5 },
  scored: { opacity: 0, y: -260, scale: 0.5 },
  trashed: { opacity: 0, y: 60, rotate: -14, scale: 0.6, filter: 'grayscale(1) brightness(0.5)' },
};

/**
 * Cards just stolen, scored or trashed, shown large in the middle of the
 * table with a stamp saying what happened, then sent on their way.
 */
export const CardFates: React.FC<{ fates: ShownFate[] }> = ({ fates }) => (
  <MotionConfig reducedMotion="user">
    <div
      data-testid="card-fates"
      className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center gap-6"
    >
      <AnimatePresence>
        {fates.map(fate => {
          const stamp = STAMP[fate.kind];
          return (
            <motion.div
              key={fate.key}
              data-fate={fate.kind}
              className="relative"
              initial={{ opacity: 0, scale: 0.6, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0, rotate: 0, filter: 'grayscale(0) brightness(1)' }}
              exit={{ ...EXIT[fate.kind], transition: { duration: 0.45, ease: 'easeIn' } }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <div className="rounded-[3px] shadow-2xl shadow-black">
                <CardView card={fate.card} size="lg" notInstalled isFaceDown={!fate.canSee} canPeek={fate.canSee} />
              </div>
              <motion.div
                className={`absolute left-1/2 top-1/2 px-3 py-1 rounded-[2px] border-2 font-cyber font-bold uppercase tracking-[0.2em] text-lg shadow-xl flex items-center gap-1.5 whitespace-nowrap ${stamp.className}`}
                initial={{ opacity: 0, scale: 2.2, x: '-50%', y: '-50%', rotate: -12 }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%', rotate: -12 }}
                transition={{ delay: 0.15, duration: 0.2, ease: 'easeOut' }}
              >
                {stamp.icon}
                {stamp.label}
              </motion.div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  </MotionConfig>
);
