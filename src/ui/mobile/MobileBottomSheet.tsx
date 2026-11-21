import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { shouldReduceMotion } from '../animations';

interface MobileBottomSheetProps {
  open: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  accentClass?: string;
  /** Optional close handler; omit for mandatory prompts/runs that should use Peek Mode instead of closing. */
  onClose?: () => void;
  /** When provided, displays a 1-tap "Peek Board" button that collapses the sheet into a slim docked pill. */
  peeking?: boolean;
  onTogglePeek?: () => void;
  peekLabel?: string;
  /** Sticky bottom action footer inside the sheet (thumb zone). */
  footer?: React.ReactNode;
  /** Extra content rendered in the header next to peek/close buttons. */
  headerActions?: React.ReactNode;
  /** Keep children mounted in a hidden container while peeking so board-click targets and multi-select state stay alive. */
  keepMountedWhilePeeking?: boolean;
  /** Optional override for the scrollable content wrapper classes (e.g. flush docked Run/Prompt panels). */
  contentClassName?: string;
  zIndexClass?: string;
  testId?: string;
  children: React.ReactNode;
}

/**
 * Mobile bottom sheet primitive with safe-area padding and optional Peek Mode so players can
 * glance at the board mid-run or mid-decision without losing their place.
 */
export const MobileBottomSheet: React.FC<MobileBottomSheetProps> = ({
  open,
  title,
  subtitle,
  accentClass = 'border-slate-700',
  onClose,
  peeking = false,
  onTogglePeek,
  peekLabel = 'Return',
  footer,
  headerActions,
  keepMountedWhilePeeking = false,
  contentClassName = 'flex-1 min-h-0 overflow-y-auto px-3.5 py-3',
  zIndexClass = 'z-[60]',
  testId,
  children,
}) => {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const prefersReduced = shouldReduceMotion();
  const renderInPortal = (node: React.ReactElement) =>
    typeof document !== 'undefined' && document.body ? createPortal(node, document.body) : node;

  if (peeking && onTogglePeek) {
    return renderInPortal(
      <>
        <div
          className={`fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3rem)] ${zIndexClass} flex items-center justify-between gap-2 px-3 py-2 rounded-[4px] bg-[#0c121e]/95 border ${accentClass} shadow-2xl font-mono text-xs backdrop-blur-md`}
          data-testid={testId ? `${testId}-peek` : undefined}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-slate-100">{title}</div>
            {subtitle && <div className="truncate text-[10px] text-slate-400">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onTogglePeek}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[2px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 font-bold text-xs min-h-[36px]"
            data-testid={testId ? `${testId}-restore` : undefined}
          >
            <ChevronUp className="w-3.5 h-3.5" /> {peekLabel}
          </button>
        </div>
        {keepMountedWhilePeeking && (
          <div className="hidden" aria-hidden="true">
            {children}
          </div>
        )}
      </>,
    );
  }

  return renderInPortal(
    <div
      onClick={onClose}
      className={`fixed inset-0 ${zIndexClass} bg-black/65 backdrop-blur-[1px] flex flex-col justify-end`}
      data-testid={testId ? `${testId}-backdrop` : undefined}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        onClick={e => e.stopPropagation()}
        initial={prefersReduced ? false : { y: 36, opacity: 0.4 }}
        animate={{ y: 0, opacity: 1 }}
        transition={prefersReduced ? { duration: 0 } : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className={`w-full max-h-[84dvh] bg-[#090e17] border-t-2 ${accentClass} rounded-t-[14px] shadow-2xl font-mono text-slate-100 flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]`}
      >
        {/* Drag/tap grabber bar */}
        <div className="w-10 h-1 rounded-full bg-slate-700 mx-auto mt-2 mb-1 shrink-0" aria-hidden="true" />

        {/* Header */}
        <div className="px-3.5 py-2 border-b border-slate-800 bg-[#0c121d] flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold tracking-wider text-slate-100 truncate">{title}</div>
            {subtitle && <div className="text-[11px] text-slate-400 truncate mt-0.5">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {headerActions}
            {onTogglePeek && (
              <button
                type="button"
                onClick={onTogglePeek}
                data-testid={testId ? `${testId}-peek-btn` : undefined}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[2px] bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs min-h-[36px]"
              >
                Peek <ChevronDown className="w-3.5 h-3.5" />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close sheet"
                data-testid={testId ? `${testId}-close` : undefined}
                className="p-2 rounded-[2px] bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className={contentClassName}>{children}</div>

        {/* Optional Sticky Footer (thumb zone) */}
        {footer && (
          <div className="px-3.5 py-2.5 border-t border-slate-800 bg-[#070a11] shrink-0 flex flex-wrap items-center gap-2">
            {footer}
          </div>
        )}
      </motion.div>
    </div>,
  );
};
