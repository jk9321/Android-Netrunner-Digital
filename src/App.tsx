import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CardInstance, SideCode, activePrompt } from './core';
import { SeatContext } from './ui/seat';
import { DEFAULT_CORP_DECK, DEFAULT_RUNNER_DECK } from './data/decks';
import { GameConfig, SavedGame, clearSavedGame } from './ui/savedGame';
import { randomSeed, startingGame } from './ui/gameStart';
import { GameController, useGameController } from './ui/useGameController';
import { useOnlineController } from './ui/useOnlineController';
import { OnlineSession, OnlineTable, browserSocket, clearSession, leavingForgetsSeat, loadSession, saveSession } from './net/client';
import { codeFromPath, roomPresence } from './net/lobby';
import { ConnectingScreen, OnlineNotice, WaitingRoom } from './ui/components/OnlineScreens';
import { DeckPicker } from './ui/components/DeckPicker';
import { LogFeed } from './ui/components/LogFeed';
import { WindowBar } from './ui/components/WindowBar';
import { AbilityBar } from './ui/components/AbilityBar';
import { ZoneId, zoneContents } from './ui/components/ZoneViewer';
import { ZoomContext, ZoomPanel, createZoomStore } from './ui/components/ZoomPanel';
import { GameHeader } from './ui/components/GameHeader';
import { CorpActions, RunnerActions } from './ui/components/ActionBars';
import { CorpBoard } from './ui/components/CorpBoard';
import { RunnerBoard } from './ui/components/RunnerBoard';
import { GameOverlays, canAnswerActivePrompt, promptPanelPropsFromController, runOverlayPropsFromController } from './ui/components/GameOverlays';
import { PromptPanel, isPromptDockable } from './ui/components/PromptPanel';
import { RunOverlay } from './ui/components/RunOverlay';
import { showAlert, showConfirm } from './ui/components/Dialog';
import { MotionConfig } from 'framer-motion';
import { useAnimationsEnabled } from './ui/animations';
import { GameStateContext } from './ui/liveValues';
import { stopMusic, updateMusic } from './ui/music';

/** What the app shows: the start screen (maybe joining from an invite link), a local game, or an online one. */
type Screen = { kind: 'start'; joinCode: string | null } | { kind: 'local'; config: GameConfig } | { kind: 'online'; session: OnlineSession };

/**
 * Where the app opens: an invite link (/play/K7QM-2X) on Join with the code
 * filled in, unless this browser is already seated at that game; the online
 * game this browser is seated at (a reload or a closed tab resumes it); else
 * a local game in progress or a ?seed= link, else the start screen.
 */
function startingScreen(local: ReturnType<typeof startingGame>): Screen {
  const linkCode = codeFromPath(window.location.pathname);
  const session = loadSession();
  if (linkCode && session?.code !== linkCode) return { kind: 'start', joinCode: linkCode };
  if (session) return { kind: 'online', session };
  return local.config ? { kind: 'local', config: local.config } : { kind: 'start', joinCode: null };
}

/** Puts the address back to / (leaving an invite link or a replay link). */
function homeAddress() {
  if (window.location.pathname !== '/' || window.location.search) window.history.replaceState(null, '', '/');
}

export default function App() {
  const [start] = useState(startingGame);
  const [screen, setScreen] = useState<Screen>(() => startingScreen(start));
  const [lastDecks, setLastDecks] = useState({ corp: DEFAULT_CORP_DECK, runner: DEFAULT_RUNNER_DECK });
  const animationsOn = useAnimationsEnabled();
  // An online game on screen lives at /, never at its invite link (which would offer to join it again)
  useEffect(() => {
    if (screen.kind === 'online') homeAddress();
  }, [screen.kind]);

  const toStart = () => {
    homeAddress();
    setScreen({ kind: 'start', joinCode: null });
  };

  if (screen.kind === 'start') {
    return (
      <MotionConfig reducedMotion={animationsOn ? 'user' : 'always'}>
        <DeckPicker
          initialCorpDeckId={lastDecks.corp}
          initialRunnerDeckId={lastDecks.runner}
          joinCode={screen.joinCode}
          onLeaveLink={homeAddress}
          onStart={(corpDeck, runnerDeck, ai, difficulty) => {
            setLastDecks({ corp: corpDeck.id, runner: runnerDeck.id });
            setScreen({ kind: 'local', config: { seed: randomSeed(), corpDeck, runnerDeck, ai, difficulty } });
          }}
          onOnline={session => {
            saveSession(session);
            homeAddress();
            setScreen({ kind: 'online', session });
          }}
        />
      </MotionConfig>
    );
  }
  if (screen.kind === 'online') {
    return (
      <MotionConfig reducedMotion={animationsOn ? 'user' : 'always'}>
        <OnlineGame
          key={screen.session.code}
          session={screen.session}
          onLeave={forget => {
            if (forget) clearSession();
            toStart();
          }}
        />
      </MotionConfig>
    );
  }
  const config = screen.config;
  return (
    <MotionConfig reducedMotion={animationsOn ? 'user' : 'always'}>
      <LocalGame
        key={config.seed}
        config={config}
        saved={start.saved?.config.seed === config.seed ? start.saved : null}
        onNewGame={() => {
          clearSavedGame();
          // Drop ?seed=... so a reload doesn't restart the old deal
          toStart();
        }}
        onRematch={() => {
          clearSavedGame();
          homeAddress();
          setScreen({ kind: 'local', config: { ...config, seed: randomSeed() } });
        }}
      />
    </MotionConfig>
  );
}

function LocalGame({
  config,
  saved,
  onNewGame,
  onRematch,
}: {
  config: GameConfig;
  saved: SavedGame | null;
  onNewGame: () => void;
  onRematch: () => void;
}) {
  const ctl = useGameController(config, saved);
  return <GameScreen ctl={ctl} config={config} onNewGame={onNewGame} onRematch={onRematch} />;
}

/**
 * An online game: the table connects to the room; until the first state
 * arrives the host sees the invite (the game starts by itself when the second
 * player joins). A seat taken by another tab, a room that is gone or a new
 * version of the game replace the table with a notice.
 */
function OnlineGame({ session, onLeave }: { session: OnlineSession; onLeave: (forgetSeat: boolean) => void }) {
  const [table] = useState(
    () =>
      new OnlineTable(session, {
        connect: browserSocket,
        alert: message => void showAlert(message, { title: 'Action blocked' }),
        roomPresence: code => roomPresence(code),
      }),
  );
  useEffect(() => {
    table.start();
    return () => table.dispose();
  }, [table]);
  const [subscribe] = useState(() => (fn: () => void) => table.subscribe(fn));
  useSyncExternalStore(subscribe, () => table.version);

  const status = table.status;
  if (status === 'replaced' || status === 'gone' || status === 'unseated' || status === 'refresh') {
    return <OnlineNotice status={status} onTakeOver={() => table.takeOver()} onLeave={() => onLeave(leavingForgetsSeat(status))} />;
  }
  if (!table.started) {
    // Only a host whose game has not started gets the invite; a joiner or a reload mid-game just connects
    if (!session.inviting) return <ConnectingScreen onLeave={() => onLeave(false)} />;
    return <WaitingRoom code={session.code} connected={status === 'open'} onCancel={() => onLeave(true)} />;
  }
  return <OnlineTableScreen table={table} onLeave={() => onLeave(true)} />;
}

function OnlineTableScreen({ table, onLeave }: { table: OnlineTable; onLeave: () => void }) {
  const ctl = useOnlineController(table);
  return <GameScreen ctl={ctl} config={null} onNewGame={onLeave} />;
}

/** Tracks whether the viewport matches Tailwind's `lg:` desktop breakpoint (1024px+), where the right sidebar is visible. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)').matches
      : true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

/** The game screen, the same for local and online games: everything it shows comes from the controller. */
function GameScreen({
  ctl,
  config,
  onNewGame,
  onRematch,
}: {
  ctl: GameController;
  /** The local game's settings; null online. */
  config: GameConfig | null;
  onNewGame: () => void;
  /** Local games only. */
  onRematch?: () => void;
}) {
  const {
    seat,
    gameState,
    handleAction,
    selectedCardId,
    setSelectedCardId,
    viewMode,
    setViewMode,
    hotseatSide,
    humanSide,
    stops,
    setStops,
    viewer,
    corpCanAct,
    runnerCanAct,
    aiThinking,
    online,
  } = ctl;

  const isDesktop = useIsDesktop();
  const [gameOverHidden, setGameOverHidden] = useState(false);
  const [runPoppedOut, setRunPoppedOut] = useState(false);
  const [promptPoppedOutId, setPromptPoppedOutId] = useState<string | null>(null);
  const [zoomStore] = useState(createZoomStore);
  const [inspectedCard, setInspectedCard] = useState<CardInstance | null>(null);
  const [zone, setZone] = useState<ZoneId | null>(null);
  const zoneView = zone ? zoneContents(zone, gameState, viewer) : null;
  // A new viewer at the screen (pass and play hands over): nothing the last one was looking at stays up
  useEffect(() => {
    zoomStore.clear();
    setInspectedCard(null);
    setZone(null);
  }, [viewer, zoomStore]);

  // Adaptive background music driven by the active side and match tension
  useEffect(() => {
    const musicSide = humanSide ?? (viewMode === 'hotseat' ? hotseatSide : gameState.activePlayer);
    updateMusic(gameState, musicSide);
  }, [gameState, humanSide, viewMode, hotseatSide]);

  // Stop background music when leaving the game
  useEffect(() => {
    return () => {
      stopMusic();
    };
  }, []);

  // Back to the deck picker; a game still in progress is lost, so ask first
  const leaveGame = async () => {
    if (online && !ended) {
      const ok = await showConfirm(
        "Leave this online game? You won't be able to come back to it, and your opponent is left waiting. To end the game, concede instead.",
        { title: 'Leave game', confirmLabel: 'Leave', danger: true },
      );
      if (ok) onNewGame();
      return;
    }
    if (
      !ended &&
      !(await showConfirm('Leave this game and go back to deck selection? The game in progress will be lost.', {
        title: 'Leave game',
        confirmLabel: 'Leave',
        danger: true,
      }))
    )
      return;
    onNewGame();
  };
  // Concede: against the computer the person concedes; in two-player games the
  // side holding the device (pass and play) or the player whose turn it is
  const concedingSide: SideCode = humanSide ?? (viewMode === 'hotseat' ? hotseatSide : gameState.activePlayer);
  const concede = async () => {
    const name = concedingSide === 'corp' ? 'Corp' : 'Runner';
    const ok = await showConfirm(`Forfeit this game? The ${name} concedes and the ${concedingSide === 'corp' ? 'Runner' : 'Corp'} wins.`, {
      title: 'Forfeit',
      confirmLabel: 'Forfeit',
      danger: true,
    });
    if (!ok) return;
    handleAction({ type: 'CONCEDE', player: concedingSide });
  };

  // Open table reveals both sides' hidden cards, so switching to it is confirmed
  // (switching away from it is not)
  const changeViewMode = async (mode: typeof viewMode) => {
    if (
      mode === 'open' &&
      viewMode !== 'open' &&
      !(await showConfirm(
        "Open table shows both sides' hidden cards: each player's hand, unrezzed and face-down cards, and every access. Switch to open table?",
        { title: 'Open table', confirmLabel: 'Show everything', danger: true },
      ))
    )
      return;
    setViewMode(mode);
  };

  const { corp, runner, activePlayer, winner } = gameState;
  // Online the room can also end a game with no winner (a server update), and says why
  const ended = !!winner || !!online?.over;
  const winReason = online?.over?.reason ?? gameState.winReason;
  const hasActiveRun = !ended && !!gameState.activeRun;
  const runDocked = isDesktop && hasActiveRun && !runPoppedOut;
  const pendingPrompt = !ended ? activePrompt(gameState) : undefined;
  const promptDockable = isDesktop && !!pendingPrompt && canAnswerActivePrompt(ctl) && isPromptDockable(gameState, pendingPrompt);
  const promptDocked = promptDockable && promptPoppedOutId !== pendingPrompt.id;
  const sidebarDocked = promptDocked || runDocked;

  // Reset dock state when a run or prompt ends so the next one opens cleanly docked.
  useEffect(() => {
    if (!hasActiveRun) setRunPoppedOut(false);
  }, [hasActiveRun]);
  useEffect(() => {
    if (!pendingPrompt) setPromptPoppedOutId(null);
  }, [pendingPrompt]);

  const [shiftSide, setShiftSide] = useState<SideCode | null>(null);
  const prevActivePlayer = useRef(activePlayer);

  useEffect(() => {
    if (prevActivePlayer.current !== activePlayer && !winner) {
      prevActivePlayer.current = activePlayer;
      setShiftSide(activePlayer);
      const timer = setTimeout(() => setShiftSide(null), 540);
      return () => clearTimeout(timer);
    }
  }, [activePlayer, winner]);

  const selectedCard = [...corp.hq, ...runner.grip].find(c => c.instanceId === selectedCardId);

  // New only when a move changes the piles, so the hands below can skip redrawing
  const discardedIds = useMemo(
    () => new Set([...runner.heap, ...corp.archives.faceUp, ...corp.archives.faceDown].map(c => c.instanceId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState],
  );

  return (
    <GameStateContext.Provider value={gameState}>
      <SeatContext.Provider value={seat}>
        <div
          className="min-h-screen lg:h-screen lg:overflow-hidden text-slate-100 flex flex-col font-mono selection:bg-cyber-neonYellow selection:text-black"
        >
          <GameHeader
            state={gameState}
            config={config}
            online={online}
            aiThinking={aiThinking}
            stops={stops}
            onStops={setStops}
            humanSide={humanSide}
            viewMode={viewMode}
            onViewMode={changeViewMode}
            concedingSide={concedingSide}
            onConcede={concede}
            onLeave={leaveGame}
            onOpenZone={(z) => setZone(curr => (curr === z ? null : z))}
          />

          {/* Main Tabletop */}
          <div className="flex-1 min-h-0 w-full flex flex-col lg:flex-row gap-2 p-2">
            {/* Cards on the table send their hover to the zoom panel in the side bar */}
            <ZoomContext.Provider value={zoomStore}>
              <main className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
                {/* Victory Banner */}
                {ended && (
                  <div className="shrink-0 p-3 bg-gradient-to-r from-amber-950/80 to-pink-950/80 border-2 border-amber-500 rounded-[4px] flex flex-wrap items-center justify-between gap-2 shadow-2xl">
                    <div>
                      <h2 className="text-lg sm:text-xl font-cyber font-black text-amber-400">
                        GAME OVER // {winner ? `${winner.toUpperCase()} VICTORIOUS` : 'NO WINNER'}
                      </h2>
                      <p className="text-xs text-slate-300 mt-1">{winReason}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setGameOverHidden(false)}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold rounded-[2px] border border-slate-700 border-b-2 border-b-slate-600 text-xs shadow-lg active:translate-y-[1px] active:border-b-[1px] transition-all"
                      >
                        Show result
                      </button>
                      <button
                        onClick={onNewGame}
                        className="px-5 py-2 bg-gradient-to-b from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-bold rounded-[2px] border-b-2 border-amber-700 text-xs shadow-lg active:translate-y-[1px] active:border-b-[1px] transition-all"
                      >
                        {online ? 'Back to start' : 'Play Again'}
                      </button>
                    </div>
                  </div>
                )}

                <CorpBoard
                  gameState={gameState}
                  seat={seat}
                  viewer={viewer}
                  corpCanAct={corpCanAct}
                  runnerCanAct={runnerCanAct}
                  selectedCardId={selectedCardId}
                  onSelectCard={setSelectedCardId}
                  onInspectCard={setInspectedCard}
                  onOpenZone={setZone}
                  onAction={handleAction}
                  discardedIds={discardedIds}
                  isShiftActive={shiftSide === 'corp'}
                />

                <RunnerBoard
                  gameState={gameState}
                  viewer={viewer}
                  runnerCanAct={runnerCanAct}
                  selectedCardId={selectedCardId}
                  onSelectCard={setSelectedCardId}
                  onInspectCard={setInspectedCard}
                  onOpenZone={setZone}
                  discardedIds={discardedIds}
                  isShiftActive={shiftSide === 'runner'}
                />
              </main>
            </ZoomContext.Provider>

            {/* Side bar: during desktop runs or board/run prompts, the active panel replaces ZoomPanel + turn actions while LogFeed stays visible below */}
            <aside
              className={`contents lg:flex ${sidebarDocked ? 'lg:w-96 2xl:w-[26rem]' : 'lg:w-80 2xl:w-96'} shrink-0 flex-col gap-2 min-h-0`}
            >
              {promptDocked ? (
                <PromptPanel
                  {...promptPanelPropsFromController(ctl, setInspectedCard)}
                  docked
                  onToggleDock={() => setPromptPoppedOutId(pendingPrompt!.id)}
                  runContext={
                    gameState.activeRun
                      ? {
                          serverName: gameState.corp.servers[gameState.activeRun.server]?.name ?? gameState.activeRun.server,
                          phase: gameState.activeRun.phase,
                        }
                      : undefined
                  }
                />
              ) : runDocked ? (
                <>
                  <RunOverlay
                    {...runOverlayPropsFromController(ctl, setInspectedCard)}
                    docked
                    onToggleDock={() => setRunPoppedOut(true)}
                  />
                  <div className="shrink-0 max-h-[20vh] overflow-y-auto flex flex-col gap-1.5 empty:hidden">
                    {corpCanAct && <AbilityBar state={gameState} side="corp" onAction={handleAction} />}
                    {runnerCanAct && <AbilityBar state={gameState} side="runner" onAction={handleAction} />}
                  </div>
                </>
              ) : (
                <>
                  <div className="hidden lg:block shrink-0">
                    <ZoomPanel store={zoomStore} state={gameState} onInspect={setInspectedCard} />
                  </div>
                  <div className="sticky bottom-0 z-20 lg:static bg-[#06090d]/95 lg:bg-transparent backdrop-blur-md lg:backdrop-blur-none py-1 lg:py-0 shrink-0 lg:max-h-[40vh] overflow-y-auto flex flex-col gap-2 empty:hidden">
                    {activePlayer === 'corp' && corpCanAct && <CorpActions state={gameState} selectedCard={selectedCard} onAction={handleAction} onInspect={setInspectedCard} />}
                    {corpCanAct && <WindowBar state={gameState} side="corp" onAction={handleAction} />}
                    {corpCanAct && <AbilityBar state={gameState} side="corp" onAction={handleAction} />}
                    {activePlayer === 'runner' && runnerCanAct && (
                      <RunnerActions state={gameState} selectedCard={selectedCard} onAction={handleAction} onInspect={setInspectedCard} />
                    )}
                    {runnerCanAct && <WindowBar state={gameState} side="runner" onAction={handleAction} />}
                    {runnerCanAct && <AbilityBar state={gameState} side="runner" onAction={handleAction} />}
                  </div>
                </>
              )}
              <LogFeed
                logs={gameState.log}
                viewer={viewer}
                className={sidebarDocked ? 'flex-1 min-h-[7rem]' : 'h-56 lg:h-auto lg:flex-1 lg:min-h-[6rem]'}
              />
            </aside>
          </div>

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
            hideRunOverlay={runDocked || promptDocked}
            onToggleRunDock={isDesktop ? () => setRunPoppedOut(false) : undefined}
            hidePromptPanel={promptDocked}
            onTogglePromptDock={promptDockable ? () => setPromptPoppedOutId(null) : undefined}
          />
        </div>
      </SeatContext.Provider>
    </GameStateContext.Provider>
  );
}
