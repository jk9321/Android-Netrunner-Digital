import { useEffect, useRef, useState } from 'react';
import { GameAction, GameState, SideCode, StopLevel, createInitialGameState, executeAction, getLegalActions, isLegalAction, uncommittedChoice, wantsStop } from '../core';
import { rezCandidates } from '../ai/playout';
import { PersonStops, saveStops, savedStops } from './stops';
import { AIClient } from '../ai/client';
import { deckGameSetup } from '../data/decks';
import { AccessedCard, GameConfig, SavedGame, clearSavedGame, saveGame } from './savedGame';
import { noteMoves } from './bugReport';
import { ShownFate } from './components/CardFates';
import { cardFates } from './cardFates';
import { showAlert, showConfirm } from './components/Dialog';
import { ViewMode, Viewer, actingSide, canActAs, canSeeCorpSecrets, corpRezWindow } from './viewer';
import { playForAction } from './sound';
import { VIEW_MODE_KEY, savedViewMode } from './gameStart';
import { installedCardsGained, installedCardsLost, isInstallAction, replacementMessage } from './installReplacements';

const AI_DELAY_MS = 650;
/** How long a stolen, scored or trashed card stays in the middle of the table. */
const FATE_SHOW_MS = 1300;

/** The game's stops: the computer's side where it always stops, the person's side(s) as they chose. */
function withStops(state: GameState, aiSide: SideCode | null | undefined, level: PersonStops): GameState {
  const want = (side: SideCode): StopLevel => (side === aiSide ? 'ai' : level);
  if (state.stops?.corp === want('corp') && state.stops?.runner === want('runner')) return state;
  return { ...state, stops: { corp: want('corp'), runner: want('runner') } };
}

/**
 * One game's state and the rules of the table around it: who is looking and
 * who may act, Corp rez windows, the computer's moves, saving after every
 * move, and the brief showings of stolen, scored and trashed cards.
 */
export function useGameController(config: GameConfig, saved: SavedGame | null) {
  // Where the person's game stops for paid ability windows; the computer stops where it always has
  const [stops, setStopsState] = useState<PersonStops>(savedStops);
  const [gameState, setGameState] = useState(() =>
    withStops(saved?.state ?? createInitialGameState(deckGameSetup(config.seed, config.corpDeck, config.runnerDeck)), config.ai, stops)
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
  // Every move applied this game, both sides', in order: with the seed and decks they replay it (bug reports)
  const movesRef = useRef<GameAction[]>(saved?.table.moves ?? []);
  const startStops = useRef(saved ? saved.table.startStops : gameState.stops).current;
  noteMoves(config.seed, movesRef.current, startStops);
  // Bumped to ask the computer again after it failed to move
  const [aiRetry, setAiRetry] = useState(0);
  // The person's ability or event whose first step is their own choice (Red Team's server):
  // shown with the choice open, but not applied until they choose, so Cancel can drop it (uncommitted.ts)
  const [held, setHeld] = useState<{ base: GameState; next: GameState; action: GameAction } | null>(null);
  const heldRef = useRef(held);
  heldRef.current = held;

  // Against the computer: the AI plays one side and the person sees their own
  // side (or everything, with Open table).
  const aiSide = config.ai;
  const humanSide: SideCode | null = aiSide === 'corp' ? 'runner' : aiSide === 'runner' ? 'corp' : null;
  const aiRef = useRef<AIClient | null>(null);

  // The Corp's priority in a paid ability window during a run: what it can rez there
  const rezWindow = corpRezWindow(gameState);
  const rezWindowOpen = rezWindow !== null;
  const acting = actingSide(gameState);
  // Once the game is over nothing is secret any more, so everyone sees the open table
  const viewer: Viewer =
    gameState.winner || viewMode === 'open'
      ? 'both'
      : humanSide
        ? humanSide
        : viewMode === 'hotseat'
          ? hotseatSide
          : viewMode;
  const handoffTo = !aiSide && viewMode === 'hotseat' && acting && acting !== hotseatSide ? acting : null;
  // Nobody acts once the game is over (rule 1.7.1: the game ends when a player wins)
  const corpCanAct = !gameState.winner && canActAs(viewer, 'corp') && aiSide !== 'corp';
  const runnerCanAct = !gameState.winner && canActAs(viewer, 'runner') && aiSide !== 'runner';
  const aiThinking = aiSide !== null && acting === aiSide;
  // The side hearing the game's sounds, for the win or lose sound at the end:
  // the person against the computer, the side in view in two-player games
  // (in pass and play, whoever has the device), nobody in particular on an open table
  const listener: SideCode | null =
    humanSide ?? (viewMode === 'hotseat' ? hotseatSide : viewMode === 'corp' || viewMode === 'runner' ? viewMode : null);

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
    else saveGame({ config, state: gameState, table: { runSerial: 0, passedRezWindows: [], hotseatSide, accessed, moves: movesRef.current, startStops } });
  }, [config, gameState, hotseatSide, accessed, startStops]);

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

  const handleAction = async (action: GameAction) => {
    // Answering a held choice applies the action and the answer as one move, from the state before both
    // (Conceding drops a held choice instead)
    const hold = action.type === 'CONCEDE' ? null : heldRef.current;
    const base = hold?.base ?? latestStateRef.current;
    const current = hold?.next ?? base;
    // The game is over (rule 1.7.1): a move still on its way (the computer's, a click) is dropped quietly
    if (current.winner) return;
    try {
      const uncommitted = !hold && action.player !== aiSide ? uncommittedChoice(current, action) : null;
      if (uncommitted) {
        heldRef.current = { base: current, next: uncommitted.next, action };
        setHeld(heldRef.current);
        return;
      }
      const nextState = executeAction(current, action);
      // The person installing over their own cards confirms first, with Cancel as the safe default
      if (action.player !== aiSide && isInstallAction(current, action)) {
        const lost = installedCardsLost(current, nextState, action.player);
        if (lost.length > 0) {
          const ok = await showConfirm(replacementMessage(installedCardsGained(current, nextState, action.player), lost), {
            title: lost.length === 1 ? 'Replace installed card?' : 'Trash installed cards?',
            confirmLabel: 'Trash and install',
            danger: true,
          });
          // Nothing happens if cancelled, or if the game moved on while asking
          if (!ok || latestStateRef.current !== base || heldRef.current !== hold) return;
        }
      }
      latestStateRef.current = nextState;
      movesRef.current = [...movesRef.current, ...(hold ? [hold.action] : []), action];
      noteMoves(config.seed, movesRef.current, startStops);
      heldRef.current = null;
      setHeld(null);
      playForAction(base, nextState, listener);
      const newlyAccessed = nextState.log
        .slice(base.log.length)
        .filter(e => e.event === 'access' && e.cardCode)
        .map(e => ({ code: e.cardCode!, ...(e.secret && { secretFrom: e.secret.from }) }));
      const runStarted = !base.activeRun && nextState.activeRun;
      if (runStarted || newlyAccessed.length > 0) setAccessed(prev => [...(runStarted ? [] : prev), ...newlyAccessed]);
      setGameState(nextState);
      // Keep the selected card across actions that leave it in hand (gaining credits, drawing),
      // so the player can afford it and then play it; drop it once it leaves hand or the turn passes.
      setSelectedCardId(id => {
        if (!id || nextState.turnNumber !== base.turnNumber || nextState.activePlayer !== base.activePlayer) return null;
        return [...nextState.corp.hq, ...nextState.runner.grip].some(c => c.instanceId === id) ? id : null;
      });
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

  // During a run the person's Runner stops only where they have a choice (with auto-skip): approaching
  // ice or the server, or the run's other windows, is skipped when Continue is the only move.
  useEffect(() => {
    const run = gameState.activeRun;
    if (!run || stops === 'full' || !runnerCanAct || acting !== 'runner' || gameState.winner || gameState.pendingPrompts.length > 0) return;
    if (run.phase === 'encounter_ice' || run.phase === 'movement' && !gameState.priority) return;
    const legal = getLegalActions(gameState, 'runner');
    if (legal.length === 1 && legal[0].type === 'CONTINUE_RUN') handleAction(legal[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, acting]);

  // Pass priority in the window the person holds (the run panel's Don't rez, the window bar's Pass)
  const passWindow = (side: SideCode, restOfRun = false) => handleAction({ type: 'PASS', player: side, ...(restOfRun && { restOfRun }) });

  // The person's choice of stops applies to their side(s) at once, and to later games
  const setStops = (level: PersonStops) => {
    setStopsState(level);
    saveStops(level);
    const sides: SideCode[] = aiSide ? [aiSide === 'corp' ? 'runner' : 'corp'] : ['corp', 'runner'];
    for (const side of sides) handleAction({ type: 'SET_STOPS', player: side, level });
  };

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
    // The computer's priority in the person's window (a rez decision, the end of the Corp's turn), or its own move
    const held = gameState.pendingPrompts.length === 0 && gameState.priority?.holder === aiSide && aiSide !== gameState.activePlayer ? gameState.priority : null;
    const asked = held && wantsStop(gameState, aiSide, held) ? held.step : null;
    const pass: GameAction = { type: 'PASS', player: aiSide };
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
    const request: Promise<GameAction | null> = !held
      ? ai.chooseAction(gameState)
      : aiSide === 'corp' && (asked === 'approach_ice' || asked === 'approach_server')
        ? ai.chooseRez(gameState, rezCandidates(gameState, asked))
        : aiSide === 'runner' && asked === 'corp_action'
          ? ai.chooseOffTurn(gameState)
          : Promise.resolve(null);
    request
      .then(action => {
        if (cancelled) return;
        timer = window.setTimeout(() => {
          // The game moved on (or ended) since the computer was asked
          if (cancelled || latestStateRef.current !== gameState) return;
          if (action && !isLegalAction(gameState, action)) void failed(`it chose an illegal ${action.type} move`);
          else if (action) handleAction(action);
          else if (held) handleAction(pass);
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
  }, [gameState, acting, aiRetry]);

  // Dropping a held choice: the action was never applied, so the game is as it was
  const cancelChoice = () => {
    heldRef.current = null;
    setHeld(null);
  };

  return {
    // What the table shows: with a held choice, the action applied and its choice open
    gameState: held?.next ?? gameState,
    handleAction,
    cancelChoice: held ? cancelChoice : undefined,
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
    rezWindow,
    rezWindowOpen,
    passWindow,
    stops,
    setStops,
    viewer,
    handoffTo,
    corpCanAct,
    runnerCanAct,
    aiThinking,
  };
}
