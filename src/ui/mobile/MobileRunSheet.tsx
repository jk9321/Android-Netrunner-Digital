import React, { useEffect, useState } from 'react';
import { CardInstance } from '../../core';
import type { GameController } from '../useGameController';
import { runOverlayPropsFromController } from '../components/GameOverlays';
import { RunOverlay } from '../components/RunOverlay';
import { AbilityBar, abilityActionKey } from '../components/AbilityBar';
import { CreditHoldBar } from '../components/CreditHoldBar';
import { MobileBottomSheet } from './MobileBottomSheet';

interface MobileRunSheetProps {
  ctl: GameController;
  /** Hide while a mid-run PromptSheet is open or the game has ended. */
  hidden?: boolean;
  onInspectCard: (card: CardInstance | null) => void;
}

const PHASE_LABEL: Record<string, string> = {
  initiation: 'Run Initiation',
  approach_ice: 'Approach Ice',
  encounter_ice: 'Encounter Ice',
  movement: 'Movement',
  approach_server: 'Approach Server',
  access: 'Breaching Server',
};

/**
 * Peekable bottom sheet wrapping the shared docked RunOverlay + run-window paid abilities.
 * Tapping Peek collapses the sheet to a slim top bar while keeping board rez targets live.
 */
export const MobileRunSheet: React.FC<MobileRunSheetProps> = ({
  ctl,
  hidden = false,
  onInspectCard,
}) => {
  const { gameState, handleAction, corpCanAct, runnerCanAct, rezWindow, rezWindowOpen } = ctl;
  const run = gameState.activeRun;
  const [peeking, setPeeking] = useState(false);

  // Restore sheet automatically whenever the run starts, ends, or advances to a new step
  const stepKey = run ? `${run.server}:${run.phase}:${run.icePosition ?? 'root'}:${gameState.priority?.holder ?? ''}` : '';
  useEffect(() => {
    setPeeking(false);
  }, [stepKey]);

  if (hidden || !run) return null;

  const serverName = gameState.corp.servers[run.server]?.name ?? run.server;
  const phaseLabel = PHASE_LABEL[run.phase] ?? run.phase.replace(/_/g, ' ');
  const corpRezAbilityKeys =
    rezWindowOpen && rezWindow && rezWindow.abilities.length > 0
      ? new Set(rezWindow.abilities.map(abilityActionKey))
      : undefined;
  // During an interactive encounter, EncounterPanel already lists all legal Runner USE_ABILITY buttons
  const runnerAbilitiesInEncounter = runnerCanAct && !!run.encounter && gameState.priority?.holder !== 'corp';

  return (
    <MobileBottomSheet
      open
      title={
        <span className="inline-flex items-center gap-1.5 font-cyber text-cyber-neonPink">
          <span className="w-2 h-2 rounded-full bg-cyber-neonPink animate-pulse shrink-0" />
          RUN // {serverName.toUpperCase()}
        </span>
      }
      subtitle={phaseLabel}
      accentClass="border-cyber-neonPink"
      peeking={peeking}
      onTogglePeek={() => setPeeking(p => !p)}
      peekLabel="Run"
      keepMountedWhilePeeking
      zIndexClass="z-[45]"
      contentClassName="flex-1 min-h-0 flex flex-col overflow-hidden"
      testId="mobile-run-sheet"
    >
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <RunOverlay
          {...runOverlayPropsFromController(ctl, onInspectCard)}
          docked
          className="flex-1 min-h-0 border-0 rounded-none shadow-none bg-transparent"
        />
        <div className="shrink-0 max-h-[22dvh] overflow-y-auto px-2.5 py-2 border-t border-slate-800 bg-[#070b12] flex flex-col gap-1.5 empty:hidden">
          {corpCanAct && <AbilityBar state={gameState} side="corp" onAction={handleAction} excludeKeys={corpRezAbilityKeys} />}
          {corpCanAct && <CreditHoldBar state={gameState} side="corp" onAction={handleAction} />}
          {runnerCanAct && !runnerAbilitiesInEncounter && <AbilityBar state={gameState} side="runner" onAction={handleAction} />}
          {runnerCanAct && <CreditHoldBar state={gameState} side="runner" onAction={handleAction} />}
        </div>
      </div>
    </MobileBottomSheet>
  );
};
