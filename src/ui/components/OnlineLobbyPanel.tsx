import React from 'react';
import { Globe, Loader2, Play, Search } from 'lucide-react';
import { FormatId, SideCode, getFormat } from '../../core';
import { shouldReduceMotion } from '../animations';
import { getCardImageUrl } from '../../data/cards';
import { LobbyFailure } from '../../net/lobby';
import { ONLINE_FORMATS } from '../../net/protocol';
import type { LobbyInfo } from '../../net/protocol';
import {
  FORMAT_HINTS,
  HOST_FORMAT_KEY,
  MODES,
  OPPONENTS,
  OnlineRole,
  Opponent,
  PlayMode,
  SIDE_OFF,
  SIDE_ON,
  choiceClass,
  goClass,
  identityTitle,
  other,
  remember,
  sideName,
} from '../deckPickerUtils';

interface OnlineLobbyPanelProps {
  mode: PlayMode;
  onChooseMode: (id: PlayMode) => void;
  opponent: Exclude<Opponent, 'people'>;
  onChooseOpponent: (id: Exclude<Opponent, 'people'>) => void;
  role: OnlineRole;
  onChooseRole: (id: OnlineRole) => void;
  hostSide: SideCode;
  onHostSide: (side: SideCode) => void;
  hostFormat: FormatId;
  onHostFormat: (format: FormatId) => void;
  codeText: string;
  onCodeTextChange: (text: string) => void;
  lobby: LobbyInfo | null;
  onlineError: LobbyFailure | null;
  busy: 'create' | 'find' | 'join' | null;
  onFindGame: () => void;
  selectedProblemsCount: number;
  hostProblemsCount: number;
  joinProblemsCount: number;
  onStartLocal: () => void;
  onCreateGame: () => void;
  onJoinGame: () => void;
}

/** Play-mode radio selector, contextual settings (AI side / hotseat / online host & join), lobby preview, errors, and primary CTA. */
export const OnlineLobbyPanel: React.FC<OnlineLobbyPanelProps> = ({
  mode,
  onChooseMode,
  opponent,
  onChooseOpponent,
  role,
  onChooseRole,
  hostSide,
  onHostSide,
  hostFormat,
  onHostFormat,
  codeText,
  onCodeTextChange,
  lobby,
  onlineError,
  busy,
  onFindGame,
  selectedProblemsCount,
  hostProblemsCount,
  joinProblemsCount,
  onStartLocal,
  onCreateGame,
  onJoinGame,
}) => (
  <div className="w-full max-w-5xl mb-6 flex flex-col items-center gap-3" data-testid="game-settings">
    {/* 1. How do you want to play? */}
    <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="How do you want to play?">
      {MODES.map(m => (
        <button
          key={m.id}
          role="radio"
          aria-checked={mode === m.id}
          onClick={() => onChooseMode(m.id)}
          title={m.hint}
          data-testid={`mode-${m.id}`}
          className={choiceClass(mode === m.id, 'bg-indigo-600 border-indigo-400 text-white')}
        >
          {m.id === 'online' && <Globe className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />}
          {m.label}
        </button>
      ))}
    </div>

    {/* 2. Contextual settings for that mode */}
    <div
      key={mode === 'online' ? `online-${role}` : mode}
      className={`flex flex-col items-center gap-2.5 ${shouldReduceMotion() ? '' : 'animate-mode-slide'}`}
    >
      {mode === 'computer' && (
        <div className="flex flex-wrap items-center justify-center gap-2" role="radiogroup" aria-label="Your side">
          {OPPONENTS.map(o => (
            <button
              key={o.id}
              role="radio"
              aria-checked={opponent === o.id}
              onClick={() => onChooseOpponent(o.id)}
              title={o.hint}
              data-testid={`opponent-${o.id}`}
              className={choiceClass(opponent === o.id, o.on, o.off)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'hotseat' && (
        <span className="text-xs text-slate-400 text-center">{MODES.find(m => m.id === 'hotseat')!.hint}</span>
      )}

      {mode === 'online' && (
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Host or join">
              <button
                role="radio"
                aria-checked={role === 'host'}
                onClick={() => onChooseRole('host')}
                data-testid="online-host"
                className={choiceClass(role === 'host', 'bg-indigo-600 border-indigo-400 text-white')}
              >
                Host a game
              </button>
              <button
                role="radio"
                aria-checked={role === 'join'}
                onClick={() => onChooseRole('join')}
                data-testid="online-join"
                className={choiceClass(role === 'join', 'bg-indigo-600 border-indigo-400 text-white')}
              >
                Join with a code
              </button>
            </div>
            {role === 'join' && (
              <form
                className="flex items-stretch gap-2"
                onSubmit={e => {
                  e.preventDefault();
                  onFindGame();
                }}
              >
                <input
                  id="join-code"
                  aria-label="Game code"
                  value={codeText}
                  onChange={e => onCodeTextChange(e.target.value)}
                  placeholder="K7QM-2X"
                  maxLength={12}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="join-code"
                  className="w-32 bg-[#05080e] border border-slate-700 rounded-[2px] px-3 py-1.5 text-sm font-bold tracking-[0.2em] uppercase text-amber-200 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={busy === 'find' || codeText.trim().length === 0}
                  data-testid="find-game"
                  className="disabled:opacity-40 px-3 py-1.5 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-xs font-bold flex items-center gap-1"
                >
                  {busy === 'find' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Find game
                </button>
              </form>
            )}
          </div>

          {role === 'host' && (
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5" role="radiogroup" aria-label="Your side">
                <span className="text-xs uppercase tracking-wider text-slate-500 font-bold mr-1">Side:</span>
                {(['corp', 'runner'] as const).map(side => (
                  <button
                    key={side}
                    role="radio"
                    aria-checked={hostSide === side}
                    onClick={() => onHostSide(side)}
                    data-testid={`host-side-${side}`}
                    className={choiceClass(hostSide === side, SIDE_ON[side], SIDE_OFF[side])}
                  >
                    I play {sideName(side)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1.5" role="radiogroup" aria-label="Format">
                <span className="text-xs uppercase tracking-wider text-slate-500 font-bold mr-1">Format:</span>
                {ONLINE_FORMATS.map(f => (
                  <button
                    key={f}
                    role="radio"
                    aria-checked={hostFormat === f}
                    onClick={() => {
                      onHostFormat(f);
                      remember(HOST_FORMAT_KEY, f);
                    }}
                    title={FORMAT_HINTS[f]}
                    data-testid={`host-format-${f}`}
                    className={choiceClass(hostFormat === f, 'bg-sky-700 border-sky-400 text-white')}
                  >
                    {getFormat(f).name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>

    {mode === 'online' && role === 'join' && lobby && (
      <div className="flex items-center gap-3 p-3 rounded-[2px] border border-slate-700 bg-[#080d14]" data-testid="lobby-info">
        <img src={getCardImageUrl(lobby.hostIdentity)} alt="" className="w-14 h-20 object-cover rounded-[2px] border border-slate-700 shrink-0" />
        <div className="text-xs space-y-1">
          <div>
            The host plays the{' '}
            <span className={lobby.hostSide === 'corp' ? 'text-cyan-300 font-bold' : 'text-pink-300 font-bold'}>{sideName(lobby.hostSide)}</span>:{' '}
            <span className="font-bold text-slate-100" data-testid="lobby-identity">
              {identityTitle(lobby.hostIdentity)}
            </span>
          </div>
          <div>
            Format: <span className="font-bold text-sky-300" data-testid="lobby-format">{getFormat(lobby.format).name}</span>
          </div>
          <div>
            You play the{' '}
            <span className={other(lobby.hostSide) === 'corp' ? 'text-cyan-300 font-bold' : 'text-pink-300 font-bold'} data-testid="lobby-your-side">
              {sideName(other(lobby.hostSide))}
            </span>
            . Pick your deck below.
          </div>
        </div>
      </div>
    )}

    {mode === 'online' && onlineError && (
      <div className="text-xs text-pink-300 text-center max-w-md" role="alert" data-testid="online-error">
        <p className="font-bold">{onlineError.message}</p>
        {onlineError.reasons && onlineError.reasons.length > 0 && (
          <ul className="mt-1 text-pink-200/90 list-disc list-inside text-left">
            {onlineError.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
        {onlineError.refresh && (
          <button onClick={() => window.location.reload()} className="mt-2 px-3 py-1 rounded-[2px] bg-amber-500 text-black font-bold" data-testid="lobby-refresh">
            Refresh
          </button>
        )}
      </div>
    )}

    {/* The go button for the mode */}
    <div className="flex flex-col items-center gap-2 mt-1">
      {mode !== 'online' && selectedProblemsCount > 0 && (
        <p className="text-xs text-amber-400 text-center max-w-xs">A selected deck is not legal yet. Fix it in the deckbuilder to play it.</p>
      )}
      {mode !== 'online' && (
        <button
          onClick={onStartLocal}
          disabled={selectedProblemsCount > 0}
          data-testid="start-game"
          className={goClass}
        >
          <Play className="w-4 h-4" /> Start game
        </button>
      )}
      {mode === 'online' && role === 'host' && (
        <>
          {hostProblemsCount > 0 && (
            <p className="text-xs text-amber-400 text-center max-w-xs" data-testid="host-deck-illegal">
              Your deck is not legal in {getFormat(hostFormat).name}. Pick a legal one, or another format.
            </p>
          )}
          <button
            onClick={onCreateGame}
            disabled={hostProblemsCount > 0 || busy !== null}
            data-testid="create-game"
            className={goClass}
          >
            {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Create game
          </button>
        </>
      )}
      {mode === 'online' && role === 'join' && lobby && (
        <>
          {joinProblemsCount > 0 && (
            <p className="text-xs text-amber-400 text-center max-w-xs" data-testid="join-deck-illegal">
              Your deck is not legal in {getFormat(lobby.format).name}. Pick a legal one.
            </p>
          )}
          <button
            onClick={onJoinGame}
            disabled={joinProblemsCount > 0 || busy !== null}
            data-testid="join-game"
            className={goClass}
          >
            {busy === 'join' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Join game
          </button>
        </>
      )}
    </div>
  </div>
);
