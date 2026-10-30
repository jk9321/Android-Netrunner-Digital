import { useState } from 'react';
import { Award, Flag, LogOut, Volume2, VolumeX, ZoomIn } from 'lucide-react';
import { GameState, SideCode } from '../../core';
import { GameConfig } from '../savedGame';
import { ViewMode } from '../viewer';
import { setSoundEnabled, soundEnabled } from '../sound';
import { CardSize, savedCardSize, setCardSize } from '../cardSize';
import { PhaseTracker } from './PhaseTracker';

interface GameHeaderProps {
  state: GameState;
  config: GameConfig;
  aiThinking: boolean;
  humanSide: SideCode | null;
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
  viewMode,
  onViewMode,
  concedingSide,
  onConcede,
  onLeave,
}: GameHeaderProps) {
  const [sound, setSound] = useState(soundEnabled);
  const [cardSize, setCardSizeState] = useState(savedCardSize);
  const aiSide = config.ai;
  const { corp, runner } = state;

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
            className="text-[11px] text-slate-500 font-mono whitespace-nowrap hidden 2xl:inline"
            title={`Open the app with ?seed=${state.rng.seed}&corp=${config.corpDeck.id}&runner=${config.runnerDeck.id}${aiSide ? `&ai=${aiSide}&difficulty=${config.difficulty}` : ''} to replay this deal`}
          >
            SEED {state.rng.seed}
          </span>
          {aiSide && (
            <span
              data-testid="ai-status"
              className={`text-[11px] px-2 py-0.5 rounded border font-bold ${
                aiThinking ? 'border-amber-500 text-amber-300 animate-pulse' : 'border-slate-700 text-slate-500'
              }`}
              title={`The computer plays the ${aiSide === 'corp' ? 'Corp' : 'Runner'}`}
            >
              {aiThinking ? 'AI THINKING…' : `AI: ${aiSide.toUpperCase()}${config.difficulty === 'hard' ? ' (HARD)' : ''}`}
            </span>
          )}
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

      {/* Card Size & Game Controls */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs" data-testid="card-size">
          <span className="px-2 text-[11px] text-slate-500 font-bold uppercase hidden 2xl:inline-flex items-center gap-1">
            <ZoomIn className="w-3 h-3" /> Size:
          </span>
          {SIZES.map(({ size, label, active }) => (
            <button
              key={size}
              onClick={() => {
                setCardSize(size);
                setCardSizeState(size);
              }}
              aria-pressed={cardSize === size}
              title={size === 'large' ? 'Bigger cards on the board (the page may scroll)' : 'Cards sized to fit one screen'}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                cardSize === size ? `${active} text-white font-bold` : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {state.winner ? (
          // The game is over, so both sides' cards are shown and there is no view to choose
          <span
            data-testid="view-mode"
            className="border border-amber-500/60 rounded-lg px-2 py-1 text-xs text-amber-300"
            title="The game is over: both hands, decks, discard piles and face-down cards are shown"
          >
            Open table
          </span>
        ) : humanSide ? (
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
            className="p-2 bg-pink-950/70 hover:bg-pink-800 text-pink-300 hover:text-white rounded-lg border border-pink-600 hover:border-pink-400 shadow shadow-pink-950 transition-colors"
            title={`Forfeit (the ${concedingSide === 'corp' ? 'Corp' : 'Runner'} concedes)`}
            data-testid="forfeit"
          >
            <Flag className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onLeave}
          className="p-2 bg-cyan-950/70 hover:bg-cyan-800 text-cyan-300 hover:text-white rounded-lg border border-cyan-600 hover:border-cyan-400 shadow shadow-cyan-950 transition-colors"
          title="Leave game (back to deck select)"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

const SIZES: { size: CardSize; label: string; active: string }[] = [
  { size: 'normal', label: 'Normal', active: 'bg-slate-700' },
  { size: 'large', label: 'Large', active: 'bg-cyan-600' },
];
