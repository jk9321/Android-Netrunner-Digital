import React, { useMemo, useState } from 'react';
import { CardInstance, GameAction, SideCode, cardDef, findCardAnywhere, breakerScript, iceSubtypes, isLegalAction } from './core';
import type { IceSubtype } from './core/scripts/types';
import { DEFAULT_CORP_DECK, DEFAULT_RUNNER_DECK } from './data/decks';
import { GameConfig, SavedGame, clearSavedGame } from './ui/savedGame';
import { randomSeed, startingGame } from './ui/gameStart';
import { useGameController } from './ui/useGameController';
import { DeckPicker } from './ui/components/DeckPicker';
import { CardView } from './ui/components/CardView';
import { ServerColumn } from './ui/components/ServerColumn';
import { RigView } from './ui/components/RigView';
import { RunOverlay } from './ui/components/RunOverlay';
import { LogFeed } from './ui/components/LogFeed';
import { PromptPanel } from './ui/components/PromptPanel';
import { CardZoomModal } from './ui/components/CardZoomModal';
import { AbilityBar } from './ui/components/AbilityBar';
import { ZoneId, ZoneViewer, zoneContents } from './ui/components/ZoneViewer';
import { Pile } from './ui/components/Pile';
import { HandRow } from './ui/components/HandRow';
import { ZoomContext, ZoomPanel, createZoomStore } from './ui/components/ZoomPanel';
import { CardFates } from './ui/components/CardFates';
import { HandoffScreen } from './ui/components/HandoffScreen';
import { GameOverModal } from './ui/components/GameOverModal';
import { CardScale, GameHeader, cardScaleValue } from './ui/components/GameHeader';
import { SideStrip } from './ui/components/SideStrip';
import { CorpActions, RunnerActions } from './ui/components/ActionBars';
import { AccessedPanel } from './ui/components/AccessedPanel';
import { canActAs, canSeeCorpSecrets, canSeeRunnerSecrets } from './ui/viewer';
import { Keyword } from './ui/components/Keyword';
import { showConfirm } from './ui/components/Dialog';

export default function App() {
  const [start] = useState(startingGame);
  const [config, setConfig] = useState<GameConfig | null>(start.config);
  const [lastDecks, setLastDecks] = useState({ corp: DEFAULT_CORP_DECK, runner: DEFAULT_RUNNER_DECK });

  if (!config) {
    return (
      <DeckPicker
        initialCorpDeckId={lastDecks.corp}
        initialRunnerDeckId={lastDecks.runner}
        onStart={(corpDeck, runnerDeck, ai, difficulty) => {
          setLastDecks({ corp: corpDeck.id, runner: runnerDeck.id });
          setConfig({ seed: randomSeed(), corpDeck, runnerDeck, ai, difficulty });
        }}
      />
    );
  }
  return (
    <Game
      key={config.seed}
      config={config}
      saved={start.saved?.config.seed === config.seed ? start.saved : null}
      onNewGame={() => {
        clearSavedGame();
        // Drop ?seed=... so a reload doesn't restart the old deal
        if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
        setConfig(null);
      }}
      onRematch={() => {
        clearSavedGame();
        if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
        setConfig({ ...config, seed: randomSeed() });
      }}
    />
  );
}

function Game({
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
  const {
    gameState,
    handleAction,
    selectedCardId,
    setSelectedCardId,
    viewMode,
    setViewMode,
    hotseatSide,
    setHotseatSide,
    accessed,
    clearAccessed,
    fates,
    aiSide,
    humanSide,
    rezWindowsOn,
    rezWindow,
    rezWindowOpen,
    passRezWindow,
    viewer,
    handoffTo,
    corpCanAct,
    runnerCanAct,
    aiThinking,
  } = useGameController(config, saved);

  const [gameOverHidden, setGameOverHidden] = useState(false);
  const [cardScale, setCardScale] = useState<CardScale>('normal');
  const [zoomStore] = useState(createZoomStore);
  const [inspectedCard, setInspectedCard] = useState<CardInstance | null>(null);
  const [zone, setZone] = useState<ZoneId | null>(null);
  const zoneView = zone ? zoneContents(zone, gameState) : null;

  // Back to the deck picker; a game still in progress is lost, so ask first
  const leaveGame = async () => {
    if (
      !gameState.winner &&
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

  const { corp, runner, activePlayer, activeRun, winner, winReason } = gameState;
  // Before the Corp's turn begins the header button takes the mandatory draw
  const turnAction: GameAction =
    gameState.turnStep?.kind === 'corp_turn_start' ? { type: 'START_TURN', player: 'corp' } : { type: 'END_TURN', player: activePlayer };
  const selectedCard = [...corp.hq, ...runner.grip].find(c => c.instanceId === selectedCardId);

  // What each icebreaker breaks (AI breakers: everything), matched against the icons on ice
  const breakerTypes = (card: CardInstance): IceSubtype[] => {
    const breaks = breakerScript(card)?.breaks;
    return breaks === 'any' ? ['barrier', 'code gate', 'sentry'] : breaks ? [breaks] : [];
  };

  // Runner cards installed on Corp ice (trojans), and where each one sits, for the host tags
  const onIce = [...runner.rig.programs, ...runner.rig.hardware, ...runner.rig.resources].filter(c => c.hostedOnId);
  const iceHostLabel = (card: CardInstance): string | undefined => {
    if (!card.hostedOnId) return undefined;
    const server = Object.values(corp.servers).find(s => s.ice.some(i => i.instanceId === card.hostedOnId));
    const index = server ? server.ice.findIndex(i => i.instanceId === card.hostedOnId) : -1;
    if (!server || index < 0) {
      // Hosted on one of the Runner's own cards (Gamdragon Pro on an icebreaker)
      const host = findCardAnywhere(gameState, card.hostedOnId);
      return host ? cardDef(host).title : undefined;
    }
    const ice = server.ice[index];
    const name = ice.isRezzed || canSeeCorpSecrets(viewer) ? cardDef(ice).title : 'unrezzed ice';
    // Several unrezzed ice in one server look alike, so say which one (ice 1 is innermost)
    return `${server.name} ice ${index + 1} · ${name}`;
  };

  const rezAction = (card: CardInstance): GameAction => ({ type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId });
  const approachedIce =
    activeRun && activeRun.phase === 'approach_ice' && activeRun.icePosition !== null
      ? corp.servers[activeRun.server]?.ice[activeRun.icePosition]
      : undefined;

  // The servers and the rig only change with the game state or who is looking, so selecting a
  // card, opening a zone or resizing cards reuses them instead of redrawing the whole table.
  // (Their buttons call handleAction, which always works on the latest state.)
  const serversView = useMemo(
    () =>
      Object.values(corp.servers).map(server => (
        <ServerColumn
          key={server.id}
          server={server}
          activePlayer={activePlayer}
          perspective={viewer}
          run={activeRun?.server === server.id ? activeRun : null}
          onInitiateRun={
            runnerCanAct
              ? (sId) => handleAction({ type: 'INITIATE_RUN', player: 'runner', targetServerId: sId })
              : undefined
          }
          onRezCard={(cId) =>
            handleAction({ type: 'REZ_CARD', player: 'corp', cardInstanceId: cId })
          }
          onAdvanceCard={(cId, sId) =>
            handleAction({ type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: cId, serverId: sId })
          }
          onScoreCard={(cId) =>
            handleAction({ type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: cId })
          }
          canRez={(card) => corpCanAct && isLegalAction(gameState, rezAction(card))}
          canAdvance={(card) =>
            corpCanAct &&
            isLegalAction(gameState, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: card.instanceId, serverId: server.id })
          }
          canScore={(card) =>
            corpCanAct && isLegalAction(gameState, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: card.instanceId })
          }
          onInspectCard={(card) => setInspectedCard(card)}
          hostedOnIce={(ice) => onIce.filter(c => c.hostedOnId === ice.instanceId)}
          iceTypes={(ice) => iceSubtypes(ice, gameState)}
          anchor={
            server.id === 'hq' ? (
              <CardView card={corp.identity} size="fit" notInstalled onInspect={setInspectedCard} />
            ) : server.id === 'rd' ? (
              <Pile label="R&D" count={corp.rd.length} side="corp" size="fit" hideLabel testId="pile-rd" />
            ) : server.id === 'archives' ? (
              <Pile
                label="Archives"
                count={corp.archives.faceUp.length + corp.archives.faceDown.length}
                side="corp"
                topCard={corp.archives.faceUp[corp.archives.faceUp.length - 1]}
                size="fit"
                hideLabel
                onClick={() => setZone('archives')}
                testId="pile-archives"
              />
            ) : undefined
          }
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState, viewer, corpCanAct, runnerCanAct],
  );
  const rigView = useMemo(
    () => (
      <RigView
        rig={runner.rig}
        onInspectCard={setInspectedCard}
        hostLabel={iceHostLabel}
        breaks={breakerTypes}
        aside={
          <>
            <CardView card={runner.identity} size="fit" notInstalled onInspect={setInspectedCard} />
            <div />
            <Pile label="Stack" count={runner.stack.length} side="runner" size="fit" testId="pile-stack" />
            <Pile
              label="Heap"
              count={runner.heap.length}
              side="runner"
              topCard={runner.heap[runner.heap.length - 1]}
              size="fit"
              onClick={() => setZone('heap')}
              testId="pile-heap"
            />
          </>
        }
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState, viewer],
  );
  // New only when a move changes the piles, so the hands below can skip redrawing
  const discardedIds = useMemo(
    () => new Set([...runner.heap, ...corp.archives.faceUp, ...corp.archives.faceDown].map(c => c.instanceId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState],
  );

  return (
    <div
      className="min-h-screen lg:h-screen lg:overflow-hidden text-slate-100 flex flex-col font-mono selection:bg-cyber-neonYellow selection:text-black"
      style={{ '--card-scale': cardScaleValue(cardScale) } as React.CSSProperties}
    >
      <GameHeader
        state={gameState}
        config={config}
        aiThinking={aiThinking}
        humanSide={humanSide}
        canEndTurn={(activePlayer === 'corp' ? corpCanAct : runnerCanAct) && isLegalAction(gameState, turnAction)}
        onEndTurn={() => handleAction(turnAction)}
        cardScale={cardScale}
        onCardScale={setCardScale}
        viewMode={viewMode}
        onViewMode={setViewMode}
        concedingSide={concedingSide}
        onConcede={concede}
        onLeave={leaveGame}
      />

      {/* Main Tabletop */}
      <div className="flex-1 min-h-0 w-full flex flex-col lg:flex-row gap-2 p-2">
      {/* Cards on the table send their hover to the zoom panel in the side bar */}
      <ZoomContext.Provider value={zoomStore}>
      <main className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
        {/* Victory Banner */}
        {winner && (
          <div className="shrink-0 p-3 bg-gradient-to-r from-amber-950/80 to-pink-950/80 border-2 border-amber-500 chamfer flex items-center justify-between shadow-2xl">
            <div>
              <h2 className="text-xl font-cyber font-black text-amber-400">
                GAME OVER // {winner.toUpperCase()} VICTORIOUS
              </h2>
              <p className="text-xs text-slate-300 mt-1">{winReason}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setGameOverHidden(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold rounded-xl text-xs shadow-lg transition-colors"
              >
                Show result
              </button>
              <button
                onClick={onNewGame}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl text-xs shadow-lg transition-colors"
              >
                Play Again
              </button>
            </div>
          </div>
        )}

        {/* CORP SECTOR (TOP HALF) */}
        <section id="corp-board" className="flex-1 min-h-0 flex flex-col gap-1.5 bg-slate-950/70 border border-cyan-900/80 chamfer hud-frame hud-corp p-2 shadow-xl relative w-full min-w-0">
          <SideStrip side="corp" state={gameState} onInspect={setInspectedCard} onOpenZone={setZone} />

          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 min-w-0">
          {/* Servers Grid */}
          <div className="flex items-start gap-2 flex-1 min-w-0 min-h-0 overflow-auto pt-2 pb-1">
            {serversView}
          </div>
          {/* Corp HQ Hand: beside the servers on wide screens */}
          <div className="min-w-0 lg:max-w-[45%] shrink-0 flex flex-col overflow-x-auto overflow-y-hidden">
            <div className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider">
              <span><Keyword id="hq">HQ</Keyword> Hand (<Keyword id="hand-size">{corp.hq.length} / {corp.handSizeLimit}</Keyword>)</span>
            </div>
            <HandRow
              cards={corp.hq}
              side="corp"
              canSee={canSeeCorpSecrets(viewer)}
              isSelectable={activePlayer === 'corp' && corpCanAct}
              selectedCardId={selectedCardId}
              onSelect={setSelectedCardId}
              onInspect={setInspectedCard}
              discardedIds={discardedIds}
            />
          </div>
          </div>
        </section>

        {/* RUNNER SECTOR (BOTTOM): the rig is two rows, so it takes what it needs and the Corp gets the rest */}
        <section id="runner-board" className="flex-none lg:max-h-[55%] min-h-0 flex flex-col gap-1.5 bg-slate-950/70 border border-pink-900/80 chamfer hud-frame hud-runner p-2 shadow-xl relative w-full min-w-0">
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 min-w-0">
          {/* Runner Rig (Installed Programs, Hardware, Resources) */}
          <div className="flex-1 min-w-0 min-h-0 overflow-auto">
            {rigView}
          </div>
          {/* Runner Grip Hand: beside the rig on wide screens */}
          <div className="min-w-0 lg:max-w-[45%] shrink-0 flex flex-col overflow-x-auto overflow-y-hidden">
            <div className="text-[11px] text-pink-400 font-bold uppercase tracking-wider">
              <span><Keyword id="grip">Grip</Keyword> Hand (<Keyword id="hand-size">{runner.grip.length} / {runner.handSizeLimit}</Keyword>)</span>
            </div>
            <HandRow
              cards={runner.grip}
              side="runner"
              canSee={canSeeRunnerSecrets(viewer)}
              isSelectable={activePlayer === 'runner' && runnerCanAct}
              selectedCardId={selectedCardId}
              onSelect={setSelectedCardId}
              onInspect={setInspectedCard}
              discardedIds={discardedIds}
            />
          </div>
          </div>

          <SideStrip side="runner" state={gameState} onInspect={setInspectedCard} onOpenZone={setZone} />

        </section>

      </main>
      </ZoomContext.Provider>

      {/* Side bar: the hovered card, the acting side's actions, then the log */}
      <aside className="lg:w-80 2xl:w-96 shrink-0 flex flex-col gap-2 min-h-0">
        <div className="hidden lg:block shrink-0">
          <ZoomPanel store={zoomStore} onInspect={setInspectedCard} />
        </div>
        <div className="shrink-0 lg:max-h-[40vh] overflow-y-auto flex flex-col gap-2 empty:hidden">
          {activePlayer === 'corp' && corpCanAct && <CorpActions state={gameState} selectedCard={selectedCard} onAction={handleAction} />}
          {corpCanAct && <AbilityBar state={gameState} side="corp" onAction={handleAction} />}
          {activePlayer === 'runner' && runnerCanAct && (
            <RunnerActions state={gameState} selectedCard={selectedCard} onAction={handleAction} />
          )}
          {runnerCanAct && <AbilityBar state={gameState} side="runner" onAction={handleAction} />}
        </div>
        <LogFeed logs={gameState.log} viewer={viewer} className="h-56 lg:h-auto lg:flex-1 lg:min-h-[6rem]" />
      </aside>
      </div>

      {/* Active Run Overlay */}
      <RunOverlay
        state={gameState}
        onContinueRun={() => handleAction({ type: 'CONTINUE_RUN', player: 'runner' })}
        onJackOut={() => handleAction({ type: 'JACK_OUT', player: 'runner' })}
        rezCards={
          rezWindowsOn
            ? rezWindowOpen
              ? rezWindow!.cards
              : []
            : approachedIce && isLegalAction(gameState, rezAction(approachedIce))
              ? [approachedIce]
              : []
        }
        onRez={corpCanAct ? (card) => handleAction(rezAction(card)) : undefined}
        rezAbilities={rezWindowOpen ? rezWindow!.abilities : []}
        onDoneRezzing={rezWindowOpen && corpCanAct ? () => passRezWindow(rezWindow!.key) : undefined}
        runnerControls={runnerCanAct}
        canPeekCorp={canSeeCorpSecrets(viewer)}
        onInspectCard={setInspectedCard}
        onAction={handleAction}
      />

      {/* Pending player decision (mulligan, discard, trash on access) */}
      <PromptPanel
        state={gameState}
        onAnswer={(choice) => {
          const prompt = gameState.pendingPrompts[0];
          if (prompt) handleAction({ type: 'RESOLVE_PROMPT', player: prompt.side, promptId: prompt.id, choice });
        }}
        onInspectCard={setInspectedCard}
        canAnswer={
          !gameState.pendingPrompts[0] ||
          (canActAs(viewer, gameState.pendingPrompts[0].side) && gameState.pendingPrompts[0].side !== aiSide)
        }
      />

      {!handoffTo && <CardFates fates={fates} />}

      {accessed.length > 0 && !handoffTo && (
        <AccessedPanel cards={accessed} viewer={viewer} onInspect={setInspectedCard} onClose={clearAccessed} />
      )}

      {zoneView && (
        <ZoneViewer
          title={zoneView.title}
          groups={zoneView.groups}
          canPeek={canSeeCorpSecrets(viewer)}
          onClose={() => setZone(null)}
          onInspect={setInspectedCard}
        />
      )}

      {handoffTo && (
        <HandoffScreen
          to={handoffTo}
          reason={
            gameState.pendingPrompts[0]
              ? 'decision'
              : rezWindowOpen
                ? 'rez'
                : 'turn'
          }
          onReady={() => {
            setHotseatSide(handoffTo);
            // Show the incoming player their own board and hand
            // (window.scrollTo, not scrollIntoView, which would also scroll the overflow-hidden <main>)
            requestAnimationFrame(() => {
              const board = document.getElementById(`${handoffTo}-board`);
              if (board) window.scrollTo({ top: board.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
            });
          }}
        />
      )}

      {winner && (
        <GameOverModal
          winner={winner}
          reason={winReason}
          corpScore={corp.score}
          runnerScore={runner.score}
          humanSide={humanSide}
          onRematch={onRematch}
          onDeckSelect={onNewGame}
          minimized={gameOverHidden}
          onMinimizedChange={setGameOverHidden}
        />
      )}

      {/* Full Card Zoom Modal */}
      <CardZoomModal
        card={inspectedCard}
        onClose={() => setInspectedCard(null)}
      />
    </div>
  );
}
