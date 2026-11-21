import React, { useEffect, useState } from 'react';
import { CardInstance, actingSide, activePrompt } from '../../core';
import type { GameController } from '../useGameController';
import { canAnswerActivePrompt, promptPanelPropsFromController } from '../components/GameOverlays';
import { PromptPanel } from '../components/PromptPanel';
import { MobileBottomSheet } from './MobileBottomSheet';

interface MobilePromptSheetProps {
  ctl: GameController;
  ended: boolean;
  onInspectCard: (card: CardInstance | null) => void;
}

/**
 * Peekable bottom sheet for pending player decisions (mulligan, discard, trash on access,
 * access order, card/server picks, arrange). When the opponent is deciding, renders a slim
 * non-blocking top pill instead so you can inspect the board freely.
 */
export const MobilePromptSheet: React.FC<MobilePromptSheetProps> = ({
  ctl,
  ended,
  onInspectCard,
}) => {
  const { seat, gameState } = ctl;
  const prompt = !ended ? activePrompt(gameState) : undefined;
  const waitingFor = !ended && seat.waitingOn && seat.waitingOn !== actingSide(gameState) ? seat.waitingOn : null;
  const canAnswer = !ended && !!prompt && canAnswerActivePrompt(ctl);
  const [peeking, setPeeking] = useState(false);

  // Restore sheet cleanly whenever a new prompt arrives
  useEffect(() => {
    setPeeking(false);
  }, [prompt?.id]);

  if (ended || (!prompt && !waitingFor)) return null;

  // Opponent's decision: non-blocking top pill so the board stays unobstructed
  if (!prompt || !canAnswer) {
    const side = waitingFor ?? prompt?.side;
    const topOffset = gameState.activeRun
      ? 'top-[calc(env(safe-area-inset-top)+6.75rem)]'
      : 'top-[calc(env(safe-area-inset-top)+3.25rem)]';
    return (
      <div
        data-testid="mobile-prompt-waiting"
        className={`fixed inset-x-3 ${topOffset} z-[50] bg-[#0a101b]/95 border border-slate-700 rounded-[4px] px-3 py-2 text-xs font-mono text-slate-300 shadow-xl text-center backdrop-blur-md`}
      >
        Waiting on the {side === 'corp' ? 'Corp' : 'Runner'} to decide…
      </div>
    );
  }

  const isCorp = prompt.side === 'corp';
  const runContext = gameState.activeRun
    ? {
        serverName: gameState.corp.servers[gameState.activeRun.server]?.name ?? gameState.activeRun.server,
        phase: gameState.activeRun.phase,
      }
    : undefined;

  return (
    <MobileBottomSheet
      open
      title={
        <span className={`font-cyber uppercase ${isCorp ? 'text-cyan-400' : 'text-pink-400'}`}>
          {isCorp ? 'Corp' : 'Runner'} Decision
        </span>
      }
      subtitle={
        runContext
          ? `Run on ${runContext.serverName} · ${runContext.phase.replace(/_/g, ' ')}`
          : prompt.message
      }
      accentClass={isCorp ? 'border-cyan-500' : 'border-pink-500'}
      peeking={peeking}
      onTogglePeek={() => setPeeking(p => !p)}
      peekLabel="Decide"
      keepMountedWhilePeeking
      zIndexClass="z-[50]"
      contentClassName="flex-1 min-h-0 flex flex-col overflow-hidden"
      testId="mobile-prompt-sheet"
    >
      <PromptPanel
        {...promptPanelPropsFromController(ctl, onInspectCard)}
        docked
        runContext={runContext}
        className="flex-1 min-h-0 border-0 rounded-none shadow-none bg-transparent"
      />
    </MobileBottomSheet>
  );
};
