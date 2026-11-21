import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FastForward, Flag, Hand, LogOut, Menu, Settings, SkipForward, X } from 'lucide-react';
import { AgendaDiamondIcon } from './CreditIcon';
import { StatTumbler } from './StatTumbler';
import { GameState, SideCode } from '../../core';
import { GameConfig } from '../savedGame';
import { ViewMode } from '../viewer';
import { setSoundEnabled, soundEnabled } from '../sound';
import { musicEnabled, setMusicEnabled, musicVolume, setMusicVolume } from '../music';
import { animationsEnabled, setAnimationsEnabled } from '../animations';
import { flipHotseatBoardsEnabled, setFlipHotseatBoardsEnabled } from '../boardFlip';
import { CardSize, isAutoFitOn, savedCardSize, setAutoFit, setCardSize } from '../cardSize';
import { PhaseTracker } from './PhaseTracker';
import { BugReportButton } from './BugReportButton';
import { savedTableFor, liveStateFor } from '../bugReport';
import { PersonStops, STOP_LABELS, nextStops } from '../stops';
import type { OnlineInfo } from '../useOnlineController';
import { AudioFxControls, CardSizeControls, OnlineMarks, ViewModeControl } from './GameSettingsControls';
import { GameMenuDrawer } from './GameMenuDrawer';
import type { ZoneId } from './ZoneViewer';

interface GameHeaderProps {
  state: GameState;
  /** The local game's settings; null online. */
  config: GameConfig | null;
  /** An online game: the room code and connection replace the seed, and there is no view to choose. */
  online?: OnlineInfo | null;
  aiThinking: boolean;
  /** Where this person's game stops for paid ability windows (rules 9.2.7). */
  stops: PersonStops;
  onStops: (level: PersonStops) => void;
  humanSide: SideCode | null;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  concedingSide: SideCode;
  onConcede: () => void;
  onLeave: () => void;
  onOpenZone?: (zone: ZoneId) => void;
}

/** The bar across the top: title, bug report, phase, stops toggle, scores, card size, view, settings, forfeit and leave. */
export function GameHeader({
  state,
  config,
  online = null,
  aiThinking,
  stops,
  onStops,
  humanSide,
  viewMode,
  onViewMode,
  concedingSide,
  onConcede,
  onLeave,
  onOpenZone,
}: GameHeaderProps) {
  const [sound, setSound] = useState(soundEnabled);
  const [music, setMusic] = useState(musicEnabled);
  const [musicVol, setMusicVol] = useState(musicVolume);
  const [animations, setAnimations] = useState(animationsEnabled);
  const [flipHotseatBoards, setFlipHotseatBoards] = useState(flipHotseatBoardsEnabled);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSizeState] = useState(savedCardSize);
  const [autoFit, setAutoFitState] = useState(isAutoFitOn);

  const handleCardSize = (size: CardSize) => {
    setCardSize(size);
    setCardSizeState(size);
  };
  const toggleAutoFit = () => {
    setAutoFit(!autoFit);
    setAutoFitState(!autoFit);
  };
  const handleSoundChange = (nextSound: boolean) => {
    setSoundEnabled(nextSound);
    setSound(nextSound);
  };
  const handleMusicChange = (nextMusic: boolean) => {
    setMusicEnabled(nextMusic);
    setMusic(nextMusic);
  };
  const handleMusicVolChange = (nextVol: number) => {
    setMusicVolume(nextVol);
    setMusicVol(nextVol);
  };
  const handleAnimationsChange = (nextAnim: boolean) => {
    setAnimationsEnabled(nextAnim);
    setAnimations(nextAnim);
  };
  const handleFlipHotseatChange = (nextFlip: boolean) => {
    setFlipHotseatBoardsEnabled(nextFlip);
    setFlipHotseatBoards(nextFlip);
  };
  const showHotseatFlip = !online && !humanSide;

  const aiSide = config?.ai ?? null;
  const ended = !!state.winner || !!online?.over;
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

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  return (
    <header className="h-12 shrink-0 min-w-0 border-b border-slate-800 bg-gradient-to-b from-[#0d121c] to-[#06090e] px-2.5 sm:px-3 gap-2 sm:gap-3 flex items-center justify-between sticky top-0 z-30 shadow-xl relative">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          onClick={onLeave}
          data-testid="home-logo"
          title="Back to deck selection"
          className="font-cyber font-black tracking-wider text-xs 2xl:text-lg whitespace-nowrap hover:brightness-125 transition flex items-center select-none shrink-0"
        >
          <span className="text-cyan-400">STACK</span>
          <span className="text-amber-400 mx-1 font-mono font-normal">//</span>
          <span className="text-pink-500">HEAP</span>
        </button>
        <div className="hidden lg:block">
          <BugReportButton
            screen="game"
            textFrom="xl"
            game={config ? () => ({ config, state: liveStateFor(config.seed) ?? state, table: savedTableFor(config.seed) }) : undefined}
            online={online ? { code: online.code, token: online.token } : undefined}
          />
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            data-testid="stops-toggle"
            onClick={() => onStops(nextStops(stops))}
            className={`shrink-0 text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-[2px] border font-bold whitespace-nowrap ${
              aiThinking
                ? 'border-amber-500 text-amber-300 animate-pulse'
                : stops === 'full'
                  ? 'border-cyan-500 text-cyan-300 hover:bg-cyan-950/40'
                  : stops === 'none'
                  ? 'border-amber-700 text-amber-400 hover:bg-amber-950/40'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
            }`}
            title={STOP_LABELS[stops].title}
            aria-label={`Stops: ${stops}`}
          >
            {aiThinking ? (
              <span data-testid="ai-status">AI THINKING…</span>
            ) : (
              <span className="inline-flex items-center gap-1">
                {stops === 'full' ? <Hand className="w-3 h-3" /> : stops === 'none' ? <SkipForward className="w-3 h-3" /> : <FastForward className="w-3 h-3" />}
                <span className="hidden min-[1800px]:inline">STOPS:</span>
                {STOP_LABELS[stops].short}
              </span>
            )}
          </button>
          <div className="hidden md:block min-w-0 overflow-hidden">
            <PhaseTracker state={state} />
          </div>
          {online ? (
            <OnlineMarks online={online} />
          ) : (
            config && (
              <span
                className="text-[11px] text-slate-500 font-mono whitespace-nowrap truncate min-w-0 shrink-[100] hidden 2xl:inline"
                title={`Open the app with ?seed=${config.seed}&corp=${config.corpDeck.id}&runner=${config.runnerDeck.id}${aiSide ? `&ai=${aiSide}&difficulty=${config.difficulty}` : ''} to replay this deal`}
              >
                SEED {config.seed}
              </span>
            )
          )}
        </div>
      </div>

      {/* Score Board */}
      <div className="flex items-center gap-1.5 sm:gap-2 2xl:gap-3 bg-[#04070c] border border-slate-800/80 rounded-[2px] p-1 shadow-inner shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-cyan-400 font-cyber tracking-wider hidden 2xl:inline">CORP</span>
          <button
            type="button"
            data-testid="header-corp-score"
            onClick={() => onOpenZone?.('corp-score')}
            title="Corp agenda points — browse scored agendas"
            aria-label="Browse Corp score area"
            className="flex items-center whitespace-nowrap h-[26px] bg-gradient-to-b from-cyan-950/90 to-cyan-950/40 border border-cyan-700/80 hover:border-cyan-500 hover:brightness-110 active:translate-y-[1px] px-2 sm:px-2.5 rounded-[2px] text-xs font-bold text-cyan-300 shadow transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
          >
            <AgendaDiamondIcon className="w-3.5 h-3.5 mr-1 sm:mr-1.5 text-cyan-400" /> <StatTumbler value={corp.score} /> / 7
          </button>
        </div>
        <div className="text-slate-600 font-bold text-[10px] uppercase font-mono px-0.5">vs</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="header-runner-score"
            onClick={() => onOpenZone?.('runner-score')}
            title="Runner agenda points — browse stolen agendas"
            aria-label="Browse Runner score area"
            className="flex items-center whitespace-nowrap h-[26px] bg-gradient-to-b from-pink-950/90 to-pink-950/40 border border-pink-700/80 hover:border-pink-500 hover:brightness-110 active:translate-y-[1px] px-2 sm:px-2.5 rounded-[2px] text-xs font-bold text-pink-300 shadow transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pink-400"
          >
            <AgendaDiamondIcon className="w-3.5 h-3.5 mr-1 sm:mr-1.5 text-pink-400" /> <StatTumbler value={runner.score} /> / 7
          </button>
          <span className="text-[11px] font-bold text-pink-400 font-cyber tracking-wider hidden 2xl:inline">RUNNER</span>
        </div>
      </div>

      {/* Mobile Slide-Out Menu Trigger (< lg) */}
      <button
        onClick={() => setMobileMenuOpen(o => !o)}
        aria-expanded={mobileMenuOpen}
        aria-label="Open game menu"
        data-testid="mobile-menu-button"
        className={`lg:hidden p-1.5 rounded-[2px] border border-b-2 active:translate-y-[1px] active:border-b-[1px] transition-all shrink-0 ${
          mobileMenuOpen
            ? 'bg-slate-800 text-cyan-300 border-cyan-500/80 border-b-cyan-400'
            : 'bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/80 border-b-slate-600'
        }`}
        title="Menu & Settings"
      >
        {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
      </button>

      {/* Desktop Card Size & Game Controls (lg+) */}
      <div className="hidden lg:flex items-center gap-2 shrink-0">
        <CardSizeControls
          variant="desktop"
          cardSize={cardSize}
          onCardSize={handleCardSize}
          autoFit={autoFit}
          onToggleAutoFit={toggleAutoFit}
        />

        <ViewModeControl
          variant="desktop"
          online={online}
          hasWinner={!!state.winner}
          humanSide={humanSide}
          viewMode={viewMode}
          onViewMode={onViewMode}
        />

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
              <AudioFxControls
                variant="desktop"
                sound={sound}
                onSoundChange={handleSoundChange}
                music={music}
                onMusicChange={handleMusicChange}
                musicVol={musicVol}
                onMusicVolChange={handleMusicVolChange}
                animations={animations}
                onAnimationsChange={handleAnimationsChange}
                flipHotseatBoards={showHotseatFlip ? flipHotseatBoards : undefined}
                onFlipHotseatBoardsChange={showHotseatFlip ? handleFlipHotseatChange : undefined}
              />
            </div>,
            document.body,
          )}
        {!ended && (
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

      {/* Mobile Slide-Out Drawer Portal */}
      {mobileMenuOpen && (
        <GameMenuDrawer
          state={state}
          config={config}
          online={online}
          ended={ended}
          humanSide={humanSide}
          viewMode={viewMode}
          onViewMode={onViewMode}
          cardSize={cardSize}
          onCardSize={handleCardSize}
          autoFit={autoFit}
          onToggleAutoFit={toggleAutoFit}
          sound={sound}
          onSoundChange={handleSoundChange}
          music={music}
          onMusicChange={handleMusicChange}
          musicVol={musicVol}
          onMusicVolChange={handleMusicVolChange}
          animations={animations}
          onAnimationsChange={handleAnimationsChange}
          flipHotseatBoards={showHotseatFlip ? flipHotseatBoards : undefined}
          onFlipHotseatBoardsChange={showHotseatFlip ? handleFlipHotseatChange : undefined}
          onConcede={onConcede}
          onLeave={onLeave}
          onClose={() => setMobileMenuOpen(false)}
        />
      )}
    </header>
  );
}
