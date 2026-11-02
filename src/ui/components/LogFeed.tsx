import React, { useEffect, useRef, useState } from 'react';
import { LogEntry } from '../../core/types/state';
import { CardNameText } from './CardNameText';
import { Viewer } from '../viewer';
import { shouldReduceMotion } from '../animations';

interface LogFeedProps {
  logs: LogEntry[];
  /** Lines kept secret from this side show their public wording. */
  viewer: Viewer;
  /** Height classes (default h-48). */
  className?: string;
}

/** Matches search query tokens against log text, aliasing "rd" to "R&D" without matching "card". */
function matchesSearch(message: string, player: string, query: string): boolean {
  const fullText = `${player} ${message}`.toLowerCase();
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  return tokens.every(token => {
    if (token === 'rd' || token === 'r&d' || token === 'r and d') {
      return fullText.includes('r&d') || fullText.includes('r & d') || /\brd\b/.test(fullText);
    }
    return fullText.includes(token);
  });
}

/**
 * Memoized, as is each line: the log only grows, so a re-render of the table
 * (a card selected, a zone opened) draws nothing here, and a new move draws
 * only its new lines.
 */
export const LogFeed: React.FC<LogFeedProps> = React.memo(({ logs, viewer, className = 'h-48' }) => {
  const listRef = useRef<HTMLDivElement>(null);
  const seenCountRef = useRef(logs.length);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    seenCountRef.current = logs.length;
  }, [logs.length]);

  const isFiltering = searchQuery.trim().length > 0;

  const filteredLogs = isFiltering
    ? logs.filter(log => {
        const message = log.secret?.from === viewer ? log.secret.publicMessage : log.message;
        return matchesSearch(message, log.player, searchQuery);
      })
    : logs;

  // Keep the newest entry in view by scrolling the log box itself when new logs arrive (only when not searching).
  useEffect(() => {
    if (isFiltering) return;
    const list = listRef.current;
    if (!list) return;
    const behavior = shouldReduceMotion() ? 'instant' : 'smooth';
    list.scrollTo({ top: list.scrollHeight, behavior });
    const timer = setTimeout(() => {
      list.scrollTo({ top: list.scrollHeight, behavior });
    }, 135);
    return () => clearTimeout(timer);
  }, [logs.length, isFiltering]);

  return (
    <div className={`flex flex-col ${className} bg-[#070b12] border border-slate-800 rounded-[2px] overflow-hidden font-mono text-xs shadow-inner relative`}>
      {/* Static retro raster overlay (low opacity, no motion to prevent eye strain) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-35 z-0"
        style={{
          background: 'repeating-linear-gradient(rgba(0,0,0,0.2) 0px, rgba(0,0,0,0.2) 1px, transparent 1px, transparent 2px)',
        }}
        aria-hidden="true"
      />
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0c121d] border-b border-slate-800 text-[11px] text-slate-400 z-10">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-bold tracking-wider uppercase text-slate-200">SYS.TRACE // STACKHEAP</span>
        <span className="ml-auto text-[10px] text-slate-500 font-mono tracking-wider uppercase">
          {isFiltering ? `${filteredLogs.length} OF ${logs.length} EVT` : `PORT:443 // ${logs.length} EVT`}
        </span>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-2.5 space-y-1.5 z-10">
        {filteredLogs.length === 0 && isFiltering ? (
          <div className="text-[11px] text-slate-500 italic py-2 text-center">
            No matching log entries found for "{searchQuery}".
          </div>
        ) : (
          filteredLogs.map((log, index) => {
            const message = log.secret?.from === viewer ? log.secret.publicMessage : log.message;
            const isNew = !isFiltering && index >= seenCountRef.current;
            return message ? <LogLine key={log.id} player={log.player} message={message} animate={isNew} /> : null;
          })
        )}
      </div>

      {/* Terminal Search Bar */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0c121d] border-t border-slate-800 text-[11px] text-slate-400 z-10">
        <span className="text-cyan-400 font-bold select-none">&gt;</span>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') setSearchQuery('');
          }}
          placeholder="search log... (Esc to clear)"
          className="bg-transparent flex-1 outline-none text-slate-200 placeholder:text-slate-600 text-[11px] font-mono"
        />
        {isFiltering && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-cyan-400 font-semibold font-mono">
              {filteredLogs.length} {filteredLogs.length === 1 ? 'MATCH' : 'MATCHES'}
            </span>
            <button
              onClick={() => setSearchQuery('')}
              className="text-[10px] text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 rounded-[2px] font-bold"
              title="Clear search (Esc)"
              type="button"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

interface LogLineProps {
  player: LogEntry['player'];
  message: string;
  animate?: boolean;
}

const LogLine = React.memo(({ player, message, animate = false }: LogLineProps) => {
  const shouldAnimate = animate && !shouldReduceMotion();
  const [displayedLength, setDisplayedLength] = useState(() => (shouldAnimate ? 0 : message.length));

  useEffect(() => {
    if (!shouldAnimate || displayedLength >= message.length) return;
    const totalLen = message.length;
    const stepMs = Math.max(4, Math.floor(120 / totalLen));
    const timer = setInterval(() => {
      setDisplayedLength(prev => {
        if (prev + 1 >= totalLen) {
          clearInterval(timer);
          return totalLen;
        }
        return prev + 1;
      });
    }, stepMs);
    return () => clearInterval(timer);
  }, [shouldAnimate, message.length]);

  const isTyping = shouldAnimate && displayedLength < message.length;
  const currentText = isTyping ? message.slice(0, displayedLength) : message;

  const colorClass = player === 'corp' ? 'text-cyan-400 border-cyan-800/60 bg-cyan-950/40' : player === 'runner' ? 'text-pink-400 border-pink-800/60 bg-pink-950/40' : 'text-amber-400 border-amber-800/60 bg-amber-950/40';

  return (
    <div className="leading-snug flex items-start gap-1.5 text-[11.5px] text-slate-300">
      <span className={`uppercase font-bold text-[10px] px-1 py-0.5 rounded-[2px] border ${colorClass}`}>{player}</span>
      <span className="flex-1">
        <CardNameText text={currentText} nameClassName="text-slate-100 font-medium underline decoration-slate-600/50 underline-offset-2" />
        {isTyping && (
          <span className="inline-block w-[6px] h-[11px] bg-cyan-400 ml-0.5 align-middle animate-pulse" aria-hidden="true" />
        )}
      </span>
    </div>
  );
});
