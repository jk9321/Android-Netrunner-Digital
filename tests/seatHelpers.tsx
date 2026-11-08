import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameState } from '../src/core';
import { LocalTable, Seat } from '../src/ui/table';
import { SeatContext } from '../src/ui/seat';
import type { Viewer } from '../src/ui/viewer';

const quiet = { confirm: async () => true, alert: () => {} };

/** A seat at a table holding `state`: 'both' gets the real state, a side its reconstruction (src/ui/table.ts). */
export function seatOf(state: GameState, viewer: Viewer): Seat {
  return new LocalTable(state, null, quiet).seatFor(viewer);
}

/** Renders a table component the way the app does: inside the viewer's seat, drawing the seat's state. */
export function renderAs(state: GameState, viewer: Viewer, draw: (seat: Seat) => ReactElement): string {
  const seat = seatOf(state, viewer);
  return renderToStaticMarkup(<SeatContext.Provider value={seat}>{draw(seat)}</SeatContext.Provider>);
}
