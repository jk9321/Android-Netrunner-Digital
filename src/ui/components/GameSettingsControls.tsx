import { Wifi, WifiOff, ZoomIn } from 'lucide-react';
import { SideCode } from '../../core';
import { displayRoomCode } from '../../net/protocol';
import { CardSize } from '../cardSize';
import type { OnlineInfo } from '../useOnlineController';
import { ViewMode } from '../viewer';

export const SIZES: { size: CardSize; label: string; active: string }[] = [
  { size: 'normal', label: 'Normal', active: 'bg-slate-700' },
  { size: 'large', label: 'Large', active: 'bg-cyan-600' },
];

/**
 * Until a disconnect timer exists (phase 3, audit MP-ABANDON): the player may
 * leave, and the room is deleted 7 days after its last move
 * (server/room.ts IDLE_LIFETIME_MS).
 */
const AWAY_NOTE = 'You can leave: a game is deleted after 7 days without a move.';

/**
 * Online, in place of the seed: the room code, the connection, and what the
 * game is waiting on (the opponent away, or the opponent's move).
 */
export function OnlineMarks({ online, compact = true }: { online: OnlineInfo; compact?: boolean }) {
  const connected = online.status === 'open';
  return (
    <span className={`flex items-center gap-1.5 min-w-0 text-[11px] font-mono ${compact ? 'whitespace-nowrap' : 'flex-wrap'}`} data-testid="online-marks">
      <span
        className={`inline-flex items-center gap-1 ${connected ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}
        title={connected ? 'Connected to the game' : 'Reconnecting to the game…'}
        data-testid="online-connection"
      >
        {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        <span className={compact ? 'hidden 2xl:inline' : ''}>{connected ? 'Online' : 'Reconnecting…'}</span>
      </span>
      <span className={`text-slate-400 ${compact ? 'hidden md:inline' : ''}`} title="The game's code" data-testid="online-code">
        GAME {displayRoomCode(online.code)}
      </span>
      {!online.over && !online.opponentConnected && (
        <span className={`text-amber-300 ${compact ? 'truncate' : ''}`} data-testid="opponent-away" title={`Opponent disconnected, waiting for them to come back. ${AWAY_NOTE}`}>
          Opponent disconnected<span className={compact ? 'hidden xl:inline' : ''}>, waiting for them to come back</span>
          {!compact && <span className="block text-slate-400 whitespace-normal">{AWAY_NOTE}</span>}
        </span>
      )}
      {!online.over && online.opponentConnected && online.waitingForOpponent && (
        <span className={`text-slate-400 truncate animate-pulse ${compact ? 'hidden sm:inline' : ''}`} data-testid="waiting-opponent">
          Waiting for opponent
        </span>
      )}
    </span>
  );
}

interface CardSizeControlsProps {
  variant: 'desktop' | 'mobile';
  cardSize: CardSize;
  onCardSize: (size: CardSize) => void;
  autoFit: boolean;
  onToggleAutoFit: () => void;
}

/** Board card size buttons (Normal / Large) and the Auto fit toggle, shared by desktop bar and mobile drawer. */
export function CardSizeControls({ variant, cardSize, onCardSize, autoFit, onToggleAutoFit }: CardSizeControlsProps) {
  const desktop = variant === 'desktop';
  const buttons = (
    <div
      className={
        desktop
          ? 'flex items-center bg-[#05080e] border border-slate-800 rounded-[2px] p-0.5 text-xs h-[26px]'
          : 'flex items-center bg-[#090d15] border border-slate-800 rounded-[2px] p-0.5'
      }
      data-testid={desktop ? 'card-size' : undefined}
    >
      {desktop && (
        <span className="px-2 text-[11px] text-slate-500 font-bold uppercase hidden 2xl:inline-flex items-center gap-1">
          <ZoomIn className="w-3 h-3" /> Size:
        </span>
      )}
      {SIZES.map(({ size, label, active }) => (
        <button
          key={size}
          onClick={() => onCardSize(size)}
          aria-pressed={cardSize === size}
          title={desktop ? (size === 'large' ? 'Bigger cards on the board (the page may scroll)' : 'Cards sized to fit one screen') : undefined}
          className={`${desktop ? 'px-2 py-0.5' : 'px-2.5 py-1'} rounded-[1px] text-xs transition-colors ${
            cardSize === size ? `${active} text-white font-bold` : 'text-slate-400 hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
      <button
        onClick={onToggleAutoFit}
        aria-pressed={autoFit}
        data-testid={desktop ? 'auto-fit' : undefined}
        title={
          desktop
            ? autoFit
              ? 'Auto fit is on: cards shrink (down to a limit) so the board needs no scrolling'
              : 'Auto fit is off: cards stay at the chosen size'
            : undefined
        }
        className={`ml-0.5 ${desktop ? 'px-2 py-0.5' : 'px-2.5 py-1'} rounded-[1px] text-xs transition-colors ${
          autoFit ? 'bg-emerald-700 text-white font-bold' : 'text-slate-400 hover:text-white'
        }`}
      >
        Auto fit
      </button>
    </div>
  );

  if (desktop) return buttons;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-300 flex items-center gap-1.5">
        <ZoomIn className="w-3.5 h-3.5 text-cyan-400" /> Card size
      </span>
      {buttons}
    </div>
  );
}

interface ViewModeControlProps {
  variant: 'desktop' | 'mobile';
  online: OnlineInfo | null;
  hasWinner: boolean;
  humanSide: SideCode | null;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
}

/** Local table view selector (or "Open table" indicator once the game ends). */
export function ViewModeControl({ variant, online, hasWinner, humanSide, viewMode, onViewMode }: ViewModeControlProps) {
  if (online) return null;
  const desktop = variant === 'desktop';

  const control = hasWinner ? (
    // The game is over, so both sides' cards are shown and there is no view to choose
    <span
      data-testid={desktop ? 'view-mode' : undefined}
      className={
        desktop
          ? 'border border-amber-500/60 rounded-[2px] px-2 py-0.5 text-xs text-amber-300 h-[26px] flex items-center'
          : 'border border-amber-500/60 rounded-[2px] px-2.5 py-1 text-xs text-amber-300'
      }
      title={desktop ? 'The game is over: both hands, decks, discard piles and face-down cards are shown' : undefined}
    >
      Open table
    </span>
  ) : humanSide ? (
    <select
      value={viewMode === 'open' ? 'open' : humanSide}
      onChange={(e) => onViewMode(e.target.value as ViewMode)}
      aria-label={desktop ? 'View' : 'Mobile View'}
      data-testid={desktop ? 'view-mode' : undefined}
      className={
        desktop
          ? 'bg-slate-900 border border-slate-800 rounded-[2px] px-2 py-0.5 text-xs text-slate-300 h-[26px]'
          : 'bg-slate-900 border border-slate-700 rounded-[2px] px-2.5 py-1 text-xs text-slate-200'
      }
      title={desktop ? "Open table also shows the computer's hand" : undefined}
    >
      <option value={humanSide}>My view ({humanSide === 'corp' ? 'Corp' : 'Runner'})</option>
      <option value="open">Open table</option>
    </select>
  ) : (
    <select
      value={viewMode}
      onChange={(e) => onViewMode(e.target.value as ViewMode)}
      aria-label={desktop ? 'View' : 'Mobile View'}
      data-testid={desktop ? 'view-mode' : undefined}
      className={
        desktop
          ? 'bg-slate-900 border border-slate-800 rounded-[2px] px-2 py-0.5 text-xs text-slate-300 h-[26px]'
          : 'bg-slate-900 border border-slate-700 rounded-[2px] px-2.5 py-1 text-xs text-slate-200'
      }
      title={desktop ? 'Who is looking at the screen' : undefined}
    >
      <option value="open">Open table</option>
      <option value="hotseat">Pass and play</option>
      <option value="corp">Corp view</option>
      <option value="runner">Runner view</option>
    </select>
  );

  if (desktop) return control;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-300">Table view</span>
      {control}
    </div>
  );
}

interface AudioFxControlsProps {
  variant: 'desktop' | 'mobile';
  sound: boolean;
  onSoundChange: (enabled: boolean) => void;
  music: boolean;
  onMusicChange: (enabled: boolean) => void;
  musicVol: number;
  onMusicVolChange: (volume: number) => void;
  animations: boolean;
  onAnimationsChange: (enabled: boolean) => void;
  /** Shown in local two-player (hotseat) games: flip boards so the active player sits on the bottom. */
  flipHotseatBoards?: boolean;
  onFlipHotseatBoardsChange?: (enabled: boolean) => void;
}

/** Sound effects, music mute/volume, animation toggle, and hotseat board-flip toggle shared between desktop settings and mobile drawer. */
export function AudioFxControls({
  variant,
  sound,
  onSoundChange,
  music,
  onMusicChange,
  musicVol,
  onMusicVolChange,
  animations,
  onAnimationsChange,
  flipHotseatBoards,
  onFlipHotseatBoardsChange,
}: AudioFxControlsProps) {
  const desktop = variant === 'desktop';
  const labelClass = desktop
    ? 'flex items-center gap-2 cursor-pointer select-none hover:text-white'
    : 'flex items-center gap-2.5 cursor-pointer select-none hover:text-white py-0.5';
  const checkboxClass = desktop ? 'accent-cyan-400 cursor-pointer' : 'accent-cyan-400 cursor-pointer w-4 h-4';

  return (
    <>
      <label className={labelClass}>
        <input
          type="checkbox"
          checked={!sound}
          onChange={e => onSoundChange(!e.target.checked)}
          className={checkboxClass}
          data-testid={desktop ? 'setting-mute-audio' : undefined}
        />
        <span>Mute sound effects</span>
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          checked={!music}
          onChange={e => onMusicChange(!e.target.checked)}
          className={checkboxClass}
          data-testid={desktop ? 'setting-mute-music' : undefined}
        />
        <span>Mute music</span>
      </label>
      <div className={desktop ? 'pt-0.5 pb-1 space-y-1' : 'space-y-1 pt-0.5'}>
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
          onChange={e => onMusicVolChange(parseFloat(e.target.value))}
          className="w-full accent-cyan-400 cursor-pointer disabled:opacity-40"
          data-testid={desktop ? 'setting-music-volume' : undefined}
        />
      </div>
      <label
        className={
          desktop
            ? 'flex items-center gap-2 cursor-pointer select-none hover:text-white border-t border-slate-800/80 pt-1.5'
            : 'flex items-center gap-2.5 cursor-pointer select-none hover:text-white border-t border-slate-800/80 pt-2'
        }
      >
        <input
          type="checkbox"
          checked={!animations}
          onChange={e => onAnimationsChange(!e.target.checked)}
          className={checkboxClass}
          data-testid={desktop ? 'setting-disable-animations' : undefined}
        />
        <span>Disable animations</span>
      </label>
      {flipHotseatBoards !== undefined && onFlipHotseatBoardsChange && (
        <label
          className={labelClass}
          title="Pass & play: put the active player's board on the bottom each turn"
        >
          <input
            type="checkbox"
            checked={flipHotseatBoards}
            onChange={e => onFlipHotseatBoardsChange(e.target.checked)}
            className={checkboxClass}
            data-testid={desktop ? 'setting-flip-hotseat' : undefined}
          />
          <span>Flip boards at turn end</span>
        </label>
      )}
    </>
  );
}
