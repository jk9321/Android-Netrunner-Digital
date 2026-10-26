import { useEffect, useRef, useState } from 'react';
import { GameAction, SideCode, createInitialGameState, executeAction, getLegalActions, isLegalAction } from '../core';
import { AIClient } from '../ai/client';
import { deckGameSetup } from '../data/decks';
import { AccessedCard, GameConfig, SavedGame, clearSavedGame, saveGame } from './savedGame';
import { ShownFate } from './components/CardFates';
import { cardFates } from './cardFates';
import { showAlert, showConfirm } from './components/Dialog';
import { ViewMode, Viewer, actingSide, canActAs, canSeeCorpSecrets, corpRezWindow } from './viewer';
import { playForAction } from './sound';
import { VIEW_MODE_KEY, savedViewMode } from './gameStart';

const AI_DELAY_MS = 650;
/** How long a stolen, scored or trashed card stays in the middle of the table. */
const FATE_SHOW_MS = 1300;

/**
 * One game's state and the rules of the table around it: who is looking and
 * who may act, Corp rez windows, the computer's moves, saving after every
 * move, and the brief showings of stolen, scored and trashed cards.
 */
export function useGameController(config: GameConfig, saved: SavedGame | null) {
  const [gameState, setGameState] = useState(
    () => saved?.state ?? createInitialGameState(deckGameSetup(config.seed, config.corpDeck, config.runnerDeck))
  );
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Who is looking. Pass and play shows one side at a time and hands over
  // (behind a cover screen) whenever the other side has to act.
  // Against the computer a game starts in the person's own view (Open table is
  // still in the menu); two-player games start in the last mode used.
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    config.ai === 'corp' ? 'runner' : config.ai === 'runner' ? 'corp' : savedViewMode(),
  );
  const [hotseatSide, setHotseatSide] = useState<SideCode>(saved?.table.hotseatSide ?? 'corp');
  // Runs started so far, and the Corp rez windows already passed, so each window asks once
  const [runSerial, setRunSerial] = useState(saved?.table.runSerial ?? 0);
  const [passedRezWindows, setPassedRezWindows] = useState<string[]>(saved?.table.passedRezWindows ?? []);
  // Cards the Runner accessed in the latest run, shown until dismissed or the next run
  const [accessed, setAccessed] = useState<AccessedCard[]>(() =>
    (saved?.table.accessed ?? []).map(a => (typeof a === 'string' ? { code: a } : a)),
  );
  // Cards just stolen, scored or trashed, shown briefly in the middle of the table
  const [fates, setFates] = useState<ShownFate[]>([]);
  const prevStateRef = useRef(gameState);
  // The state as of the latest move, for actions applied after an await (a
  // confirm dialog) when the computer may have moved in the meantime
  const latestStateRef = useRef(gameState);
  latestStateRef.current = gameState;
  // Timers that end each card-fate showing, cleared if the game is left
  const fateTimersRef = useRef(new Set<number>());
  // Bumped to ask the computer again after it failed to move
  const [aiRetry, setAiRetry] = useState(0);

  // Against the computer: the AI plays one side and the person sees their own
  // side (or everything, with Open table).
  const aiSide = config.ai;
  const humanSide: SideCode | null = aiSide === 'corp' ? 'runner' : aiSide === 'runner' ? 'corp' : null;
  const aiRef = useRef<AIClient | null>(null);

  // The Corp gets rez windows during runs in pass and play, and whenever the computer plays a side
  const rezWindowsOn = viewMode === 'hotseat' || aiSide !== null;
  const rezWindow = corpRezWindow(gameState, runSerial);
  const rezWindowOpen = rezWindowsOn && rezWindow !== null && !passedRezWindows.includes(rezWindow.key);
  const acting = actingSide(gameState, rezWindowOpen);
  const viewer: Viewer = humanSide
    ? viewMode === 'open' || gameState.winner
      ? 'both'
      : humanSide
    : viewMode === 'open'
      ? 'both'
      : viewMode === 'hotseat'
        ? gameState.winner
          ? 'both'
          : hotseatSide
        : viewMode;
  const handoffTo = !aiSide && viewMode === 'hotseat' && acting && acting !== hotseatSide ? acting : null;
  const corpCanAct = canActAs(viewer, 'corp') && aiSide !== 'corp';
  const runnerCanAct = canActAs(viewer, 'runner') && aiSide !== 'runner' && !rezWindowOpen;
  const aiThinking = aiSide !== null && acting === aiSide;

  useEffect(() => {
    if (aiSide) return; // the AI game's view choice doesn't replace the two-player default
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // Not saved; the choice still applies to this game
    }
  }, [viewMode, aiSide]);

  // Save after every move so a reload (the browser discarding a background
  // tab, or the dev server reconnecting) resumes this game; a finished game is dropped
  useEffect(() => {
    if (gameState.winner) clearSavedGame();
    else saveGame({ config, state: gameState, table: { runSerial, passedRezWindows, hotseatSide, accessed } });
  }, [config, gameState, runSerial, passedRezWindows, hotseatSide, accessed]);

  // Watch every state change (the person's moves and the computer's) for steals, scores and trashes
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = gameState;
    if (prev === gameState) return;
    const found = cardFates(prev, gameState);
    if (found.length === 0) return;
    const stamp = Date.now();
    const shown = found.map((f, i) => ({
      ...f,
      key: `${f.card.instanceId}-${stamp}-${i}`,
      canSee: !f.corpSecret || canSeeCorpSecrets(viewer),
    }));
    setFates(cur => [...cur, ...shown]);
    // Not cleared on the next change: each showing ends on its own timer
    const timer = window.setTimeout(() => {
      fateTimersRef.current.delete(timer);
      const keys = new Set(shown.map(f => f.key));
      setFates(cur => cur.filter(f => !keys.has(f.key)));
    }, FATE_SHOW_MS);
    fateTimersRef.current.add(timer);
  }, [gameState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timers = fateTimersRef.current;
    return () => timers.forEach(t => window.clearTimeout(t));
  }, []);

  const handleAction = (action: GameAction) => {
    const current = latestStateRef.current;
    try {
      const nextState = executeAction(current, action);
      latestStateRef.current = nextState;
      if (!current.activeRun && nextState.activeRun) setRunSerial(n => n + 1);
      playForAction(current, nextState);
      const newlyAccessed = nextState.log
        .slice(current.log.length)
        .filter(e => e.event === 'access' && e.cardCode)
        .map(e => ({ code: e.cardCode!, ...(e.secret && { secretFrom: e.secret.from }) }));
      const runStarted = !current.activeRun && nextState.activeRun;
      if (runStarted || newlyAccessed.length > 0) setAccessed(prev => [...(runStarted ? [] : prev), ...newlyAccessed]);
      setGameState(nextState);
      setSelectedCardId(null);
    } catch (err) {
      void showAlert(err instanceof Error ? err.message : 'Illegal action', { title: 'Action blocked' });
    }
  };

  // Before the Corp's turn begins the person stops only if they can rez, score or use something
  useEffect(() => {
    if (aiSide === 'corp' || gameState.winner || gameState.pendingPrompts.length > 0 || gameState.turnStep?.kind !== 'corp_turn_start') return;
    if (getLegalActions(gameState, 'corp').every(a => a.type === 'START_TURN')) handleAction({ type: 'START_TURN', player: 'corp' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  // During a run the person's Runner stops only where they have a choice: approaching ice or
  // the server once the Corp's rez window has closed is skipped when Continue is the only move.
  // (Not on an open table, where the Corp rezzes from the run panel without a window.)
  useEffect(() => {
    const run = gameState.activeRun;
    if (!run || !rezWindowsOn || !runnerCanAct || rezWindowOpen || gameState.winner || gameState.pendingPrompts.length > 0) return;
    if (run.phase !== 'approach_ice' && run.phase !== 'approach_server') return;
    const legal = getLegalActions(gameState, 'runner');
    if (legal.length === 1 && legal[0].type === 'CONTINUE_RUN') handleAction(legal[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, rezWindowOpen]);

  const passRezWindow = (key: string) => setPassedRezWindows(keys => [...keys, key]);

  // The computer thinks in a background worker, then moves after a short pause so its moves can be followed
  useEffect(() => {
    if (!aiSide) return;
    const client = new AIClient(aiSide, config.difficulty);
    aiRef.current = client;
    return () => {
      client.dispose();
      aiRef.current = null;
    };
  }, [aiSide, config.difficulty]);

  useEffect(() => {
    const ai = aiRef.current;
    if (!ai || !aiSide || gameState.winner || acting !== aiSide) return;
    let cancelled = false;
    let timer: number | undefined;
    const started = Date.now();
    const window_ = aiSide === 'corp' && rezWindowOpen ? rezWindow : null;
    // A computer that can't move would leave the game on "AI THINKING" for
    // good, so let the person ask it again or end the game
    const failed = async (problem: string) => {
      console.error('AI failed to move:', problem);
      const retry = await showConfirm(
        `The computer couldn't make its move (${problem}). Ask it to try again, or end the game with the computer conceding?`,
        { title: 'Computer stuck', confirmLabel: 'Try again', cancelLabel: 'Computer concedes' },
      );
      if (cancelled) return;
      if (retry) setAiRetry(n => n + 1);
      else handleAction({ type: 'CONCEDE', player: aiSide });
    };
    const request = window_ ? ai.chooseRez(gameState, window_.cards) : ai.chooseAction(gameState);
    request
      .then(action => {
        if (cancelled) return;
        timer = window.setTimeout(() => {
          if (cancelled) return;
          if (action && !isLegalAction(gameState, action)) void failed(`it chose an illegal ${action.type} move`);
          else if (action) handleAction(action);
          else if (window_) passRezWindow(window_.key);
          else void failed('it found no move');
        }, Math.max(0, AI_DELAY_MS - (Date.now() - started)));
      })
      .catch(err => {
        if (!cancelled) void failed(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, acting, rezWindowOpen, aiRetry]);

  return {
    gameState,
    handleAction,
    selectedCardId,
    setSelectedCardId,
    viewMode,
    setViewMode,
    hotseatSide,
    setHotseatSide,
    accessed,
    clearAccessed: () => setAccessed([]),
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
  };
}
