import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flag, LogOut, Settings, ZoomIn } from 'lucide-react';
import { AgendaDiamondIcon } from './CreditIcon';
import { StatTumbler } from './StatTumbler';
import { GameState, SideCode } from '../../core';
import { GameConfig } from '../savedGame';
import { ViewMode } from '../viewer';
import { setSoundEnabled, soundEnabled } from '../sound';
import { musicEnabled, setMusicEnabled, musicVolume, setMusicVolume } from '../music';
import { animationsEnabled, setAnimationsEnabled } from '../animations';
import { CardSize, savedCardSize, setCardSize } from '../cardSize';
import { PhaseTracker } from './PhaseTracker';
import { BugReportButton } from './BugReportButton';
import { savedTableFor } from '../bugReport';

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

/** The bar across the top: title, bug report, phase, AI status, scores, card size, view, settings, forfeit and leave. */
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
  const [music, setMusic] = useState(musicEnabled);
  const [musicVol, setMusicVol] = useState(musicVolume);
  const [animations, setAnimations] = useState(animationsEnabled);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSizeState] = useState(savedCardSize);
  const aiSide = config.ai;
  const { corp, runner } = state;

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && (settingsBtnRef.current?.contains(target) || settingsMenuRef.current?.contains(target))) return;
      setSettingsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsOpen]);

  return (
    <header className="h-12 shrink-0 min-w-0 overflow-x-auto border-b border-slate-800 bg-gradient-to-b from-[#0d121c] to-[#06090e] px-3 gap-3 flex items-center justify-between sticky top-0 z-30 shadow-xl relative">
      <div className="flex items-center gap-3">
        <button
          onClick={onLeave}
          data-testid="home-logo"
          title="Back to deck selection"
          className="font-cyber font-black tracking-wider text-xs 2xl:text-lg whitespace-nowrap hover:brightness-125 transition flex items-center select-none"
        >
          <span className="text-cyan-400">STACK</span>
          <span className="text-amber-400 mx-1 font-mono font-normal">//</span>
          <span className="text-pink-500">HEAP</span>
        </button>
        <BugReportButton
          screen="game"
          textFrom="xl"
          game={() => ({ config, state, table: savedTableFor(config.seed) })}
        />
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
              className={`text-[11px] px-2 py-0.5 rounded-[2px] border font-bold ${
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
      <div className="flex items-center gap-2 2xl:gap-3 bg-[#04070c] border border-slate-800/80 rounded-[2px] p-1 shadow-inner">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-cyan-400 font-cyber tracking-wider hidden 2xl:inline">CORP</span>
          <div
            title="Corp agenda points"
            className="flex items-center whitespace-nowrap h-[26px] bg-gradient-to-b from-cyan-950/90 to-cyan-950/40 border border-cyan-700/80 px-2.5 rounded-[2px] text-xs font-bold text-cyan-300 shadow"
          >
            <AgendaDiamondIcon className="w-3.5 h-3.5 mr-1.5 text-cyan-400" /> <StatTumbler value={corp.score} /> / 7
          </div>
        </div>
        <div className="text-slate-600 font-bold text-[10px] uppercase font-mono px-0.5">vs</div>
        <div className="flex items-center gap-1.5">
          <div
            title="Runner agenda points"
            className="flex items-center whitespace-nowrap h-[26px] bg-gradient-to-b from-pink-950/90 to-pink-950/40 border border-pink-700/80 px-2.5 rounded-[2px] text-xs font-bold text-pink-300 shadow"
          >
            <AgendaDiamondIcon className="w-3.5 h-3.5 mr-1.5 text-pink-400" /> <StatTumbler value={runner.score} /> / 7
          </div>
          <span className="text-[11px] font-bold text-pink-400 font-cyber tracking-wider hidden 2xl:inline">RUNNER</span>
        </div>
      </div>

      {/* Card Size & Game Controls */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-[#05080e] border border-slate-800 rounded-[2px] p-0.5 text-xs h-[26px]" data-testid="card-size">
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
              className={`px-2 py-0.5 rounded-[1px] text-xs transition-colors ${
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
            className="border border-amber-500/60 rounded-[2px] px-2 py-0.5 text-xs text-amber-300 h-[26px] flex items-center"
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
            className="bg-slate-900 border border-slate-800 rounded-[2px] px-2 py-0.5 text-xs text-slate-300 h-[26px]"
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
            className="bg-slate-900 border border-slate-800 rounded-[2px] px-2 py-0.5 text-xs text-slate-300 h-[26px]"
            title="Who is looking at the screen"
          >
            <option value="open">Open table</option>
            <option value="hotseat">Pass and play</option>
            <option value="corp">Corp view</option>
            <option value="runner">Runner view</option>
          </select>
        )}
        <button
          ref={settingsBtnRef}
          onClick={() => setSettingsOpen(o => !o)}
          aria-expanded={settingsOpen}
          aria-haspopup="menu"
          aria-label="Settings"
          className={`p-1.5 rounded-[2px] border border-b-2 active:translate-y-[1px] active:border-b-[1px] transition-all ${
            settingsOpen
              ? 'bg-slate-800 text-white border-cyan-500/80 border-b-cyan-400'
              : 'bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white border-slate-700/80 border-b-slate-600'
          }`}
          title="Settings"
          data-testid="settings-button"
        >
          <Settings className="w-4 h-4" />
        </button>
        {settingsOpen &&
          createPortal(
            <div
              ref={settingsMenuRef}
              role="menu"
              aria-label="Settings"
              data-testid="settings-menu"
              style={(() => {
                const rect = settingsBtnRef.current?.getBoundingClientRect();
                const top = (rect && rect.bottom > 0 ? rect.bottom : 42) + 6;
                const right = rect && rect.right > 0 ? Math.max(8, window.innerWidth - rect.right) : 12;
                return { top, right };
              })()}
              className="fixed z-[100] w-56 bg-[#090d15] border border-slate-700 rounded-[2px] p-3 shadow-2xl font-mono text-xs text-slate-200 space-y-2.5"
            >
              <div className="font-cyber font-bold tracking-wider text-[11px] text-slate-400 border-b border-slate-800 pb-1.5">
                SETTINGS
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none hover:text-white">
                <input
                  type="checkbox"
                  checked={!sound}
                  onChange={e => {
                    const nextSound = !e.target.checked;
                    setSoundEnabled(nextSound);
                    setSound(nextSound);
                  }}
                  className="accent-cyan-400 cursor-pointer"
                  data-testid="setting-mute-audio"
                />
                <span>Mute sound effects</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none hover:text-white">
                <input
                  type="checkbox"
                  checked={!music}
                  onChange={e => {
                    const nextMusic = !e.target.checked;
                    setMusicEnabled(nextMusic);
                    setMusic(nextMusic);
                  }}
                  className="accent-cyan-400 cursor-pointer"
                  data-testid="setting-mute-music"
                />
                <span>Mute music</span>
              </label>
              <div className="pt-0.5 pb-1 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Music volume</span>
                  <span className="font-bold text-cyan-400">{Math.round(musicVol * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={musicVol}
                  disabled={!music}
                  onChange={e => {
                    const nextVol = parseFloat(e.target.value);
                    setMusicVolume(nextVol);
                    setMusicVol(nextVol);
                  }}
                  className="w-full accent-cyan-400 cursor-pointer disabled:opacity-40"
                  data-testid="setting-music-volume"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none hover:text-white border-t border-slate-800/80 pt-1.5">
                <input
                  type="checkbox"
                  checked={!animations}
                  onChange={e => {
                    const nextAnim = !e.target.checked;
                    setAnimationsEnabled(nextAnim);
                    setAnimations(nextAnim);
                  }}
                  className="accent-cyan-400 cursor-pointer"
                  data-testid="setting-disable-animations"
                />
                <span>Disable animations</span>
              </label>
            </div>,
            document.body,
          )}
        {!state.winner && (
          <button
            onClick={onConcede}
            className="p-1.5 bg-gradient-to-b from-pink-950/90 to-pink-950/40 hover:from-pink-900/90 hover:to-pink-900/40 text-pink-300 hover:text-white rounded-[2px] border border-pink-700/80 border-b-2 border-b-pink-500 shadow shadow-pink-950 active:translate-y-[1px] active:border-b-[1px] transition-all"
            title={`Forfeit (the ${concedingSide === 'corp' ? 'Corp' : 'Runner'} concedes)`}
            data-testid="forfeit"
          >
            <Flag className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onLeave}
          className="p-1.5 bg-gradient-to-b from-cyan-950/90 to-cyan-950/40 hover:from-cyan-900/90 hover:to-cyan-900/40 text-cyan-300 hover:text-white rounded-[2px] border border-cyan-700/80 border-b-2 border-b-cyan-500 shadow shadow-cyan-950 active:translate-y-[1px] active:border-b-[1px] transition-all"
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
