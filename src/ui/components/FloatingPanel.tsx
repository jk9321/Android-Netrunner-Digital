import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minus, GripHorizontal } from 'lucide-react';

interface Position {
  left: number;
  top: number;
}

/** Where each panel was last dragged to, so the next prompt opens in the same spot. */
const savedPositions = new Map<string, Position>();

/** Keep at least this much of the header on screen. */
const MARGIN = 8;

/**
 * Keeps a position on screen. While dragging only the header has to stay in
 * view (`whole` false), so the panel can be pushed mostly off screen; when it
 * opens or is restored, the whole panel is moved into view (`whole` true) at
 * the nearest spot, so its buttons are never hidden below the window.
 */
function clamp(pos: Position, width: number, height: number, whole = false): Position {
  const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN);
  const maxTop = Math.max(MARGIN, window.innerHeight - (whole ? height : Math.min(height, 48)) - MARGIN);
  return {
    left: Math.min(Math.max(pos.left, MARGIN), maxLeft),
    top: Math.min(Math.max(pos.top, MARGIN), maxTop),
  };
}

interface FloatingPanelProps {
  /** Remembers the dragged position across mounts; one id per kind of panel. */
  id: string;
  /** Header content; the header is the drag handle. */
  title: React.ReactNode;
  /** Short text for the collapsed bar, e.g. "Runner decision pending". */
  minimizedLabel: string;
  /** Tailwind classes for the border and shadow colour. */
  accentClass: string;
  /** Tailwind classes for the pulsing dot on the collapsed bar. */
  dotClass: string;
  /** Tailwind classes placing the panel before it has been dragged. */
  defaultPlacement: string;
  /** Where the collapsed bar sits if the panel was never dragged (defaults to defaultPlacement). */
  minimizedPlacement?: string;
  /** Tailwind width classes. */
  widthClass: string;
  zIndexClass?: string;
  /** Controlled minimized state (optional). */
  minimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
  children: React.ReactNode;
  testId?: string;
  role?: string;
  ariaLabelledBy?: string;
}

/**
 * A pop-up the player can drag by its header and collapse to a bar, so the
 * board underneath stays visible while they decide. Nothing dims the board.
 */
export const FloatingPanel: React.FC<FloatingPanelProps> = ({
  id,
  title,
  minimizedLabel,
  accentClass,
  dotClass,
  defaultPlacement,
  minimizedPlacement,
  widthClass,
  zIndexClass = 'z-50',
  minimized: minimizedProp,
  onMinimizedChange,
  children,
  testId,
  role,
  ariaLabelledBy,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(() => savedPositions.get(id) ?? null);
  const [minimizedState, setMinimizedState] = useState(false);
  const minimized = minimizedProp ?? minimizedState;
  const setMinimized = (value: boolean) => {
    if (minimizedProp === undefined) setMinimizedState(value);
    onMinimizedChange?.(value);
  };
  const drag = useRef<{ dx: number; dy: number; pointerId: number } | null>(null);

  const reclamp = useCallback((whole: boolean) => {
    const el = ref.current;
    if (!el) return;
    setPos(p => {
      if (!p) return p;
      const next = clamp(p, el.offsetWidth, el.offsetHeight, whole);
      return next.left === p.left && next.top === p.top ? p : next;
    });
  }, []);

  // Opening at a saved spot (or restoring from the bar) brings the whole panel
  // into view near where it was left, even if it was dragged mostly off screen
  useLayoutEffect(() => reclamp(!minimized), [reclamp, minimized]);
  useEffect(() => {
    const onResize = () => reclamp(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [reclamp]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPos({ left: rect.left, top: rect.top });
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || d.pointerId !== e.pointerId || !el) return;
    setPos(clamp({ left: e.clientX - d.dx, top: e.clientY - d.dy }, el.offsetWidth, el.offsetHeight));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    drag.current = null;
    setPos(p => {
      if (p) savedPositions.set(id, p);
      return p;
    });
  };
  const dragHandlers = { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag };

  const placement = pos ? '' : defaultPlacement;
  const style: React.CSSProperties | undefined = pos ? { left: pos.left, top: pos.top } : undefined;

  if (minimized) {
    return (
      <div
        ref={ref}
        style={style}
        className={`fixed ${zIndexClass} ${pos ? '' : minimizedPlacement ?? defaultPlacement} max-w-[min(36rem,calc(100vw-1rem))] bg-slate-950/95 border-2 rounded-full shadow-2xl font-mono flex items-center gap-2 pl-3 pr-1 py-1 cursor-move select-none touch-none ${accentClass}`}
        data-testid={testId ? `${testId}-minimized` : undefined}
        {...dragHandlers}
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotClass}`} />
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dotClass}`} />
        </span>
        <span className="text-xs font-bold text-slate-100 truncate">{minimizedLabel}</span>
        <button
          onClick={() => setMinimized(false)}
          className="ml-1 px-3 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold flex items-center gap-1 shrink-0"
          aria-label="Restore panel"
          data-testid={testId ? `${testId}-restore` : undefined}
        >
          <Maximize2 className="w-3 h-3" /> Show
        </button>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={style}
      className={`fixed ${zIndexClass} ${placement} ${widthClass} max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] flex flex-col bg-slate-950/95 backdrop-blur-xl border-2 chamfer shadow-2xl font-mono ${accentClass}`}
      data-testid={testId}
      role={role}
      aria-labelledby={ariaLabelledBy}
    >
      <div
        className="flex items-center gap-2 px-4 pt-3 pb-2 cursor-move select-none touch-none shrink-0"
        title="Drag to move"
        data-testid={testId ? `${testId}-handle` : undefined}
        {...dragHandlers}
      >
        <GripHorizontal className="w-4 h-4 text-slate-600 shrink-0" />
        <div className="flex-1 min-w-0">{title}</div>
        <button
          onClick={() => setMinimized(true)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
          aria-label="Minimize panel"
          title="Minimize to see the board"
          data-testid={testId ? `${testId}-minimize` : undefined}
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>
      <div className="px-5 pb-5 overflow-y-auto min-h-0">{children}</div>
    </div>
  );
};
