import React, { useState } from 'react';
import { RotateCcw, X } from 'lucide-react';

/** A small note in the corner saying why the page just reloaded (see reloadReason.ts). */
export const ReloadNotice: React.FC<{ message: string | null }> = ({ message }) => {
  const [open, setOpen] = useState(!!message);
  if (!open || !message) return null;
  return (
    <div
      role="status"
      data-testid="reload-notice"
      className="fixed bottom-4 left-4 z-[10000] max-w-sm flex items-start gap-2 bg-slate-950/95 border border-amber-400/70 chamfer shadow-2xl px-3 py-2 font-mono text-xs text-slate-200"
    >
      <RotateCcw className="w-4 h-4 shrink-0 text-amber-300 mt-0.5" />
      <p className="leading-relaxed">{message}</p>
      <button onClick={() => setOpen(false)} aria-label="Dismiss" className="shrink-0 text-slate-400 hover:text-slate-100">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
