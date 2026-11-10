import { useEffect, useRef, useState } from 'react';
import { GameAction, GameState, LogEntry, isHidden } from '../core';
import type { AccessedCard } from './savedGame';
import type { Seat } from './seatLegality';
import { ShownFate } from './components/CardFates';
import { cardFates } from './cardFates';

/**
 * What the local game controller (useGameController) and the online one
 * (useOnlineController) share: the accessed-cards panel, the brief showings
 * of stolen, scored and trashed cards, the selection across moves, and the
 * automatic answers sent on the person's behalf. Everything here works on
 * one viewer's before-and-after reconstructions, so nothing hidden from
 * that viewer shows.
 */

/** How long a stolen, scored or trashed card stays in the middle of the table. */
export const FATE_SHOW_MS = 1300;

/** Accesses in a viewer's log since the last move (an access they may not see has no code). */
export function newAccesses(prev: GameState, next: GameState): AccessedCard[] {
  const seen = new Set(prev.log.map(e => e.id));
  return next.log
    .filter((e: LogEntry) => !seen.has(e.id) && e.event === 'access')
    .map(e => (e.cardCode ? { code: e.cardCode } : {}));
}

/** The accessed-cards panel after a move: a new run starts it afresh; null when nothing changed. */
export function nextAccessed(cur: AccessedCard[], prev: GameState, next: GameState): AccessedCard[] | null {
  const runStarted = !prev.activeRun && !!next.activeRun;
  const found = newAccesses(prev, next);
  if (!runStarted && found.length === 0) return null;
  return [...(runStarted ? [] : cur), ...found];
}

/**
 * Keep the selected card across actions that leave it in hand (gaining
 * credits, drawing), so the player can afford it and then play it; drop it
 * once it leaves hand or the turn passes.
 */
export function nextSelection(id: string | null, prev: GameState, next: GameState): string | null {
  if (!id || next.turnNumber !== prev.turnNumber || next.activePlayer !== prev.activePlayer) return null;
  return [...next.corp.hq, ...next.runner.grip].some(c => c.instanceId === id) ? id : null;
}

/** Cards just stolen, scored or trashed, each shown briefly on its own timer. */
export function useCardFates() {
  const [fates, setFates] = useState<ShownFate[]>([]);
  // Timers that end each showing, cleared if the game is left
  const timersRef = useRef(new Set<number>());

  const showFates = (prev: GameState, next: GameState) => {
    const found = cardFates(prev, next);
    if (found.length === 0) return;
    const stamp = Date.now();
    const shown = found.map((f, i) => ({ ...f, key: `${f.card.instanceId}-${stamp}-${i}`, canSee: !isHidden(f.card) }));
    setFates(cur => [...cur, ...shown]);
    // Not cleared on the next change: each showing ends on its own timer
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      const keys = new Set(shown.map(f => f.key));
      setFates(cur => cur.filter(f => !keys.has(f.key)));
    }, FATE_SHOW_MS);
    timersRef.current.add(timer);
  };

  const clearFates = () => {
    setFates([]);
    timersRef.current.forEach(t => window.clearTimeout(t));
    timersRef.current.clear();
  };

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach(t => window.clearTimeout(t));
  }, []);

  return { fates, showFates, clearFates };
}

/**
 * Before the Corp's turn begins the person stops only if they can rez,
 * score or use something: with START_TURN the only move, it is sent for them.
 */
export function autoStartTurn(corp: Seat): GameAction | null {
  const s = corp.state;
  if (s.pendingPrompts.length > 0 || s.turnStep?.kind !== 'corp_turn_start') return null;
  return corp.legal.length > 0 && corp.legal.every(a => a.type === 'START_TURN') ? { type: 'START_TURN', player: 'corp' } : null;
}

/**
 * During a run the person's Runner stops only where they have a choice (with
 * auto-skip): approaching ice or the server, or the run's other windows, is
 * skipped when Continue is the only move. The caller checks the stops (not
 * at ALL) and that the Runner is the person's to play.
 */
export function autoContinueRun(runner: Seat): GameAction | null {
  const s = runner.state;
  const run = s.activeRun;
  if (!run || s.pendingPrompts.length > 0) return null;
  if (run.phase === 'encounter_ice' || (run.phase === 'movement' && !s.priority)) return null;
  return runner.legal.length === 1 && runner.legal[0].type === 'CONTINUE_RUN' ? runner.legal[0] : null;
}
