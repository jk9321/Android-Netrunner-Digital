import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SideCode } from '../../core';

interface TurnBannerProps {
  activePlayer: SideCode;
  /** The side the person plays against the computer; null in two-player games. */
  humanSide: SideCode | null;
}

const SHOW_MS = 1400;

/** A brief "Your turn" flash when the computer hands the turn back to the person. */
export const TurnBanner: React.FC<TurnBannerProps> = ({ activePlayer, humanSide }) => {
  const previous = useRef(activePlayer);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const changed = previous.current !== activePlayer;
    previous.current = activePlayer;
    if (!changed || !humanSide || activePlayer !== humanSide) return;
    setShown(n => n + 1);
  }, [activePlayer, humanSide]);

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!shown) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), SHOW_MS);
    return () => clearTimeout(t);
  }, [shown]);

  const isCorp = humanSide === 'corp';
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={shown}
          initial={{ opacity: 0, scaleX: 0.6 }}
          animate={{ opacity: 1, scaleX: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-x-0 top-1/3 z-[45] flex justify-center pointer-events-none"
          data-testid="turn-banner"
          aria-live="polite"
        >
          <div
            className={`px-10 py-3 chamfer border-y-2 bg-slate-950/85 font-cyber font-black tracking-[0.35em] text-2xl ${
              isCorp ? 'border-cyan-400 text-cyan-300 glow-cyan' : 'border-pink-500 text-pink-400 glow-pink'
            }`}
          >
            YOUR TURN
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
