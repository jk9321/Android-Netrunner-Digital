import React, { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SideCode } from '../../core';
import { ArrowRightLeft } from 'lucide-react';

interface HandoffScreenProps {
  to: SideCode;
  /** Why the screen is changing hands. */
  reason: 'turn' | 'decision' | 'rez';
  onReady: () => void;
}

const REASON: Record<HandoffScreenProps['reason'], string> = {
  turn: 'It is their move.',
  decision: 'They have a decision to make.',
  rez: 'The Runner is approaching: the Corp may rez.',
};

const ARM_DELAY_MS = 350;

/** Pass and play: hides the board until the other player has the screen. */
export const HandoffScreen: React.FC<HandoffScreenProps> = ({ to, reason, onReady }) => {
  const isCorp = to === 'corp';
  const headingId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState(false);

  // Brief arm delay prevents a stray Space/Enter or double-tap at turn end from immediately exposing the next player's hand.
  useEffect(() => {
    setArmed(false);
    const timer = window.setTimeout(() => {
      setArmed(true);
    }, ARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [to, reason]);

  useEffect(() => {
    if (armed) buttonRef.current?.focus();
  }, [armed]);

  return (
    <div
      className="fixed inset-0 z-[110] bg-cyber-darker flex items-center justify-center p-6"
      data-testid="handoff"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25 }}
        className={`max-w-md w-full text-center border rounded-[2px] p-8 font-mono bg-[#090d15] shadow-2xl ${
          isCorp ? 'border-cyan-600/80 shadow-cyan-950/60' : 'border-pink-600/80 shadow-pink-950/60'
        }`}
      >
        <ArrowRightLeft className={`w-10 h-10 mx-auto mb-4 ${isCorp ? 'text-cyan-400' : 'text-pink-400'}`} />
        <h2
          id={headingId}
          className={`font-cyber font-black tracking-widest text-xl mb-2 ${isCorp ? 'text-cyan-400' : 'text-pink-400'}`}
        >
          PASS TO THE {isCorp ? 'CORP' : 'RUNNER'}
        </h2>
        <p className="text-sm text-slate-300 mb-6">{REASON[reason]}</p>
        <button
          ref={buttonRef}
          onClick={onReady}
          disabled={!armed}
          data-testid="handoff-ready"
          className={`px-6 py-3 rounded-[2px] font-bold text-white border-b-2 active:translate-y-[1px] active:border-b-[1px] disabled:opacity-60 transition-opacity ${
            isCorp ? 'bg-cyan-700 hover:bg-cyan-600 border-cyan-500' : 'bg-pink-700 hover:bg-pink-600 border-pink-500'
          }`}
        >
          I'm the {isCorp ? 'Corp' : 'Runner'}: show my screen
        </button>
      </motion.div>
    </div>
  );
};
