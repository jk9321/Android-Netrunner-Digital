import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GameAction, SideCode } from '../core';
import type { Viewer } from './viewer';
import type { OnlineStatus, OnlineTable } from '../net/client';
import { PersonStops, saveStops, savedStops } from './stops';
import type { AccessedCard } from './savedGame';
import { autoContinueRun, autoStartTurn, nextAccessed, nextSelection, useCardFates } from './controllerShared';
import { corpRezWindow } from './viewer';
import type { GameController } from './useGameController';
import { playForAction } from './sound';

/** What the game screen shows only online: the room, the connection and the opponent. */
export interface OnlineInfo {
  code: string;
  token: string;
  side: SideCode;
  status: OnlineStatus;
  opponentConnected: boolean;
  /** An action is on its way, or the game waits on the opponent. */
  waitingForOpponent: boolean;
  over: { winner: SideCode | null; reason: string } | null;
  takeOver: () => void;
}

const noop = () => {};

/**
 * The online game's controller: the same shape as useGameController, fed by
 * an OnlineTable (src/net/client.ts) instead of a LocalTable. The viewer is
 * the player's own seat until the game ends (then the final table the room
 * sends, chunk 2d): no open table during play, no pass-and-play cover, no
 * computer, no rematch, and nothing of the game kept in the browser (only
 * the session, in the client). The automatic answers the local controller
 * sends on the person's behalf go through the seat (seat.act) here too.
 */
export function useOnlineController(table: OnlineTable): GameController {
  const [subscribe] = useState(() => (fn: () => void) => table.subscribe(fn));
  const version = useSyncExternalStore(subscribe, () => table.version);
  const side = table.side;
  const seat = table.seatFor(side);
  const gameState = seat.state;
  const [stops, setStopsState] = useState<PersonStops>(savedStops);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [accessed, setAccessed] = useState<AccessedCard[]>([]);
  const { fates, showFates, clearFates } = useCardFates();

  const winner = table.winner;
  const over = !!table.over || !!winner;
  const acting = table.acting;
  const corpCanAct = !over && side === 'corp';
  const runnerCanAct = !over && side === 'runner';
  const rezWindow = corpRezWindow(seat);
  // The final table (chunk 2d): once the room sent it, the open table, as a local game opens up at its end
  const viewer: Viewer = table.final ? 'both' : side;

  // The switch to the final table changes every id (the player's view-local ids before, the engine's after):
  // a selection or a card showing from before belongs to the old ids. No sounds, accesses or showings for it.
  useEffect(() => {
    if (viewer !== 'both') return;
    setSelectedCardId(null);
    clearFates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  // Every new state: sounds, accesses, the brief showings and the selection, from the player's own before-and-after
  useEffect(
    () =>
      table.onMove(({ prev, next }) => {
        playForAction(prev, next, side);
        setAccessed(cur => nextAccessed(cur, prev, next) ?? cur);
        showFates(prev, next);
        setSelectedCardId(id => nextSelection(id, prev, next));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table],
  );

  // The person's stops: on the first state, the saved setting is sent once if the room has another
  const stopsSynced = useRef(false);
  useEffect(() => {
    if (stopsSynced.current || table.status !== 'open' || over) return;
    stopsSynced.current = true;
    if (seat.view?.stops?.[side] !== stops) void seat.act({ type: 'SET_STOPS', player: side, level: stops });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // A stops change the room refused (too many too fast, chunk 2e): back to what the room has, not sent again
  useEffect(
    () =>
      table.onStopsRefused(() => {
        const level = table.seatFor(side).view?.stops?.[side];
        if (level === 'auto' || level === 'full' || level === 'none') {
          setStopsState(level);
          saveStops(level);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table],
  );

  const setStops = (level: PersonStops) => {
    setStopsState(level);
    saveStops(level);
    void seat.act({ type: 'SET_STOPS', player: side, level });
  };

  // The automatic answers, as in the local game: the Corp's turn start when it is the only move,
  // and the Runner's Continue where it is the only move (unless the person stops at ALL)
  useEffect(() => {
    if (over || acting !== side || table.waiting || table.status !== 'open') return;
    const auto = side === 'corp' ? autoStartTurn(seat) : stops !== 'full' ? autoContinueRun(seat) : null;
    if (auto) void seat.act(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const passWindow = (s: SideCode, restOfRun = false) => seat.act({ type: 'PASS', player: s, ...(restOfRun && { restOfRun }) });

  const online: OnlineInfo = {
    code: table.session.code,
    token: table.session.token,
    side,
    status: table.status,
    opponentConnected: table.opponentConnected,
    waitingForOpponent: !over && (table.waiting || (acting !== null && acting !== side)),
    over: table.over,
    takeOver: () => table.takeOver(),
  };

  return {
    seat,
    gameState,
    handleAction: (action: GameAction) => seat.act(action),
    cancelChoice: seat.cancel,
    selectedCardId,
    setSelectedCardId,
    viewMode: side,
    setViewMode: noop,
    hotseatSide: side,
    setHotseatSide: noop,
    accessed,
    clearAccessed: () => setAccessed([]),
    fates,
    aiSide: null,
    humanSide: side,
    rezWindow,
    rezWindowOpen: rezWindow !== null,
    passWindow,
    stops,
    setStops,
    viewer,
    handoffTo: null,
    corpCanAct,
    runnerCanAct,
    aiThinking: false,
    online,
  };
}
