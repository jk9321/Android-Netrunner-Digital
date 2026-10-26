import { useState } from 'react';
import { ArrowRight, Award, Flag, LogOut, Volume2, VolumeX, ZoomIn } from 'lucide-react';
import { GameState, SideCode } from '../../core';
import { GameConfig } from '../savedGame';
import { ViewMode } from '../viewer';
import { setSoundEnabled, soundEnabled } from '../sound';
import { PhaseTracker } from './PhaseTracker';

export type CardScale = 'normal' | 'large' | 'huge';

interface GameHeaderProps {
  state: GameState;
  config: GameConfig;
  aiThinking: boolean;
  humanSide: SideCode | null;
  /** May the active player end their turn now? */
  canEndTurn: boolean;
  onEndTurn: () => void;
  cardScale: CardScale;
  onCardScale: (scale: CardScale) => void;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  concedingSide: SideCode;
  onConcede: () => void;
  onLeave: () => void;
}

/** The bar across the top: title, phase, AI status, scores, card size, view, sound, forfeit and leave. */
export function GameHeader({
  state,
  config,
  aiThinking,
  humanSide,
  canEndTurn,
  onEndTurn,
  cardScale,
  onCardScale,
  viewMode,
  onViewMode,
  concedingSide,
  onConcede,
  onLeave,
}: GameHeaderProps) {
  const [sound, setSound] = useState(soundEnabled);
  const aiSide = config.ai;
  const startingTurn = state.turnStep?.kind === 'corp_turn_start';
  const { corp, runner, activePlayer } = state;

  return (
    <header className="h-12 shrink-0 min-w-0 overflow-x-auto border-b border-amber-400/40 bg-slate-950/90 px-3 gap-3 flex items-center justify-between sticky top-0 z-30 shadow-lg">
      <div className="flex items-center gap-3">
        <button
          onClick={onLeave}
          data-testid="home-logo"
          title="Back to deck selection"
          className="font-cyber font-black tracking-wider 2xl:tracking-widest text-xs 2xl:text-lg whitespace-nowrap glitch-title hover:brightness-125 transition"
        >
          NETRUNNER
        </button>
        <div className="flex items-center gap-1.5">
          <div className="hidden sm:block">
            <PhaseTracker state={state} />
          </div>
          <span
            className="text-[10px] text-slate-500 font-mono whitespace-nowrap hidden 2xl:inline"
            title={`Open the app with ?seed=${state.rng.seed}&corp=${config.corpDeck.id}&runner=${config.runnerDeck.id}${aiSide ? `&ai=${aiSide}&difficulty=${config.difficulty}` : ''} to replay this deal`}
          >
            SEED {state.rng.seed}
          </span>
          {aiSide && (
            <span
              data-testid="ai-status"
              className={`text-[10px] px-2 py-0.5 rounded border font-bold ${
                aiThinking ? 'border-amber-500 text-amber-300 animate-pulse' : 'border-slate-700 text-slate-500'
              }`}
              title={`The computer plays the ${aiSide === 'corp' ? 'Corp' : 'Runner'}`}
            >
              {aiThinking ? 'AI THINKING…' : `AI: ${aiSide.toUpperCase()}${config.difficulty === 'hard' ? ' (HARD)' : ''}`}
            </span>
          )}
          {/* Quick Sticky End Turn Button */}
          <button
            onClick={onEndTurn}
            disabled={!canEndTurn}
            className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all shadow flex items-center gap-1 whitespace-nowrap disabled:opacity-40 ${
              activePlayer === 'corp'
                ? 'bg-cyan-700 hover:bg-cyan-600 text-white border-cyan-500 shadow-cyan-950'
                : 'bg-pink-700 hover:bg-pink-600 text-white border-pink-500 shadow-pink-950'
            }`}
            title={
              startingTurn
                ? 'Rez assets or upgrades first if you want them working this turn, then take the mandatory draw'
                : `End ${activePlayer.toUpperCase()}'s turn`
            }
          >
            {startingTurn ? 'Draw & Start' : 'End Turn'} <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Score Board */}
      <div className="flex items-center gap-3 2xl:gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-cyan-400 hidden 2xl:inline">CORP</span>
          <div title="Corp agenda points" className="flex items-center whitespace-nowrap bg-cyan-950/60 border border-cyan-800 px-2.5 py-0.5 rounded-full text-xs font-bold text-cyan-300">
            <Award className="w-3.5 h-3.5 mr-1 text-cyan-400" /> {corp.score} / 7
          </div>
        </div>
        <div className="text-slate-600 font-bold text-xs hidden 2xl:block">vs</div>
        <div className="flex items-center gap-2">
          <div title="Runner agenda points" className="flex items-center whitespace-nowrap bg-pink-950/60 border border-pink-800 px-2.5 py-0.5 rounded-full text-xs font-bold text-pink-300">
            <Award className="w-3.5 h-3.5 mr-1 text-pink-400" /> {runner.score} / 7
          </div>
          <span className="text-xs font-bold text-pink-400 hidden 2xl:inline">RUNNER</span>
        </div>
      </div>

      {/* Card Zoom & Game Controls */}
      <div className="flex items-center gap-2">
        {/* Card Size Selector */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
          <span className="px-2 text-[10px] text-slate-500 font-bold uppercase hidden 2xl:inline-flex items-center gap-1">
            <ZoomIn className="w-3 h-3" /> Size:
          </span>
          {SCALES.map(({ scale, label, active }) => (
            <button
              key={scale}
              onClick={() => onCardScale(scale)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                cardScale === scale ? `${active} text-white font-bold` : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {humanSide ? (
          <select
            value={viewMode === 'open' ? 'open' : humanSide}
            onChange={(e) => onViewMode(e.target.value as ViewMode)}
            aria-label="View"
            data-testid="view-mode"
            className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300"
            title="Open table also shows the computer's hand"
          >
            <option value={humanSide}>My view ({humanSide === 'corp' ? 'Corp' : 'Runner'})</option>
            <option value="open">Open table</option>
          </select>
        ) : (
          <select
            value={viewMode}
            onChange={(e) => onViewMode(e.target.value as ViewMode)}
            aria-label="View"
            data-testid="view-mode"
            className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300"
            title="Who is looking at the screen"
          >
            <option value="open">Open table</option>
            <option value="hotseat">Pass and play</option>
            <option value="corp">Corp view</option>
            <option value="runner">Runner view</option>
          </select>
        )}
        <button
          onClick={() => {
            setSoundEnabled(!sound);
            setSound(!sound);
          }}
          className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg border border-slate-800 transition-colors"
          title={sound ? 'Mute sound' : 'Turn sound on'}
          data-testid="sound-toggle"
        >
          {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        {!state.winner && (
          <button
            onClick={onConcede}
            className="p-2 bg-slate-900 hover:bg-red-950 text-slate-400 hover:text-red-300 rounded-lg border border-slate-800 hover:border-red-800 transition-colors"
            title={`Forfeit (the ${concedingSide === 'corp' ? 'Corp' : 'Runner'} concedes)`}
            data-testid="forfeit"
          >
            <Flag className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onLeave}
          className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg border border-slate-800 transition-colors"
          title="Leave game (back to deck select)"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

const SCALES: { scale: CardScale; label: string; active: string }[] = [
  { scale: 'normal', label: 'Normal', active: 'bg-slate-700' },
  { scale: 'large', label: 'Large', active: 'bg-cyan-600' },
  { scale: 'huge', label: 'Huge', active: 'bg-cyber-neonPink' },
];

/** Card size multiplier for the board (--card-scale). */
export const cardScaleValue = (scale: CardScale): number => (scale === 'huge' ? 1.4 : scale === 'large' ? 1.2 : 1);
