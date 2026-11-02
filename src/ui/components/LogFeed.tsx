import React, { useEffect, useRef, useState } from 'react';
import { LogEntry } from '../../core/types/state';
import { CardNameText } from './CardNameText';
import { Viewer } from '../viewer';

interface LogFeedProps {
  logs: LogEntry[];
  /** Lines kept secret from this side show their public wording. */
  viewer: Viewer;
  /** Height classes (default h-48). */
  className?: string;
}

/**
 * Memoized, as is each line: the log only grows, so a re-render of the table
 * (a card selected, a zone opened) draws nothing here, and a new move draws
 * only its new lines.
 */
export const LogFeed: React.FC<LogFeedProps> = React.memo(({ logs, viewer, className = 'h-48' }) => {
  const listRef = useRef<HTMLDivElement>(null);
  const initialMountCount = useRef(logs.length);

  // Keep the newest entry in view by scrolling the log box itself.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [logs.length]);

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
        <span className="ml-auto text-[10px] text-slate-500 font-mono tracking-wider uppercase">PORT:443 // {logs.length} EVT</span>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto p-2.5 space-y-1.5 z-10">
        {logs.map((log, index) => {
          const message = log.secret?.from === viewer ? log.secret.publicMessage : log.message;
          const isNew = index >= initialMountCount.current;
          return message ? <LogLine key={log.id} player={log.player} message={message} animate={isNew} /> : null;
        })}
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
  const shouldAnimate = animate && typeof window !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
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
