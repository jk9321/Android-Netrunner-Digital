import React, { useEffect, useRef, useState } from 'react';
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

interface DragState {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTime: number;
  velocityY: number;
  moved: boolean;
  startedOnGrip: boolean;
}

/**
 * Mobile bottom sheet primitive with safe-area padding, touch-draggable grabber handle, and
 * optional Peek Mode so players can glance at the board mid-run or mid-decision without losing their place.
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
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  // Dragging down triggers Peek when available, otherwise closes the sheet
  const dragDownAction = onTogglePeek ?? onClose;

  useEffect(() => {
    setDragY(0);
    setDragging(false);
    dragRef.current = null;
  }, [open, peeking]);

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

  const handleDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragDownAction) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastTime: now,
      velocityY: 0,
      moved: false,
      startedOnGrip: Boolean(target?.closest('[data-sheet-grip="true"]')),
    };
    setDragging(true);
  };

  const handleDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const rawDy = e.clientY - d.startY;
    const dy = Math.max(0, rawDy);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = Math.max(1, now - d.lastTime);
    d.velocityY = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastTime = now;
    if (Math.abs(rawDy) >= 6) d.moved = true;
    setDragY(dy);
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const dy = Math.max(0, e.clientY - d.startY);
    const shouldTrigger =
      !cancelled &&
      Boolean(dragDownAction) &&
      (dy >= 56 || (dy >= 24 && d.velocityY >= 0.4) || (!d.moved && d.startedOnGrip));
    setDragging(false);
    setDragY(0);
    if (shouldTrigger) dragDownAction?.();
  };

  if (peeking && onTogglePeek) {
    return renderInPortal(
      <>
        <div
          onClick={onTogglePeek}
          className={`fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3rem)] ${zIndexClass} flex items-center justify-between gap-2 px-3 py-2 rounded-[4px] bg-[#0c121e]/95 border ${accentClass} shadow-2xl font-mono text-xs backdrop-blur-md cursor-pointer`}
          data-testid={testId ? `${testId}-peek` : undefined}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-slate-100">{title}</div>
            {subtitle && <div className="truncate text-[10px] text-slate-400">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onTogglePeek();
            }}
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
      style={dragY > 0 ? { opacity: Math.max(0.25, 1 - dragY / 280) } : undefined}
      className={`fixed inset-0 ${zIndexClass} bg-black/65 backdrop-blur-[1px] flex flex-col justify-end`}
      data-testid={testId ? `${testId}-backdrop` : undefined}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        onClick={e => e.stopPropagation()}
        initial={prefersReduced ? false : { y: 36, opacity: 0.4 }}
        animate={{ y: dragY, opacity: 1 }}
        transition={dragging || prefersReduced ? { duration: 0 } : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className={`w-full max-h-[84dvh] bg-[#090e17] border-t-2 ${accentClass} rounded-t-[14px] shadow-2xl font-mono text-slate-100 flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]`}
      >
        {/* Touch-draggable grabber + header zone (touch-none prevents browser scroll hijack) */}
        <div
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={e => finishDrag(e, false)}
          onPointerCancel={e => finishDrag(e, true)}
          className={`shrink-0 ${dragDownAction ? 'touch-none select-none' : ''}`}
        >
          {dragDownAction && (
            <div
              data-sheet-grip="true"
              data-testid={testId ? `${testId}-grip` : undefined}
              title={onTogglePeek ? 'Drag down or tap to peek board' : 'Drag down or tap to close'}
              className="w-full pt-2.5 pb-1.5 flex justify-center cursor-grab active:cursor-grabbing"
            >
              <div className={`w-10 h-1 rounded-full transition-colors ${dragging ? 'bg-slate-400' : 'bg-slate-600'}`} />
            </div>
          )}

          {/* Header */}
          <div className="px-3.5 py-2 border-b border-slate-800 bg-[#0c121d] flex items-center justify-between gap-2">
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
