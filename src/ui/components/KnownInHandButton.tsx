import React from 'react';
import { Eye } from 'lucide-react';

/**
 * Opens the list of cards seen in the opponent's hand (revealed or accessed
 * there). Hidden while nothing is known, so a long reveal never
 * crowds the board.
 */
export const KnownInHandButton: React.FC<{ count: number; onOpen: () => void }> = ({ count, onOpen }) =>
  count === 0 ? null : (
    <button
      onClick={onOpen}
      title="Cards you have seen in this hand"
      data-testid="known-in-hand"
      className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-current/40 bg-slate-900/70 hover:bg-slate-800 normal-case tracking-normal font-semibold"
    >
      <Eye className="w-3 h-3" />
      Known ({count})
    </button>
  );
