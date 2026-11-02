import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bug, Check, Send, X } from 'lucide-react';
import { GameForReport, MAX_DESCRIPTION, MIN_DESCRIPTION, ReportScreen, buildReport, sendReport } from '../bugReport';

interface BugReportButtonProps {
  screen: ReportScreen;
  /** The game to attach (deck lists, log, seed, snapshot), read when the report is sent. */
  game?: () => GameForReport | null;
  crash?: { message: string; stack?: string };
  /** Hide the "Report a bug" text below this width; the icon always shows. */
  textFrom?: 'always' | 'xl';
  className?: string;
}

type Status = { kind: 'editing' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

/** The "Report a bug" button and its small form. Shown on every screen next to the title. */
export function BugReportButton({ screen, game, crash, textFrom = 'always', className = '' }: BugReportButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="report-bug"
        title="Report a bug"
        aria-label="Report a bug"
        className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 text-slate-400 hover:text-amber-300 hover:border-amber-500/70 text-[11px] font-bold whitespace-nowrap transition-all active:translate-y-[1px] active:border-b-[1px] ${className}`}
      >
        <Bug className="w-3.5 h-3.5" />
        <span className={textFrom === 'xl' ? 'hidden xl:inline' : ''}>Report a bug</span>
      </button>
      {/* On <body>: the game header is its own stacking context, which would keep the form under the prompt panel */}
      {open && createPortal(<BugReportForm screen={screen} game={game} crash={crash} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function BugReportForm({
  screen,
  game,
  crash,
  onClose,
}: Pick<BugReportButtonProps, 'screen' | 'game' | 'crash'> & { onClose: () => void }) {
  const [text, setText] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'editing' });
  const textRef = useRef<HTMLTextAreaElement>(null);
  const inGame = !!game;

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const length = text.trim().length;
  const tooShort = length < MIN_DESCRIPTION;
  const sending = status.kind === 'sending';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooShort || sending) return;
    setStatus({ kind: 'sending' });
    const payload = await buildReport({ description: text, screen, website, game: game?.() ?? null, crash });
    const error = await sendReport(payload);
    setStatus(error ? { kind: 'error', message: error } : { kind: 'sent' });
  };

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape' && !sending) {
          e.preventDefault();
          onClose();
        }
      }}
      data-testid="bug-report-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
        className="w-full max-w-md bg-slate-950 border-2 border-amber-400 chamfer hud-frame hud-signal shadow-2xl font-mono text-slate-100"
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/80 text-amber-300">
          <Bug className="w-4 h-4 shrink-0" />
          <h2 id="bug-report-title" className="font-cyber font-bold text-xs tracking-[0.2em]">
            REPORT A BUG
          </h2>
          <button type="button" onClick={onClose} disabled={sending} className="ml-auto text-slate-500 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {status.kind === 'sent' ? (
          <div className="px-5 py-5 space-y-4">
            <p className="text-sm flex items-center gap-2" data-testid="bug-report-sent">
              <Check className="w-4 h-4 text-emerald-400" /> Thanks, report sent.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                autoFocus
                className="px-4 py-2 text-xs font-bold border border-amber-400 bg-amber-500 hover:bg-amber-400 text-black"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-4 space-y-3">
            <label htmlFor="bug-report-text" className="block text-xs text-slate-300">
              What went wrong? What did you expect to happen?
            </label>
            <textarea
              id="bug-report-text"
              ref={textRef}
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={MAX_DESCRIPTION}
              rows={5}
              disabled={sending}
              data-testid="bug-report-text"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 resize-y"
            />
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>{tooShort && length > 0 ? `At least ${MIN_DESCRIPTION} characters` : ''}</span>
              <span data-testid="bug-report-count">
                {text.length} / {MAX_DESCRIPTION}
              </span>
            </div>
            {/* Hidden from people; bots that fill every field get their report dropped */}
            <input
              type="text"
              name="website"
              value={website}
              onChange={e => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] w-px h-px opacity-0"
            />
            <p className="text-[11px] text-slate-400 leading-relaxed" data-testid="bug-report-privacy">
              Reports are public. Please don't include your name, email or any other personal details.
              {inGame
                ? ' Both deck lists, the game log and the game seed are sent with your report so the bug can be replayed.'
                : ' The report includes which screen you were on and the app version.'}
            </p>
            {status.kind === 'error' && (
              <p className="text-xs text-pink-400" role="alert" data-testid="bug-report-error">
                {status.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="px-4 py-2 text-xs font-bold border bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={tooShort || sending}
                data-testid="bug-report-send"
                className="px-4 py-2 text-xs font-bold border border-amber-400 bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> {sending ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
