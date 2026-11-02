import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

// Themed replacements for window.alert / window.confirm. Call showAlert or
// showConfirm from anywhere; <DialogHost /> (mounted once in main.tsx) shows
// the queue one dialog at a time.

interface DialogRequest {
  id: number;
  kind: 'alert' | 'confirm';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Destructive confirms get a red button. */
  danger: boolean;
  resolve: (ok: boolean) => void;
}

export interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

let queue: DialogRequest[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function open(kind: DialogRequest['kind'], message: string, options: DialogOptions): Promise<boolean> {
  return new Promise(resolve => {
    queue = [
      ...queue,
      {
        id: nextId++,
        kind,
        message,
        title: options.title ?? (kind === 'alert' ? 'System notice' : 'Confirm'),
        confirmLabel: options.confirmLabel ?? (kind === 'alert' ? 'OK' : 'Confirm'),
        cancelLabel: options.cancelLabel ?? 'Cancel',
        danger: options.danger ?? false,
        resolve,
      },
    ];
    emit();
  });
}

/** A themed message box. Resolves when it is dismissed. */
export const showAlert = (message: string, options: DialogOptions = {}) => open('alert', message, options).then(() => undefined);

/** A themed yes/no question. Resolves true for confirm, false for cancel or Escape. */
export const showConfirm = (message: string, options: DialogOptions = {}) => open('confirm', message, options);

function close(ok: boolean) {
  const [current, ...rest] = queue;
  if (!current) return;
  queue = rest;
  emit();
  current.resolve(ok);
}

export const DialogHost: React.FC = () => {
  const current = useSyncExternalStore(subscribe, () => queue[0]);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe choice (cancel for destructive confirms), and put focus back
  // where it was once the dialog closes.
  useEffect(() => {
    if (!current) return;
    const previous = document.activeElement as HTMLElement | null;
    (current.kind === 'confirm' && current.danger ? cancelRef : confirmRef).current?.focus();
    return () => previous?.focus?.();
  }, [current]);

  if (!current) return null;
  const isConfirm = current.kind === 'confirm';

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog
      const buttons = [cancelRef.current, confirmRef.current].filter((b): b is HTMLButtonElement => !!b);
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    }
  };

  const accent = current.danger ? 'border-pink-500/80 text-pink-400' : 'border-amber-400/80 text-amber-300';
  return (
    <div
      className="fixed inset-0 z-[10001] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) close(false);
      }}
      onKeyDown={onKeyDown}
      data-testid="dialog"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`dialog-title-${current.id}`}
        aria-describedby={`dialog-message-${current.id}`}
        className={`w-full max-w-md bg-[#090d15] border rounded-[2px] shadow-2xl font-mono ${accent}`}
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-[#0d1420]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <h2 id={`dialog-title-${current.id}`} className="font-cyber font-bold text-xs tracking-wider uppercase">
            {current.title}
          </h2>
        </div>
        <p id={`dialog-message-${current.id}`} className="px-5 py-5 text-sm text-slate-100 leading-relaxed whitespace-pre-line">
          {current.message}
        </p>
        <div className="flex justify-end gap-2 px-4 pb-4">
          {isConfirm && (
            <button
              ref={cancelRef}
              onClick={() => close(false)}
              data-testid="dialog-cancel"
              className="px-4 py-2 text-xs font-bold border border-slate-700/80 border-b-2 border-b-slate-600 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 text-slate-200 rounded-[2px] flex items-center gap-1.5 active:translate-y-[1px] active:border-b-[1px] shadow"
            >
              <X className="w-3.5 h-3.5" /> {current.cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            onClick={() => close(true)}
            data-testid="dialog-confirm"
            className={`px-4 py-2 text-xs font-bold rounded-[2px] flex items-center gap-1.5 shadow active:translate-y-[1px] active:border-b-[1px] ${
              current.danger
                ? 'bg-gradient-to-b from-pink-600 to-pink-800 hover:from-pink-500 hover:to-pink-700 border border-pink-400 border-b-2 border-b-pink-300 text-white'
                : 'bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 border border-amber-300 border-b-2 border-b-amber-700 text-black'
            }`}
          >
            <Check className="w-3.5 h-3.5" /> {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
