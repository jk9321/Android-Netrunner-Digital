import React from 'react';
import { GameState, RunPhase } from '../../core/types/state';

const RUN_STEPS: { label: string; phases: RunPhase[] }[] = [
  { label: 'Approach', phases: ['initiation', 'approach_ice'] },
  { label: 'Encounter', phases: ['encounter_ice'] },
  { label: 'Pass', phases: ['movement'] },
  { label: 'Server', phases: ['approach_server'] },
  { label: 'Breach', phases: ['access', 'complete'] },
];

/**
 * Whose turn it is and where it stands: the turn's phases (Corp: draw,
 * action, discard; Runner: action, discard), or during a run its steps,
 * with the current one lit.
 */
export const PhaseTracker: React.FC<{ state: GameState }> = ({ state }) => {
  const { activePlayer: side, activeRun: run, turnStep, turnNumber, winner } = state;
  const corp = side === 'corp';
  const lit = corp ? 'bg-cyan-500 text-black' : 'bg-pink-600 text-white';

  let title: string;
  let steps: string[];
  let current: string;
  if (winner) {
    title = 'Game over';
    steps = [];
    current = '';
  } else if (run) {
    // "Remote 2" rather than "Remote Server 2", so the header fits at 1280px
    title = `Run · ${(state.corp.servers[run.server]?.name ?? run.server).replace('Remote Server', 'Remote')}`;
    steps = RUN_STEPS.map(s => s.label);
    current = RUN_STEPS.find(s => s.phases.includes(run.phase))?.label ?? '';
  } else {
    title = `Turn ${turnNumber} · ${corp ? 'Corp' : 'Runner'}`;
    steps = corp ? ['Draw', 'Action', 'Discard'] : ['Action', 'Discard'];
    current = turnStep?.kind === 'corp_draw' || turnStep?.kind === 'corp_turn_start' ? 'Draw' : turnStep?.kind === 'end_turn' ? 'Discard' : 'Action';
  }

  return (
    <div
      className={`flex items-center gap-1 text-[11px] font-mono font-bold uppercase whitespace-nowrap border rounded px-1.5 py-0.5 bg-slate-900 ${
        corp ? 'border-cyan-800' : 'border-pink-800'
      }`}
      data-testid="phase-tracker"
    >
      <span className={corp ? 'text-cyan-300' : 'text-pink-300'}>{title}</span>
      {steps.map(step => (
        <React.Fragment key={step}>
          <span className="text-slate-600">›</span>
          <span className={`px-1 rounded-sm ${step === current ? lit : 'text-slate-500'}`} aria-current={step === current ? 'step' : undefined}>
            {step}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
};
