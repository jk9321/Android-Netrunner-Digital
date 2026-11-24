import React, { useEffect, useMemo, useState } from 'react';
import { CardInstance, SideCode, activePrompt, cardDef, getCardScript, installedIce, trashableFirst, virusCountersInPlay } from '../../core';
import { playableHostZones } from '../../core/engine/actions/install';
import type { GameController } from '../useGameController';
import type { GameConfig } from '../savedGame';
import { canSeeCorpSecrets, canSeeRunnerSecrets } from '../viewer';
import { ZoomContext, createZoomStore } from '../components/ZoomPanel';
import { AbilityBar } from '../components/AbilityBar';
import { CreditHoldBar, payingCards } from '../components/CreditHoldBar';
import { CorpActions, RunnerActions, useRunnerInstallFlow } from '../components/ActionBars';
import { GameMenuDrawer } from '../components/GameMenuDrawer';
import { GameOverlays, canAnswerActivePrompt } from '../components/GameOverlays';
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
import { MobileCorpBoard } from './MobileCorpBoard';
import { MobileRunnerBoard } from './MobileRunnerBoard';
import { MobileCardSheet } from './MobileCardSheet';
import { MobileServerSheet } from './MobileServerSheet';
import { MobileRunSheet } from './MobileRunSheet';
import { MobilePromptSheet } from './MobilePromptSheet';
import { MobileAccessedBanner } from './MobileAccessedBanner';

interface MobileGameShellProps {
  ctl: GameController;
  config: GameConfig | null;
  onNewGame: () => void;
  onRematch?: () => void;
  onConcede: () => void;
  onLeave: () => void;
  onViewMode: (mode: GameController['viewMode']) => void;
  shiftSide: SideCode | null;
  /** True on short phone landscape viewports: places Corp and Runner side-by-side to preserve vertical height. */
  landscape?: boolean;
}

/**
 * Isolated phone shell (`< 768px` or short phone landscape): zero-vertical-scroll 100dvh viewport,
 * compact top HUD, mirrored dual-half mobile board stage (28px ice strips + tight rig tiles),
 * tap-to-act card and server sheets, fixed bottom thumb cockpit with Peeking Hand Tray, and
 * peekable Run/Prompt/Log/Abilities sheets.
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
  landscape = false,
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
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
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
    setActiveCardId(null);
    setActiveServerId(null);
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

  // Escape closes slide-out menu drawer
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

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

  // Legal board actions drive both the fallback abilities chip and the direct card glow borders
  const corpLegal = useMemo(() => (corpCanAct ? legalFor(seat, 'corp') : []), [corpCanAct, seat]);
  const runnerLegal = useMemo(() => (runnerCanAct ? legalFor(seat, 'runner') : []), [runnerCanAct, seat]);
  const hostedRunnerActions = useMemo(
    () => (runnerCanAct ? hostedCardActions(gameState, runnerLegal) : []),
    [runnerCanAct, gameState, runnerLegal],
  );
  // Hosted Runner programs that fit only after trashing installed programs (rules 8.5.6c)
  const hostedNeedingRoomIds = useMemo(() => {
    if (!runnerCanAct || activePlayer !== 'runner') return new Set<string>();
    const ids = new Set<string>();
    for (const card of playableHostZones(gameState).flat()) {
      if (hostedRunnerActions.some(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === card.instanceId)) continue;
      const trojan = Boolean(getCardScript(card.cardCode)?.installsOnIce);
      const all = trashableFirst(gameState, card, null).map(c => c.instanceId);
      const ice = trojan ? installedIce(gameState)[0]?.instanceId : undefined;
      if (
        all.length > 0 &&
        (!trojan || !!ice) &&
        seat.can({
          type: 'INSTALL_CARD',
          player: 'runner',
          cardInstanceId: card.instanceId,
          trashFirst: all,
          ...(ice ? { hostInstanceId: ice } : {}),
        })
      ) {
        ids.add(card.instanceId);
      }
    }
    return ids;
  }, [runnerCanAct, activePlayer, gameState, hostedRunnerActions, seat]);

  const actionableCardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of corpLegal) {
      if (
        a.type === 'REZ_CARD' ||
        a.type === 'ADVANCE_CARD' ||
        a.type === 'SCORE_AGENDA' ||
        a.type === 'USE_ABILITY' ||
        a.type === 'TRASH_RESOURCE'
      ) {
        ids.add(a.cardInstanceId);
      }
    }
    for (const a of runnerLegal) {
      if (a.type === 'USE_ABILITY') ids.add(a.cardInstanceId);
    }
    if (hostedRunnerActions.length > 0 || hostedNeedingRoomIds.size > 0) {
      const playableHosted = new Set([
        ...hostedRunnerActions
          .filter(a => a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'INSTALL_CARD')
          .map(a => a.cardInstanceId),
        ...hostedNeedingRoomIds,
      ]);
      for (const host of [...runner.rig.programs, ...runner.rig.hardware, ...runner.rig.resources]) {
        if (host.hostedCards?.some(h => playableHosted.has(h.instanceId))) ids.add(host.instanceId);
      }
    }
    return ids;
  }, [corpLegal, runnerLegal, hostedRunnerActions, hostedNeedingRoomIds, runner.rig.programs, runner.rig.hardware, runner.rig.resources]);

  const corpAbilities = corpLegal.filter(a => a.type === 'USE_ABILITY' || a.type === 'TRASH_RESOURCE').length;
  const runnerAbilities =
    runnerLegal.filter(a => a.type === 'USE_ABILITY').length +
    hostedRunnerActions.length +
    hostedNeedingRoomIds.size;
  const abilityCount = corpAbilities + runnerAbilities + (runnerFlow.makingRoom || runnerFlow.pickingHost ? 1 : 0);

  const hasCreditHolds =
    !seat.cancel &&
    ((corpCanAct && payingCards(gameState, 'corp').length > 0) ||
      (runnerCanAct && payingCards(gameState, 'runner').length > 0));
  const corpCanPurgeZeroVirus =
    corpCanAct &&
    activePlayer === 'corp' &&
    virusCountersInPlay(gameState) === 0 &&
    seat.can({ type: 'PURGE_VIRUS', player: 'corp' });
  const hasExtraOptions = hasCreditHolds || corpCanPurgeZeroVirus;
  const handoffActive = Boolean(ctl.handoffTo);

  const hasUnreadLog = openSheet !== 'log' && gameState.log.length > seenLogCount;
  const showHotseatFlip = !online && !humanSide;

  const openCardSheet = (card: CardInstance) => {
    setHandExpanded(false);
    setActiveServerId(null);
    setActiveCardId(card.instanceId);
  };

  const openServerSheet = (serverId: string) => {
    setHandExpanded(false);
    setActiveCardId(null);
    setActiveServerId(serverId);
  };

  const openZone = (next: ZoneId) => {
    setHandExpanded(false);
    setActiveCardId(null);
    setActiveServerId(null);
    setOpenSheet(null);
    setCorpInstallPeeking(false);
    setZone(curr => (curr === next ? null : next));
  };

  const corpBoardEl = (
    <div className={`flex-[54] min-h-0 min-w-0 flex flex-col rounded-[3px] transition-shadow ${shiftSide === 'corp' ? 'ring-1 ring-cyan-400/80' : ''}`}>
      <MobileCorpBoard
        gameState={gameState}
        seat={seat}
        viewer={viewer}
        runnerCanAct={runnerCanAct}
        actionableCardIds={actionableCardIds}
        mirrored={corpOnBottom}
        onTapCard={openCardSheet}
        onTapServer={openServerSheet}
        onOpenZone={openZone}
      />
    </div>
  );

  const runnerBoardEl = (
    <div className={`flex-[46] min-h-0 min-w-0 flex flex-col rounded-[3px] transition-shadow ${shiftSide === 'runner' ? 'ring-1 ring-pink-400/80' : ''}`}>
      <MobileRunnerBoard
        gameState={gameState}
        viewer={viewer}
        actionableCardIds={actionableCardIds}
        mirrored={corpOnBottom}
        onTapCard={openCardSheet}
        onOpenZone={openZone}
      />
    </div>
  );

  return (
    <div
      data-testid="mobile-game-shell"
      data-layout={landscape ? 'landscape' : 'portrait'}
      className="h-[100dvh] w-full overflow-hidden flex flex-col bg-[#06090e] text-slate-100 font-mono selection:bg-cyber-neonYellow selection:text-black"
    >
      <MobileTopBar
        state={gameState}
        online={online}
        aiThinking={aiThinking}
        stops={stops}
        onStops={setStops}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenZone={openZone}
        compact={landscape}
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

      {/* Dual-Half Tabletop Stage (stacked in portrait, side-by-side in short phone landscape) */}
      <ZoomContext.Provider value={zoomStore}>
        <main
          onClick={() => {
            if (handExpanded) setHandExpanded(false);
          }}
          className={`flex-1 min-h-0 min-w-0 flex ${landscape ? 'flex-row' : 'flex-col'} gap-1 p-1 overflow-hidden`}
        >
          {corpOnBottom && !landscape ? (
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

      {/* Inline Accessed-Cards Banner (never overlaps the thumb cockpit) */}
      {ctl.accessed.length > 0 && !ctl.handoffTo && (
        <MobileAccessedBanner
          cards={ctl.accessed}
          onInspect={setInspectedCard}
          onClose={ctl.clearAccessed}
        />
      )}

      {/* Fixed Bottom Thumb Cockpit */}
      <MobileThumbCockpit
        state={gameState}
        side={cockpitSide}
        canAct={cockpitCanAct}
        corpCanAct={corpCanAct}
        runnerCanAct={runnerCanAct}
        handCards={handCards}
        handSizeLimit={handSizeLimit}
        selectedCardId={selectedCardId}
        onSelectCard={setSelectedCardId}
        onInspect={setInspectedCard}
        onAction={handleAction}
        handExpanded={handExpanded}
        onHandExpandedChange={setHandExpanded}
        abilityCount={abilityCount}
        hasExtraOptions={hasExtraOptions}
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
        compact={landscape}
      />

      {/* Bottom Sheet: Searchable Game Log */}
      <MobileBottomSheet
        open={!handoffActive && openSheet === 'log'}
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
        open={!handoffActive && openSheet === 'abilities'}
        title="CARD ABILITIES & OPTIONS"
        accentClass="border-amber-500/80"
        onClose={() => {
          runnerFlow.setMakingRoom(null);
          runnerFlow.setPendingTrash(null);
          runnerFlow.setPickingHost(null);
          setOpenSheet(null);
        }}
        testId="mobile-abilities-sheet"
      >
        <div className="space-y-3">
          {activePlayer === 'corp' && corpCanAct && (
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
          {corpCanPurgeZeroVirus && (
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
          {activePlayer === 'runner' && runnerCanAct && (
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
        open={!handoffActive && openSheet === 'corp-install' && !!selectedCard && activePlayer === 'corp' && corpCanAct}
        title={selectedCard ? `Install ${cardDef(selectedCard).title}` : 'Install'}
        subtitle="Pick a server below, or tap Peek to check the board"
        accentClass="border-cyan-500/80"
        peeking={corpInstallPeeking}
        onTogglePeek={() => setCorpInstallPeeking(p => !p)}
        peekLabel="Servers"
        keepMountedWhilePeeking
        zIndexClass="z-[50]"
        onClose={() => {
          setCorpInstallPeeking(false);
          setOpenSheet(null);
        }}
        testId="mobile-corp-install-sheet"
      >
        {activePlayer === 'corp' && corpCanAct && (
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

      {/* Tap-to-Act Card Sheet (board cards & identities) */}
      {!handoffActive && (
        <MobileCardSheet
          state={gameState}
          cardId={activeCardId}
          viewer={viewer}
          corpCanAct={corpCanAct}
          runnerCanAct={runnerCanAct}
          onAction={handleAction}
          onClose={() => setActiveCardId(null)}
          onSelectCardId={nextId => setActiveCardId(nextId)}
          onOpenFullZoom={card => setInspectedCard(card)}
          onMakeRoomForHosted={hostedCardId => {
            runnerFlow.setPendingTrash(null);
            runnerFlow.setMakingRoom(hostedCardId);
            setOpenSheet('abilities');
          }}
        />
      )}

      {/* Tap-to-Act Server Sheet (Run button, pile browse, ordered ice/root list) */}
      {!handoffActive && (
        <MobileServerSheet
          state={gameState}
          serverId={activeServerId}
          viewer={viewer}
          runnerCanAct={runnerCanAct}
          actionableCardIds={actionableCardIds}
          onAction={handleAction}
          onSelectCard={openCardSheet}
          onOpenZone={openZone}
          onClose={() => setActiveServerId(null)}
        />
      )}

      {/* Slide-out Settings / Menu Drawer (slides from left to match top-left menu trigger) */}
      {menuOpen && !handoffActive && (
        <GameMenuDrawer
          side="left"
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

      {/* Peekable Active Run Sheet (pauses cleanly while a mid-run PromptSheet or HandoffScreen is open) */}
      <MobileRunSheet
        ctl={ctl}
        hidden={ended || handoffActive || (!!activePrompt(gameState) && canAnswerActivePrompt(ctl))}
        onInspectCard={setInspectedCard}
      />

      {/* Peekable Decision / Prompt Sheet (or slim waiting pill when opponent decides) */}
      <MobilePromptSheet ctl={ctl} ended={ended || handoffActive} onInspectCard={setInspectedCard} />

      {/* Shared Overlays (ZoneViewer, Handoff, GameOver, CardZoomModal; Run/Prompt/Accessed handled natively above) */}
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
        hideRunOverlay
        hidePromptPanel
        hideAccessedPanel
      />
    </div>
  );
};
