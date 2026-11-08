import { createContext, useContext } from 'react';
import type { GameAction, SideCode } from '../core';
import type { Seat } from './table';

/**
 * The viewer's seat at the table (table.ts): components ask it what is legal
 * instead of running the engine on the state they draw, which holds only what
 * the viewer may see.
 */
export const SeatContext = createContext<Seat | null>(null);

export function useSeat(): Seat {
  const seat = useContext(SeatContext);
  if (!seat) throw new Error('No seat: render the table inside <SeatContext.Provider>');
  return seat;
}

/** The seat's legal actions for one side (on the open table the seat has both sides'). */
export const legalFor = (seat: Seat, side: SideCode): GameAction[] => seat.legal.filter(a => a.player === side);
