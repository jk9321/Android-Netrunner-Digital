import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Sparkles, X } from 'lucide-react';
import { LATEST_UPDATE_ID, UPDATES } from '../../data/updates';

const SEEN_KEY = 'netrunner-whats-new-seen';

function readSeenId(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(SEEN_KEY) : null;
  } catch {
    return null;
  }
}

function writeSeenId(id: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(SEEN_KEY, id);
  } catch {
    // Storage unavailable or blocked
  }
}

function hasUnreadUpdates(): boolean {
  if (!LATEST_UPDATE_ID) return false;
  return readSeenId() !== LATEST_UPDATE_ID;
}

/** "What's new" button with unread indicator and a centered changelog modal. */
export function WhatsNewButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(hasUnreadUpdates);

  const openModal = () => {
    setOpen(true);
    if (unread && LATEST_UPDATE_ID) {
      writeSeenId(LATEST_UPDATE_ID);
      setUnread(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        data-testid="whats-new"
        title="What's new"
        aria-label="What's new"
        className={`relative shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-[2px] border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/70 text-[11px] font-bold whitespace-nowrap transition-all active:translate-y-[1px] active:border-b-[1px] ${className}`}
      >
        <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
        <span>What&apos;s new</span>
        {unread && (
          <span
            aria-label="Unread updates"
            className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]"
          />
        )}
      </button>
      {open && createPortal(<WhatsNewModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function WhatsNewModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="whats-new-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="w-full max-w-lg bg-[#090d15] border border-cyan-400/80 rounded-[2px] shadow-2xl font-mono text-slate-100 flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/80 text-cyan-300 shrink-0">
          <Sparkles className="w-4 h-4 shrink-0" />
          <h2 id="whats-new-title" className="font-cyber font-bold text-xs tracking-[0.2em]">
            WHAT&apos;S NEW
          </h2>
          <button type="button" onClick={onClose} className="ml-auto text-slate-500 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-5">
          {UPDATES.map(entry => (
            <section key={entry.id} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-800/80 pb-1">
                <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">{entry.title}</h3>
                <span className="text-[11px] text-slate-500">{entry.date}</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-300 leading-relaxed">
                {entry.items.map((item, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="text-cyan-400 select-none">›</span>
                    <span>
                      {item.text}
                      {item.link && (
                        <>
                          {' '}
                          <a
                            href={item.link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-cyan-300 underline hover:text-cyan-200 break-all"
                          >
                            <span>{item.link.label}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 inline" />
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-800/80 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="px-4 py-1.5 text-xs font-bold rounded-[2px] border-b-2 border-cyan-700 bg-cyan-500 hover:bg-cyan-400 text-black active:translate-y-[1px] active:border-b-[1px]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
