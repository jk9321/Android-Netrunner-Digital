import React from 'react';
import { ArrowRight, Hourglass } from 'lucide-react';
import { GameAction, GameState, SideCode } from '../../core';
import { windowLabel } from '../viewer';

interface WindowBarProps {
  state: GameState;
  side: SideCode;
  onAction: (action: GameAction) => void;
}

const sideName = (side: SideCode) => (side === 'corp' ? 'Corp' : 'Runner');

/**
 * A paid ability window outside a run that gives `side` priority (rules
 * 9.2.7): before a turn begins, after discarding, or before the other
 * player's next action. The side may use abilities (the ability bar), rez
 * cards (on the board), or pass. When the side declared an action and the
 * other player has priority first, it says what the game waits for.
 * Windows during a run are in the run panel; the Corp's own window before
 * its turn has its Start turn button.
 */
export const WindowBar: React.FC<WindowBarProps> = ({ state, side, onAction }) => {
  const w = state.priority;
  if (!w || state.activeRun || state.winner || state.pendingPrompts.length > 0) return null;
  if (w.holder !== side) {
    // Our declared action (or end of turn) waits on the other player's priority
    if (!w.intent || w.intent.player !== side) return null;
    return (
      <div className="flex items-center gap-2 text-xs font-mono text-slate-400" data-testid={`window-wait-${side}`}>
        <Hourglass className="w-3.5 h-3.5 animate-pulse" /> Waiting for the {sideName(w.holder)}: they have priority before your {w.intent.type === 'END_TURN' ? 'turn ends' : 'action'}.
      </div>
    );
  }
  if (side === 'corp' && w.step === 'corp_draw') return null;
  // The active player getting priority back in their own action phase just acts
  if (w.holder === state.activePlayer && (w.step === 'corp_action' || w.step === 'runner_action')) return null;
  const accent =
    side === 'corp'
      ? 'border-cyan-700/80 text-cyan-200 bg-cyan-950/60 hover:bg-cyan-900/70'
      : 'border-pink-700/80 text-pink-200 bg-pink-950/60 hover:bg-pink-900/70';
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid={`window-bar-${side}`}>
      <span className={`text-xs font-bold font-mono uppercase ${side === 'corp' ? 'text-cyan-400' : 'text-pink-400'}`}>
        {windowLabel(w.step, w.holder, state.activePlayer)}:
      </span>
      <span className="text-xs text-slate-400">{side === 'corp' ? 'use an ability or rez, then' : 'use an ability, then'}</span>
      <button
        type="button"
        data-testid={`window-pass-${side}`}
        className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-[2px] border ${accent}`}
        onClick={() => onAction({ type: 'PASS', player: side })}
      >
        Pass <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
