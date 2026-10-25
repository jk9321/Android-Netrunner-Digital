import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../../core/types/state';
import { CardNameText } from './CardNameText';
import { Terminal } from 'lucide-react';

interface LogFeedProps {
  logs: LogEntry[];
  /** Height classes (default h-48). */
  className?: string;
}

/**
 * Memoized, as is each line: the log only grows, so a re-render of the table
 * (a card selected, a zone opened) draws nothing here, and a new move draws
 * only its new lines.
 */
export const LogFeed: React.FC<LogFeedProps> = React.memo(({ logs, className = 'h-48' }) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest entry in view by scrolling the log box itself.
  // (scrollIntoView would also scroll the whole page down to the log.)
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div className={`flex flex-col ${className} bg-black/80 border border-slate-800 chamfer overflow-hidden font-mono text-xs shadow-inner`}>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400">
        <Terminal className="w-3.5 h-3.5 text-cyber-terminal" />
        <span className="font-bold tracking-wider uppercase text-cyber-terminal">Terminal Log</span>
        <span className="ml-auto text-[10px] text-slate-500">{logs.length} entries</span>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {logs.map(log => (
          <LogLine key={log.id} log={log} />
        ))}
        <div className="leading-snug terminal-text" aria-hidden="true">
          &gt; <span className="terminal-cursor" />
        </div>
      </div>
    </div>
  );
});

const LogLine = React.memo(({ log }: { log: LogEntry }) => {
  const colorClass = log.player === 'corp' ? 'text-cyan-400' : log.player === 'runner' ? 'text-pink-400' : 'text-amber-400';
  return (
    <div className="leading-snug flex items-start gap-1.5">
      <span className={`uppercase font-bold text-[10px] px-1 rounded bg-slate-900 border border-slate-800 ${colorClass}`}>{log.player}</span>
      <span className="terminal-text">
        <CardNameText text={log.message} nameClassName="text-slate-50" />
      </span>
    </div>
  );
});
