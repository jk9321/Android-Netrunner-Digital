import { CardInstance, GameAction, actingSide } from '../../core';
import type { GameController } from '../useGameController';
import { canActAs, canSeeCorpSecrets, canSeeRunnerSecrets } from '../viewer';
import { AccessedPanel } from './AccessedPanel';
import { CardFates } from './CardFates';
import { CardZoomModal } from './CardZoomModal';
import { GameOverModal } from './GameOverModal';
import { HandoffScreen } from './HandoffScreen';
import { PromptPanel, type PromptPanelProps } from './PromptPanel';
import { RunOverlay, type RunOverlayProps } from './RunOverlay';
import { TurnBanner } from './TurnBanner';
import { ZoneId, ZoneViewer, zoneContents } from './ZoneViewer';

interface GameOverlaysProps {
  ctl: GameController;
  ended: boolean;
  winReason: string | null | undefined;
  inspectedCard: CardInstance | null;
  onInspectCard: (card: CardInstance | null) => void;
  zone: ZoneId | null;
  zoneView: ReturnType<typeof zoneContents> | null;
  onCloseZone: () => void;
  gameOverHidden: boolean;
  onGameOverHiddenChange: (hidden: boolean) => void;
  onNewGame: () => void;
  onRematch?: () => void;
  /** True while RunOverlay is rendered docked inside the desktop sidebar (or paused behind a docked prompt). */
  hideRunOverlay?: boolean;
  /** Re-dock a popped-out RunOverlay back into the desktop sidebar. */
  onToggleRunDock?: () => void;
  /** True while PromptPanel is rendered docked inside the desktop sidebar. */
  hidePromptPanel?: boolean;
  /** Re-dock a popped-out dockable PromptPanel back into the desktop sidebar. */
  onTogglePromptDock?: () => void;
  /** True while AccessedPanel is rendered docked inside the desktop sidebar. */
  hideAccessedPanel?: boolean;
}

/** Whether the viewer at this screen can answer the active prompt right now. */
export function canAnswerActivePrompt(ctl: GameController): boolean {
  const { seat, gameState, aiSide, viewer } = ctl;
  const prompt = gameState.pendingPrompts[0];
  return (
    !prompt ||
    (canActAs(viewer, prompt.side) &&
      prompt.side !== aiSide &&
      // The viewer's own prompt may wait behind the other side's, which this screen doesn't see
      seat.waitingOn === prompt.side)
  );
}

/** Builds RunOverlay action/state props from the shared game controller so sidebar and floating modes stay identical. */
export function runOverlayPropsFromController(
  ctl: GameController,
  onInspectCard: (card: CardInstance | null) => void,
): Omit<RunOverlayProps, 'docked' | 'onToggleDock'> {
  const { gameState, handleAction, rezWindow, rezWindowOpen, passWindow, viewer, corpCanAct, runnerCanAct } = ctl;
  const rezAction = (card: CardInstance): GameAction => ({ type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId });
  return {
    state: gameState,
    onContinueRun: () => handleAction({ type: 'CONTINUE_RUN', player: 'runner' }),
    onJackOut: () => handleAction({ type: 'JACK_OUT', player: 'runner' }),
    rezCards: rezWindowOpen ? rezWindow!.cards : [],
    onRez: corpCanAct ? (card) => handleAction(rezAction(card)) : undefined,
    rezAbilities: rezWindowOpen ? rezWindow!.abilities : [],
    onDoneRezzing: rezWindowOpen && corpCanAct ? () => passWindow('corp') : undefined,
    onPassRun: rezWindowOpen && corpCanAct ? () => passWindow('corp', true) : undefined,
    runnerControls: runnerCanAct && gameState.priority?.holder !== 'corp',
    canPeekCorp: canSeeCorpSecrets(viewer),
    onInspectCard: (card) => onInspectCard(card),
    onAction: handleAction,
  };
}

/** Builds PromptPanel action/state props from the shared game controller so sidebar and floating modes stay identical. */
export function promptPanelPropsFromController(
  ctl: GameController,
  onInspectCard: (card: CardInstance | null) => void,
): Omit<PromptPanelProps, 'docked' | 'onToggleDock' | 'runContext'> {
  const { seat, gameState, handleAction, cancelChoice } = ctl;
  return {
    state: gameState,
    onAnswer: (choice) => {
      const prompt = gameState.pendingPrompts[0];
      if (prompt) handleAction({ type: 'RESOLVE_PROMPT', player: prompt.side, promptId: prompt.id, choice });
    },
    onInspectCard: (card) => onInspectCard(card),
    onCancel: cancelChoice,
    waitingFor: seat.waitingOn && seat.waitingOn !== actingSide(gameState) ? seat.waitingOn : null,
    canAnswer: canAnswerActivePrompt(ctl),
  };
}

/** Floating overlays and modals over the tabletop: runs, prompts, turn banners, accessed/zone viewers, handoff, game over, and card zoom. */
export function GameOverlays({
  ctl,
  ended,
  winReason,
  inspectedCard,
  onInspectCard,
  zone,
  zoneView,
  onCloseZone,
  gameOverHidden,
  onGameOverHiddenChange,
  onNewGame,
  onRematch,
  hideRunOverlay = false,
  onToggleRunDock,
  hidePromptPanel = false,
  onTogglePromptDock,
  hideAccessedPanel = false,
}: GameOverlaysProps) {
  const {
    gameState,
    setHotseatSide,
    accessed,
    clearAccessed,
    fates,
    humanSide,
    rezWindowOpen,
    viewer,
    handoffTo,
    online,
  } = ctl;

  const { corp, runner, activePlayer, winner } = gameState;

  return (
    <>
      {/* Active Run Overlay; the run and any open decision end with the game (rule 1.7.1) */}
      {!ended && !hideRunOverlay && (
        <RunOverlay {...runOverlayPropsFromController(ctl, onInspectCard)} onToggleDock={onToggleRunDock} />
      )}

      {/* Pending player decision (mulligan, discard, board/pile effects, access) */}
      {!ended && !hidePromptPanel && (
        <PromptPanel
          {...promptPanelPropsFromController(ctl, onInspectCard)}
          onToggleDock={onTogglePromptDock}
        />
      )}

      {!ended && <TurnBanner activePlayer={activePlayer} humanSide={humanSide} />}

      {!handoffTo && <CardFates fates={fates} />}

      {!hideAccessedPanel && accessed.length > 0 && !handoffTo && (
        <AccessedPanel cards={accessed} onInspect={onInspectCard} onClose={clearAccessed} />
      )}

      {zoneView && (
        <ZoneViewer
          title={zoneView.title}
          groups={zoneView.groups}
          canPeek={zone === 'stack' ? canSeeRunnerSecrets(viewer) : canSeeCorpSecrets(viewer)}
          onClose={onCloseZone}
          onInspect={onInspectCard}
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

      {ended && (
        <GameOverModal
          winner={winner ?? null}
          reason={winReason}
          corpScore={corp.score}
          runnerScore={runner.score}
          humanSide={humanSide}
          onRematch={onRematch}
          onDeckSelect={onNewGame}
          deckSelectLabel={online ? 'Back to the start screen' : undefined}
          minimized={gameOverHidden}
          onMinimizedChange={onGameOverHiddenChange}
        />
      )}

      {/* Full Card Zoom Modal */}
      <CardZoomModal
        card={inspectedCard}
        onClose={() => onInspectCard(null)}
      />
    </>
  );
}
