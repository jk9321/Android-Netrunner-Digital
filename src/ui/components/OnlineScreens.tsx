import { useState } from 'react';
import { Check, Copy, Loader2, RefreshCw, Smartphone, WifiOff } from 'lucide-react';
import type { OnlineStatus } from '../../net/client';
import { inviteLink } from '../../net/lobby';
import { displayRoomCode } from '../../net/protocol';

const panel = 'w-full max-w-md bg-[#090d15] border border-slate-700 rounded-[2px] shadow-2xl p-6 text-center space-y-4';
const primary =
  'px-6 py-2.5 bg-gradient-to-b from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-bold rounded-[2px] border-b-2 border-amber-700 text-sm inline-flex items-center justify-center gap-2 active:translate-y-[1px] active:border-b-[1px]';
const secondary =
  'px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold rounded-[2px] border border-slate-700 border-b-2 border-b-slate-600 text-sm inline-flex items-center justify-center gap-2 active:translate-y-[1px] active:border-b-[1px]';

function Title() {
  return (
    <h1 className="font-cyber font-black tracking-wider text-2xl sm:text-3xl select-none mb-6">
      <span className="text-cyan-400">STACK</span>
      <span className="text-amber-400 mx-1.5 font-mono font-normal">//</span>
      <span className="text-pink-500">HEAP</span>
    </h1>
  );
}

/**
 * The host's screen until the second player joins: the code, the invite link
 * with Copy link, and Cancel (the room expires on its own). The game starts
 * by itself when its first state arrives.
 */
export function WaitingRoom({ code, connected, onCancel }: { code: string; connected: boolean; onCancel: () => void }) {
  const link = inviteLink(code);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  };
  return (
    <div className="min-h-screen text-slate-100 font-mono flex flex-col items-center px-4 py-10" data-testid="waiting-room">
      <Title />
      <div className={panel}>
        <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Game code</p>
        <p className="font-cyber font-black text-4xl tracking-[0.2em] text-amber-300 select-all" data-testid="room-code">
          {displayRoomCode(code)}
        </p>
        <p className="text-xs text-slate-400">Send your opponent this link, or the code to type in under Play online, Join with a code.</p>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            value={link}
            aria-label="Invite link"
            onFocus={e => e.currentTarget.select()}
            className="flex-1 min-w-0 bg-[#05080e] border border-slate-700 rounded-[2px] px-2 py-1.5 text-xs text-slate-200"
            data-testid="invite-link"
          />
          <button type="button" onClick={copy} className={secondary} data-testid="copy-link">
            {copied === 'yes' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied === 'yes' ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {copied === 'no' && <p className="text-xs text-amber-400">This browser would not copy the link: select it and copy it by hand.</p>}
        <p className="text-sm text-slate-200 flex items-center justify-center gap-2" data-testid="waiting-for-opponent">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
          {connected ? 'Waiting for opponent' : 'Connecting to the game…'}
        </p>
        <p className="text-[12px] text-slate-500">The game starts by itself when they join.</p>
        <button type="button" onClick={onCancel} className={secondary} data-testid="cancel-host">
          Cancel
        </button>
      </div>
    </div>
  );
}

const NOTICES: Record<'replaced' | 'gone' | 'refresh', { title: string; text: string }> = {
  replaced: { title: 'This game is open somewhere else', text: 'You opened this game in another tab or on another device. Only one place can play it at a time.' },
  gone: { title: 'This game no longer exists', text: 'The game has ended or expired.' },
  refresh: { title: 'A new version is available', text: 'The game has been updated. Refresh the page to keep playing.' },
};

/** Shown instead of the table when the seat is taken elsewhere, the room is gone, or the page must be refreshed. */
export function OnlineNotice({ status, onTakeOver, onLeave }: { status: Extract<OnlineStatus, 'replaced' | 'gone' | 'refresh'>; onTakeOver: () => void; onLeave: () => void }) {
  const n = NOTICES[status];
  return (
    <div className="min-h-screen text-slate-100 font-mono flex flex-col items-center px-4 py-10" data-testid={`online-${status}`}>
      <Title />
      <div className={panel}>
        <div className="flex justify-center text-amber-300">
          {status === 'replaced' ? <Smartphone className="w-8 h-8" /> : status === 'gone' ? <WifiOff className="w-8 h-8" /> : <RefreshCw className="w-8 h-8" />}
        </div>
        <h2 className="font-cyber font-bold text-lg text-amber-300">{n.title}</h2>
        <p className="text-sm text-slate-300">{n.text}</p>
        <div className="flex flex-col items-center gap-2">
          {status === 'replaced' && (
            <button type="button" onClick={onTakeOver} className={primary} data-testid="play-here">
              Play here instead
            </button>
          )}
          {status === 'refresh' && (
            <button type="button" onClick={() => window.location.reload()} className={primary} data-testid="refresh-page">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          )}
          {status !== 'refresh' && (
            <button type="button" onClick={onLeave} className={secondary} data-testid="back-to-start">
              Back to the start screen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
