import React, { useEffect, useState } from 'react';
import { CardInstance, SideCode, cardDef, getCardScript, virusCountersInPlay } from '../../core';
import type { GameController } from '../useGameController';
import type { GameConfig } from '../savedGame';
import { canSeeCorpSecrets, canSeeRunnerSecrets } from '../viewer';
import { ZoomContext, createZoomStore } from '../components/ZoomPanel';
import { CorpBoard } from '../components/CorpBoard';
import { RunnerBoard } from '../components/RunnerBoard';
import { AbilityBar } from '../components/AbilityBar';
import { CreditHoldBar } from '../components/CreditHoldBar';
import { CorpActions, RunnerActions, useRunnerInstallFlow } from '../components/ActionBars';
import { GameMenuDrawer } from '../components/GameMenuDrawer';
import { GameOverlays } from '../components/GameOverlays';
import { LogFeed } from '../components/LogFeed';
import { ZoneId, zoneContents } from '../components/ZoneViewer';
import { showConfirm } from '../components/Dialog';
import { legalFor } from '../seat';
import { hostedCardActions } from '../legal';
import { useFlipHotseatBoards } from '../boardFlip';
import { setSoundEnabled, soundEnabled } from '../sound';
import { musicEnabled, musicVolume, setMusicEnabled, setMusicVolume } from '../music';
import { animationsEnabled, setAnimationsEnabled } from '../animations';
import { CardSize, isAutoFitOn, savedCardSize, setAutoFit, setCardSize } from '../cardSize';
import { flipHotseatBoardsEnabled, setFlipHotseatBoardsEnabled } from '../boardFlip';
import { MobileBottomSheet } from './MobileBottomSheet';
import { MobileTopBar } from './MobileHud';
import { MobileThumbCockpit } from './MobileThumbCockpit';

interface MobileGameShellProps {
  ctl: GameController;
  config: GameConfig | null;
  onNewGame: () => void;
  onRematch?: () => void;
  onConcede: () => void;
  onLeave: () => void;
  onViewMode: (mode: GameController['viewMode']) => void;
  shiftSide: SideCode | null;
}

/**
 * Isolated phone shell (`< 768px`): zero-vertical-scroll 100dvh viewport, compact top HUD,
 * mirrored dual-half board stage, fixed bottom thumb cockpit with Peeking Hand Tray, and
 * bottom sheets for Log, Abilities, and Install/MU pickers.
 */
export const MobileGameShell: React.FC<MobileGameShellProps> = ({
  ctl,
  config,
  onNewGame,
  onRematch,
  onConcede,
  onLeave,
  onViewMode,
  shiftSide,
}) => {
  const {
    seat,
    gameState,
    handleAction,
    selectedCardId,
    setSelectedCardId,
    viewMode,
    humanSide,
    stops,
    setStops,
    viewer,
    corpCanAct,
    runnerCanAct,
    aiThinking,
    online,
  } = ctl;

  const { corp, runner, activePlayer, winner } = gameState;
  const ended = !!winner || !!online?.over;
  const winReason = online?.over?.reason ?? gameState.winReason;

  const [zoomStore] = useState(createZoomStore);
  const [inspectedCard, setInspectedCard] = useState<CardInstance | null>(null);
  const [zone, setZone] = useState<ZoneId | null>(null);
  const [gameOverHidden, setGameOverHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [handExpanded, setHandExpanded] = useState(false);
  const [openSheet, setOpenSheet] = useState<'log' | 'abilities' | 'corp-install' | null>(null);
  const [corpInstallPeeking, setCorpInstallPeeking] = useState(false);
  const [seenLogCount, setSeenLogCount] = useState(gameState.log.length);

  // Settings state for GameMenuDrawer
  const [sound, setSound] = useState(soundEnabled);
  const [music, setMusic] = useState(musicEnabled);
  const [musicVol, setMusicVol] = useState(musicVolume);
  const [animations, setAnimations] = useState(animationsEnabled);
  const [cardSize, setCardSizeState] = useState(savedCardSize);
  const [autoFit, setAutoFitState] = useState(isAutoFitOn);
  const [flipHotseatSetting, setFlipHotseatSetting] = useState(flipHotseatBoardsEnabled);

  const flipHotseatBoards = useFlipHotseatBoards();
  const runnerFlow = useRunnerInstallFlow(activePlayer === 'runner' && runnerCanAct);
  const zoneView = zone ? zoneContents(zone, gameState, viewer) : null;

  // Reset transient sheets on pass-and-play viewer handover
  useEffect(() => {
    zoomStore.clear();
    setInspectedCard(null);
    setZone(null);
    setHandExpanded(false);
    setOpenSheet(null);
    setCorpInstallPeeking(false);
  }, [viewer, zoomStore]);

  // Close corp-install sheet once selection clears
  useEffect(() => {
    if (openSheet === 'corp-install' && !selectedCardId) {
      setOpenSheet(null);
      setCorpInstallPeeking(false);
    }
  }, [openSheet, selectedCardId]);

  const corpHandVisible = canSeeCorpSecrets(viewer);
  const runnerHandVisible = canSeeRunnerSecrets(viewer);
  // In Open Table, show whichever side is currently active in the thumb cockpit
  const cockpitSide: SideCode | null =
    corpHandVisible && runnerHandVisible
      ? activePlayer
      : corpHandVisible
        ? 'corp'
        : runnerHandVisible
          ? 'runner'
          : null;
  const cockpitCanAct = cockpitSide === 'corp' ? corpCanAct : cockpitSide === 'runner' ? runnerCanAct : false;
  const handCards = cockpitSide === 'corp' ? corp.hq : cockpitSide === 'runner' ? runner.grip : [];
  const handSizeLimit = cockpitSide === 'corp' ? corp.handSizeLimit : runner.handSizeLimit;
  const selectedCard = [...corp.hq, ...runner.grip].find(c => c.instanceId === selectedCardId);
  const corpOnBottom = viewer === 'corp' && (viewMode !== 'hotseat' || flipHotseatBoards);

  // Count usable card abilities / hosted actions / resource trashes for the ⚡n fallback chip
  const corpAbilities = corpCanAct
    ? legalFor(seat, 'corp').filter(a => a.type === 'USE_ABILITY' || a.type === 'TRASH_RESOURCE').length
    : 0;
  const runnerLegal = runnerCanAct ? legalFor(seat, 'runner') : [];
  const runnerAbilities = runnerCanAct
    ? runnerLegal.filter(a => a.type === 'USE_ABILITY').length +
      hostedCardActions(gameState, runnerLegal).length
    : 0;
  const abilityCount =
    (corpCanAct ? corpAbilities : 0) +
    (runnerCanAct ? runnerAbilities : 0) +
    (runnerFlow.makingRoom || runnerFlow.pickingHost ? 1 : 0);

  const hasPayingCredits = (side: SideCode) => {
    const installed: CardInstance[] =
      side === 'runner'
        ? [...runner.rig.programs, ...runner.rig.hardware, ...runner.rig.resources]
        : Object.values(corp.servers).flatMap(s => [...s.root, ...s.ice]).filter(c => c.isRezzed);
    return installed.some(c => {
      const s = getCardScript(c.cardCode);
      return (c.tokens?.credit ?? 0) > 0 && !!(s?.recurringCredits || s?.paysDuringRuns || s?.paysFor);
    });
  };
  const hasCreditHolds = !seat.cancel && ((corpCanAct && hasPayingCredits('corp')) || (runnerCanAct && hasPayingCredits('runner')));

  const hasUnreadLog = openSheet !== 'log' && gameState.log.length > seenLogCount;
  const showHotseatFlip = !online && !humanSide;

  const corpBoardEl = (
    <div className="flex-[55] min-h-0 min-w-0 flex flex-col">
      <CorpBoard
        gameState={gameState}
        seat={seat}
        viewer={viewer}
        corpCanAct={corpCanAct}
        runnerCanAct={runnerCanAct}
        onInspectCard={setInspectedCard}
        onOpenZone={setZone}
        onAction={handleAction}
        isShiftActive={shiftSide === 'corp'}
        mirrored={corpOnBottom}
      />
    </div>
  );

  const runnerBoardEl = (
    <div className="flex-[45] min-h-0 min-w-0 flex flex-col overflow-y-auto">
      <RunnerBoard
        gameState={gameState}
        viewer={viewer}
        onInspectCard={setInspectedCard}
        onOpenZone={setZone}
        isShiftActive={shiftSide === 'runner'}
        mirrored={corpOnBottom}
      />
    </div>
  );

  return (
    <div
      data-testid="mobile-game-shell"
      className="h-[100dvh] w-full overflow-hidden flex flex-col bg-[#06090e] text-slate-100 font-mono selection:bg-cyber-neonYellow selection:text-black"
    >
      <MobileTopBar
        state={gameState}
        online={online}
        aiThinking={aiThinking}
        stops={stops}
        onStops={setStops}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenZone={z => setZone(curr => (curr === z ? null : z))}
      />

      {/* Compact Victory Banner */}
      {ended && (
        <div className="shrink-0 px-2.5 py-2 bg-gradient-to-r from-amber-950/90 to-pink-950/90 border-b border-amber-500 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <div className="font-cyber font-black text-amber-400 truncate">
              {winner ? `${winner.toUpperCase()} WINS` : 'GAME OVER'}
            </div>
            {winReason && <div className="text-[11px] text-slate-300 truncate">{winReason}</div>}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setGameOverHidden(false)}
              className="px-2.5 py-1.5 rounded-[2px] bg-slate-800 border border-slate-600 text-slate-100 font-bold"
            >
              Result
            </button>
            <button
              type="button"
              onClick={onNewGame}
              className="px-2.5 py-1.5 rounded-[2px] bg-amber-400 text-black font-bold"
            >
              {online ? 'Start' : 'Again'}
            </button>
          </div>
        </div>
      )}

      {/* Dual-Half Tabletop Stage (mirrored so your side sits directly above your thumb cockpit) */}
      <ZoomContext.Provider value={zoomStore}>
        <main
          onClick={() => {
            if (handExpanded) setHandExpanded(false);
          }}
          className="flex-1 min-h-0 min-w-0 flex flex-col gap-1.5 p-1.5 overflow-hidden"
        >
          {corpOnBottom ? (
            <>
              {runnerBoardEl}
              {corpBoardEl}
            </>
          ) : (
            <>
              {corpBoardEl}
              {runnerBoardEl}
            </>
          )}
        </main>
      </ZoomContext.Provider>

      {/* Fixed Bottom Thumb Cockpit */}
      <MobileThumbCockpit
        state={gameState}
        side={cockpitSide}
        canAct={cockpitCanAct}
        handCards={handCards}
        handSizeLimit={handSizeLimit}
        selectedCardId={selectedCardId}
        onSelectCard={setSelectedCardId}
        onInspect={setInspectedCard}
        onAction={handleAction}
        handExpanded={handExpanded}
        onHandExpandedChange={setHandExpanded}
        abilityCount={abilityCount}
        hasCreditHolds={hasCreditHolds}
        onOpenAbilities={() => setOpenSheet('abilities')}
        onOpenLog={() => {
          setSeenLogCount(gameState.log.length);
          setOpenSheet('log');
        }}
        hasUnreadLog={hasUnreadLog}
        onOpenCorpInstall={() => {
          setCorpInstallPeeking(false);
          setOpenSheet('corp-install');
        }}
        runnerFlow={runnerFlow}
        aiThinking={aiThinking}
      />

      {/* Bottom Sheet: Searchable Game Log */}
      <MobileBottomSheet
        open={openSheet === 'log'}
        title="SYS.TRACE // GAME LOG"
        subtitle={`${gameState.log.length} events`}
        accentClass="border-slate-600"
        onClose={() => {
          setSeenLogCount(gameState.log.length);
          setOpenSheet(null);
        }}
        testId="mobile-log-sheet"
      >
        <LogFeed logs={gameState.log} viewer={viewer} className="h-[58dvh]" />
      </MobileBottomSheet>

      {/* Bottom Sheet: Usable Abilities, Credit Holds & Runner MU/Host Pickers */}
      <MobileBottomSheet
        open={openSheet === 'abilities'}
        title="CARD ABILITIES & OPTIONS"
        accentClass="border-amber-500/80"
        onClose={() => {
          runnerFlow.setMakingRoom(null);
          runnerFlow.setPickingHost(null);
          setOpenSheet(null);
        }}
        testId="mobile-abilities-sheet"
      >
        <div className="space-y-3">
          {corpCanAct && (
            <CorpActions
              state={gameState}
              selectedCard={selectedCard}
              onAction={action => {
                handleAction(action);
                setOpenSheet(null);
              }}
              onInspect={setInspectedCard}
              section="sidebar"
            />
          )}
          {corpCanAct && (
            <AbilityBar
              state={gameState}
              side="corp"
              onAction={action => {
                handleAction(action);
                setOpenSheet(null);
              }}
            />
          )}
          {corpCanAct && <CreditHoldBar state={gameState} side="corp" onAction={handleAction} />}
          {corpCanAct && activePlayer === 'corp' && virusCountersInPlay(gameState) === 0 && seat.can({ type: 'PURGE_VIRUS', player: 'corp' }) && (
            <button
              type="button"
              onClick={async () => {
                if (
                  !(await showConfirm('There are no virus counters to purge. Spend 3 clicks anyway?', {
                    title: 'Nothing to purge',
                    confirmLabel: 'Purge anyway',
                    danger: true,
                  }))
                )
                  return;
                handleAction({ type: 'PURGE_VIRUS', player: 'corp' });
                setOpenSheet(null);
              }}
              className="w-full h-11 px-3 rounded-[2px] border border-cyan-800 bg-cyan-950/60 text-cyan-200 text-xs font-bold"
            >
              Purge Virus Counters (3 Clicks)
            </button>
          )}
          {runnerCanAct && (
            <RunnerActions
              state={gameState}
              selectedCard={selectedCard}
              onAction={action => {
                handleAction(action);
                setOpenSheet(null);
              }}
              onInspect={setInspectedCard}
              section="sidebar"
              runnerFlow={runnerFlow}
            />
          )}
          {runnerCanAct && (
            <AbilityBar
              state={gameState}
              side="runner"
              onAction={action => {
                handleAction(action);
                setOpenSheet(null);
              }}
            />
          )}
          {runnerCanAct && <CreditHoldBar state={gameState} side="runner" onAction={handleAction} />}
        </div>
      </MobileBottomSheet>

      {/* Bottom Sheet: Corp Install Server Picker */}
      <MobileBottomSheet
        open={openSheet === 'corp-install' && !!selectedCard && corpCanAct}
        title={selectedCard ? `Install ${cardDef(selectedCard).title}` : 'Install'}
        subtitle="Pick a server below, or tap Peek to check the board"
        accentClass="border-cyan-500/80"
        peeking={corpInstallPeeking}
        onTogglePeek={() => setCorpInstallPeeking(p => !p)}
        peekLabel="Servers"
        onClose={() => {
          setCorpInstallPeeking(false);
          setOpenSheet(null);
        }}
        testId="mobile-corp-install-sheet"
      >
        {corpCanAct && (
          <CorpActions
            state={gameState}
            selectedCard={selectedCard}
            onAction={action => {
              handleAction(action);
              setCorpInstallPeeking(false);
              setOpenSheet(null);
            }}
            onInspect={setInspectedCard}
            section="sidebar"
          />
        )}
      </MobileBottomSheet>

      {/* Slide-out Settings / Menu Drawer */}
      {menuOpen && (
        <GameMenuDrawer
          state={gameState}
          config={config}
          online={online}
          ended={ended}
          humanSide={humanSide}
          viewMode={viewMode}
          onViewMode={onViewMode}
          cardSize={cardSize}
          onCardSize={(s: CardSize) => {
            setCardSize(s);
            setCardSizeState(s);
          }}
          autoFit={autoFit}
          onToggleAutoFit={() => {
            setAutoFit(!autoFit);
            setAutoFitState(!autoFit);
          }}
          sound={sound}
          onSoundChange={next => {
            setSoundEnabled(next);
            setSound(next);
          }}
          music={music}
          onMusicChange={next => {
            setMusicEnabled(next);
            setMusic(next);
          }}
          musicVol={musicVol}
          onMusicVolChange={next => {
            setMusicVolume(next);
            setMusicVol(next);
          }}
          animations={animations}
          onAnimationsChange={next => {
            setAnimationsEnabled(next);
            setAnimations(next);
          }}
          flipHotseatBoards={showHotseatFlip ? flipHotseatSetting : undefined}
          onFlipHotseatBoardsChange={
            showHotseatFlip
              ? next => {
                  setFlipHotseatBoardsEnabled(next);
                  setFlipHotseatSetting(next);
                }
              : undefined
          }
          onConcede={onConcede}
          onLeave={onLeave}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {/* Shared Overlays (Run, Prompt, Accessed, ZoneViewer, Handoff, GameOver, CardZoomModal) */}
      <GameOverlays
        ctl={ctl}
        ended={ended}
        winReason={winReason}
        inspectedCard={inspectedCard}
        onInspectCard={setInspectedCard}
        zone={zone}
        zoneView={zoneView}
        onCloseZone={() => setZone(null)}
        gameOverHidden={gameOverHidden}
        onGameOverHiddenChange={setGameOverHidden}
        onNewGame={onNewGame}
        onRematch={onRematch}
      />
    </div>
  );
};
