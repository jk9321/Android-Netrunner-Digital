import { createPortal } from 'react-dom';
import { PAYMENT_MODE_LABELS, setPaymentMode, usePaymentMode } from '../paymentMode';
import { motion } from 'framer-motion';
import { Flag, LogOut, X } from 'lucide-react';
import { GameState, SideCode } from '../../core';
import { shouldReduceMotion } from '../animations';
import { liveStateFor, savedTableFor } from '../bugReport';
import { CardSize } from '../cardSize';
import { GameConfig } from '../savedGame';
import type { OnlineInfo } from '../useOnlineController';
import { ViewMode } from '../viewer';
import { BugReportButton } from './BugReportButton';
import { AudioFxControls, CardSizeControls, OnlineMarks, ViewModeControl } from './GameSettingsControls';
import { PhaseTracker } from './PhaseTracker';

interface GameMenuDrawerProps {
  state: GameState;
  config: GameConfig | null;
  online: OnlineInfo | null;
  ended: boolean;
  humanSide: SideCode | null;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  cardSize: CardSize;
  onCardSize: (size: CardSize) => void;
  autoFit: boolean;
  onToggleAutoFit: () => void;
  sound: boolean;
  onSoundChange: (enabled: boolean) => void;
  music: boolean;
  onMusicChange: (enabled: boolean) => void;
  musicVol: number;
  onMusicVolChange: (volume: number) => void;
  animations: boolean;
  onAnimationsChange: (enabled: boolean) => void;
  flipHotseatBoards?: boolean;
  onFlipHotseatBoardsChange?: (enabled: boolean) => void;
  /** Which viewport edge the drawer slides out from (matches the menu button edge). */
  side?: 'left' | 'right';
  onConcede: () => void;
  onLeave: () => void;
  onClose: () => void;
}

/** Slide-out SYSTEM // MENU drawer shown on screens narrower than lg. */
export function GameMenuDrawer({
  state,
  config,
  online,
  ended,
  humanSide,
  viewMode,
  onViewMode,
  cardSize,
  onCardSize,
  autoFit,
  onToggleAutoFit,
  sound,
  onSoundChange,
  music,
  onMusicChange,
  musicVol,
  onMusicVolChange,
  animations,
  onAnimationsChange,
  flipHotseatBoards,
  onFlipHotseatBoardsChange,
  side = 'right',
  onConcede,
  onLeave,
  onClose,
}: GameMenuDrawerProps) {
  const prefersReduced = shouldReduceMotion();
  const isLeft = side === 'left';

  return createPortal(
    <motion.div
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={prefersReduced ? { duration: 0 } : { duration: 0.16 }}
      className={`fixed inset-0 z-[9990] lg:hidden flex ${isLeft ? 'justify-start' : 'justify-end'} bg-black/70 backdrop-blur-sm`}
      onClick={onClose}
      data-testid="mobile-menu-backdrop"
    >
      <motion.div
        initial={prefersReduced ? false : { x: isLeft ? '-100%' : '100%' }}
        animate={{ x: 0 }}
        transition={prefersReduced ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        data-testid="mobile-menu-drawer"
        className={`w-80 max-w-[86vw] h-[100dvh] bg-[#090d15] ${isLeft ? 'border-r' : 'border-l'} border-cyan-800/60 shadow-2xl flex flex-col justify-between overflow-y-auto p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] font-mono text-xs text-slate-200`}
      >
        <div className="space-y-4">
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="font-cyber font-bold tracking-wider text-sm flex items-center gap-1.5">
              <span className="text-cyan-400">SYSTEM</span>
              <span className="text-amber-400 font-mono">//</span>
              <span className="text-pink-400">MENU</span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close menu"
              className="p-1.5 rounded-[2px] bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Turn & Phase Status */}
          <div className="space-y-2 bg-[#05080e] border border-slate-800/90 rounded-[2px] p-3">
            <div className="text-[11px] font-cyber font-bold text-slate-400 tracking-wider">GAME STATUS</div>
            <PhaseTracker state={state} />
            {online && (
              <div className="pt-1"><OnlineMarks online={online} compact={false} /></div>
            )}
          </div>

          {/* Display & View Controls */}
          <div className="space-y-3 bg-[#05080e] border border-slate-800/90 rounded-[2px] p-3">
            <div className="text-[11px] font-cyber font-bold text-slate-400 tracking-wider">DISPLAY & VIEW</div>
            <CardSizeControls
              variant="mobile"
              cardSize={cardSize}
              onCardSize={onCardSize}
              autoFit={autoFit}
              onToggleAutoFit={onToggleAutoFit}
            />
            <ViewModeControl
              variant="mobile"
              online={online}
              hasWinner={!!state.winner}
              humanSide={humanSide}
              viewMode={viewMode}
              onViewMode={onViewMode}
            />
          </div>

          {/* Payments: Auto (the usual order, hosted-credit buttons) or Manual (the payment panel) */}
          <PaymentModeControl />

          {/* Audio & Animation Settings */}
          <div className="space-y-3 bg-[#05080e] border border-slate-800/90 rounded-[2px] p-3">
            <div className="text-[11px] font-cyber font-bold text-slate-400 tracking-wider">AUDIO & FX</div>
            <AudioFxControls
              variant="mobile"
              sound={sound}
              onSoundChange={onSoundChange}
              music={music}
              onMusicChange={onMusicChange}
              musicVol={musicVol}
              onMusicVolChange={onMusicVolChange}
              animations={animations}
              onAnimationsChange={onAnimationsChange}
              flipHotseatBoards={flipHotseatBoards}
              onFlipHotseatBoardsChange={onFlipHotseatBoardsChange}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="space-y-2 border-t border-slate-800 pt-3 mt-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Found an issue?</span>
            <BugReportButton
              screen="game"
              game={config ? () => ({ config, state: liveStateFor(config.seed) ?? state, table: savedTableFor(config.seed) }) : undefined}
              online={online ? { code: online.code, token: online.token } : undefined}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {!ended && (
              <button
                onClick={() => {
                  onClose();
                  onConcede();
                }}
                className="px-3 py-2 bg-gradient-to-b from-pink-950/90 to-pink-950/40 hover:from-pink-900/90 hover:to-pink-900/40 text-pink-300 hover:text-white rounded-[2px] border border-pink-700/80 border-b-2 border-b-pink-500 font-bold flex items-center justify-center gap-1.5"
              >
                <Flag className="w-3.5 h-3.5" /> Forfeit
              </button>
            )}
            <button
              onClick={() => {
                onClose();
                onLeave();
              }}
              className={`px-3 py-2 bg-gradient-to-b from-cyan-950/90 to-cyan-950/40 hover:from-cyan-900/90 hover:to-cyan-900/40 text-cyan-300 hover:text-white rounded-[2px] border border-cyan-700/80 border-b-2 border-b-cyan-500 font-bold flex items-center justify-center gap-1.5 ${
                ended ? 'col-span-2' : ''
              }`}
            >
              <LogOut className="w-3.5 h-3.5" /> Leave Game
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** Payments: Auto or Manual (paymentMode.ts). */
function PaymentModeControl() {
  const mode = usePaymentMode();
  return (
    <div className="space-y-2 bg-[#05080e] border border-slate-800/90 rounded-[2px] p-3" data-testid="payment-mode-control">
      <div className="text-[11px] font-cyber font-bold text-slate-400 tracking-wider">PAYMENTS</div>
      <div className="flex items-center bg-[#090d15] border border-slate-800 rounded-[2px] p-0.5">
        {(['auto', 'manual'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setPaymentMode(m)}
            aria-pressed={mode === m}
            title={PAYMENT_MODE_LABELS[m].title}
            className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-[2px] ${mode === m ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            data-testid={`payment-mode-${m}`}
          >
            {PAYMENT_MODE_LABELS[m].short}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 leading-snug">{PAYMENT_MODE_LABELS[mode].title}</p>
    </div>
  );
}
