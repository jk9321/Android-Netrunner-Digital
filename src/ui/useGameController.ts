import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GameAction, GameState, LogEntry, SideCode, StopLevel, isHidden } from '../core';
import { PersonStops, saveStops, savedStops } from './stops';
import { AIClient } from '../ai/client';
import { deckGameSetup } from '../data/decks';
import { AccessedCard, GameConfig, SavedGame, clearSavedGame, saveGame } from './savedGame';
import { noteMoves, noteState } from './bugReport';
import { ShownFate } from './components/CardFates';
import { cardFates } from './cardFates';
import { showAlert, showConfirm } from './components/Dialog';
import { ViewMode, Viewer, canActAs, corpRezWindow } from './viewer';
import { playForAction } from './sound';
import { VIEW_MODE_KEY, savedViewMode } from './gameStart';
import { LocalTable, TableMove, newTableState } from './table';

const AI_DELAY_MS = 650;
/** How long a stolen, scored or trashed card stays in the middle of the table. */
const FATE_SHOW_MS = 1300;

/** The game's stops: the computer's side where it always stops, the person's side(s) as they chose. */
function withStops(state: GameState, aiSide: SideCode | null | undefined, level: PersonStops): GameState {
  const want = (side: SideCode): StopLevel => (side === aiSide ? 'ai' : level);
  if (state.stops?.corp === want('corp') && state.stops?.runner === want('runner')) return state;
  return { ...state, stops: { corp: want('corp'), runner: want('runner') } };
}

type Accessed = Record<Viewer, AccessedCard[]>;
const VIEWERS: Viewer[] = ['corp', 'runner', 'both'];
const noAccesses = (): Accessed => ({ corp: [], runner: [], both: [] });

/** Accesses in a viewer's log since the last move (an access they may not see has no code). */
function newAccesses(prev: GameState, next: GameState): AccessedCard[] {
  const seen = new Set(prev.log.map(e => e.id));
  return next.log
    .filter((e: LogEntry) => !seen.has(e.id) && e.event === 'access')
    .map(e => (e.cardCode ? { code: e.cardCode } : {}));
}

/**
 * One game and the rules of the table around it: who is looking and who may
 * act, Corp rez windows, the computer's moves, saving after every move, and
 * the brief showings of stolen, scored and trashed cards. The game itself
 * lives in a LocalTable (table.ts); the screen gets the viewer's seat, whose
 * state holds only what that viewer may see.
 */
export function useGameController(config: GameConfig, saved: SavedGame | null) {
  // Where the person's game stops for paid ability windows; the computer stops where it always has
  const [stops, setStopsState] = useState<PersonStops>(savedStops);
  const aiSide = config.ai;
  const [table] = useState(
    () =>
      new LocalTable(
        withStops(saved?.state ?? newTableState(deckGameSetup(config.seed, config.corpDeck, config.runnerDeck)), aiSide, stops),
        aiSide,
        {
          confirm: (message, options) => showConfirm(message, options),
          alert: (message, options) => void showAlert(message, options),
        },
        { moves: saved?.table.moves, ids: saved?.table.ids },
      ),
  );
  // Re-render on every change at the table
  const [subscribe] = useState(() => (fn: () => void) => table.subscribe(fn));
  const version = useSyncExternalStore(subscribe, () => table.version);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Who is looking. Pass and play shows one side at a time and hands over
  // (behind a cover screen) whenever the other side has to act.
  // Against the computer a game starts in the person's own view (Open table is
  // still in the menu); two-player games start in the last mode used.
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    config.ai === 'corp' ? 'runner' : config.ai === 'runner' ? 'corp' : savedViewMode(),
  );
  const [hotseatSide, setHotseatSide] = useState<SideCode>(saved?.table.hotseatSide ?? 'corp');
  // Cards the Runner accessed in the latest run, as each viewer saw them, shown until dismissed or the next run
  const [accessed, setAccessed] = useState<Accessed>(() => saved?.table.accessed ?? noAccesses());
  // Cards just stolen, scored or trashed, shown briefly in the middle of the table
  const [fates, setFates] = useState<ShownFate[]>([]);
  // Timers that end each card-fate showing, cleared if the game is left
  const fateTimersRef = useRef(new Set<number>());
  const startStops = useRef(saved ? saved.table.startStops : table.state.stops).current;
  noteMoves(config.seed, table.moves, startStops);
  // Bumped to ask the computer again after it failed to move
  const [aiRetry, setAiRetry] = useState(0);

  // Against the computer: the AI plays one side and the person sees their own
  // side (or everything, with Open table).
  const humanSide: SideCode | null = aiSide === 'corp' ? 'runner' : aiSide === 'runner' ? 'corp' : null;
  const aiRef = useRef<AIClient | null>(null);

  const acting = table.acting;
  const winner = table.winner;
  const handoffTo = !aiSide && viewMode === 'hotseat' && acting && acting !== hotseatSide ? acting : null;
  // Once the game is over nothing is secret any more, so everyone sees the open table. In pass and play
  // the table under the hand-off cover already holds only the next side's view.
  const viewer: Viewer =
    winner || viewMode === 'open'
      ? 'both'
      : humanSide
        ? humanSide
        : viewMode === 'hotseat'
          ? (handoffTo ?? hotseatSide)
          : viewMode;
  const seat = table.seatFor(viewer);
  const gameState = seat.state;
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;

  // The Corp's priority in a paid ability window during a run: what it can rez there
  const rezWindow = corpRezWindow(seat);
  const rezWindowOpen = rezWindow !== null;
  // Nobody acts once the game is over (rule 1.7.1: the game ends when a player wins)
  const corpCanAct = !winner && canActAs(viewer, 'corp') && aiSide !== 'corp';
  const runnerCanAct = !winner && canActAs(viewer, 'runner') && aiSide !== 'runner';
  const aiThinking = aiSide !== null && acting === aiSide;
  // The side hearing the game's sounds, for the win or lose sound at the end:
  // the person against the computer, the side in view in two-player games
  // (in pass and play, whoever has the device), nobody in particular on an open table
  const listener: SideCode | null =
    humanSide ?? (viewMode === 'hotseat' ? hotseatSide : viewMode === 'corp' || viewMode === 'runner' ? viewMode : null);
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (aiSide) return; // the AI game's view choice doesn't replace the two-player default
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // Not saved; the choice still applies to this game
    }
  }, [viewMode, aiSide]);

  // A selection is in the viewer's ids, and a card fate was worked out from the last viewer's view:
  // neither belongs on the next viewer's screen
  useEffect(() => {
    setSelectedCardId(null);
    setFates([]);
    fateTimersRef.current.forEach(t => window.clearTimeout(t));
    fateTimersRef.current.clear();
  }, [viewer]);

  // The bug report sends the real state (the screen has only the viewer's view of it); noted after every
  // change at the table, not while rendering
  useEffect(() => {
    noteState(config.seed, table.state);
  }, [config.seed, table, version]);

  // Save after every move so a reload (the browser discarding a background
  // tab, or the dev server reconnecting) resumes this game; a finished game is dropped
  useEffect(() => {
    if (table.state.winner) clearSavedGame();
    else
      saveGame({
        config,
        state: table.state,
        table: { runSerial: 0, passedRezWindows: [], hotseatSide, accessed, moves: table.moves, startStops, ids: table.ids },
      });
  }, [config, version, hotseatSide, accessed, startStops, table]);

  // Every committed move: sounds, accesses, the brief showings of steals, scores and trashes, and the selection.
  // Each comes from the viewer's own before-and-after (their reconstructions), so nothing hidden from them shows.
  useEffect(
    () =>
      table.onMove((move: TableMove) => {
        noteMoves(config.seed, table.moves, startStops);
        const who = viewerRef.current;
        const hearing = listenerRef.current;
        playForAction(move.prev[hearing ?? 'both'], move.next[hearing ?? 'both'], hearing);
        setAccessed(cur => {
          const res = { ...cur };
          for (const v of VIEWERS) {
            const prev = move.prev[v];
            const next = move.next[v];
            const runStarted = !prev.activeRun && next.activeRun;
            const found = newAccesses(prev, next);
            if (runStarted || found.length > 0) res[v] = [...(runStarted ? [] : cur[v]), ...found];
          }
          return res;
        });
        showFates(move.prev[who], move.next[who]);
        // Keep the selected card across actions that leave it in hand (gaining credits, drawing),
        // so the player can afford it and then play it; drop it once it leaves hand or the turn passes.
        const prev = move.prev[who];
        const next = move.next[who];
        setSelectedCardId(id => {
          if (!id || next.turnNumber !== prev.turnNumber || next.activePlayer !== prev.activePlayer) return null;
          return [...next.corp.hq, ...next.runner.grip].some(c => c.instanceId === id) ? id : null;
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table],
  );

  const showFates = (prev: GameState, next: GameState) => {
    const found = cardFates(prev, next);
    if (found.length === 0) return;
    const stamp = Date.now();
    const shown = found.map((f, i) => ({ ...f, key: `${f.card.instanceId}-${stamp}-${i}`, canSee: !isHidden(f.card) }));
    setFates(cur => [...cur, ...shown]);
    // Not cleared on the next change: each showing ends on its own timer
    const timer = window.setTimeout(() => {
      fateTimersRef.current.delete(timer);
      const keys = new Set(shown.map(f => f.key));
      setFates(cur => cur.filter(f => !keys.has(f.key)));
    }, FATE_SHOW_MS);
    fateTimersRef.current.add(timer);
  };

  useEffect(() => {
    const timers = fateTimersRef.current;
    return () => timers.forEach(t => window.clearTimeout(t));
  }, []);

  // Before the Corp's turn begins the person stops only if they can rez, score or use something
  useEffect(() => {
    if (aiSide === 'corp' || table.winner) return;
    const corp = table.seatFor('corp');
    const s = corp.state;
    if (s.pendingPrompts.length > 0 || s.turnStep?.kind !== 'corp_turn_start') return;
    if (corp.legal.length > 0 && corp.legal.every(a => a.type === 'START_TURN')) void corp.act({ type: 'START_TURN', player: 'corp' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // During a run the person's Runner stops only where they have a choice (with auto-skip): approaching
  // ice or the server, or the run's other windows, is skipped when Continue is the only move.
  useEffect(() => {
    if (stops === 'full' || !runnerCanAct || handoffTo || table.winner || table.acting !== 'runner') return;
    const runner = table.seatFor('runner');
    const s = runner.state;
    const run = s.activeRun;
    if (!run || s.pendingPrompts.length > 0) return;
    if (run.phase === 'encounter_ice' || (run.phase === 'movement' && !s.priority)) return;
    if (runner.legal.length === 1 && runner.legal[0].type === 'CONTINUE_RUN') void runner.act(runner.legal[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Pass priority in the window the person holds (the run panel's Don't rez, the window bar's Pass)
  const passWindow = (side: SideCode, restOfRun = false) => seat.act({ type: 'PASS', player: side, ...(restOfRun && { restOfRun }) });

  // The person's choice of stops applies to their side(s) at once, and to later games
  const setStops = (level: PersonStops) => {
    setStopsState(level);
    saveStops(level);
    const sides: SideCode[] = aiSide ? [aiSide === 'corp' ? 'runner' : 'corp'] : ['corp', 'runner'];
    for (const side of sides) void table.apply({ type: 'SET_STOPS', player: side, level });
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
    if (!ai || !aiSide) return;
    const ask = table.askComputer(ai);
    if (!ask) return;
    let cancelled = false;
    let timer: number | undefined;
    const started = Date.now();
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
      else void table.apply({ type: 'CONCEDE', player: aiSide });
    };
    ask.request
      .then(action => {
        if (cancelled) return;
        timer = window.setTimeout(() => {
          if (cancelled) return;
          const res = ask.apply(action);
          if (res === 'illegal') void failed(`it chose an illegal ${action?.type} move`);
          else if (res === 'none') void failed('it found no move');
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
  }, [version, aiRetry]);

  return {
    // What the table shows this viewer: their seat's state (with a held choice, the action applied and its choice open)
    seat,
    gameState,
    handleAction: (action: GameAction) => seat.act(action),
    cancelChoice: seat.cancel,
    selectedCardId,
    setSelectedCardId,
    viewMode,
    setViewMode,
    hotseatSide,
    setHotseatSide,
    accessed: accessed[viewer],
    clearAccessed: () => setAccessed(cur => ({ ...cur, [viewer]: [] })),
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
