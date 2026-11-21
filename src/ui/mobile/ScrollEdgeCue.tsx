import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ScrollEdgeContainerProps {
  axis: 'x' | 'y';
  /** Map of child `data-scroll-item-id` -> change signature; added/updated items off-screen glow that edge until scrolled into view. */
  itemSignatures: ReadonlyMap<string, string>;
  /** Passive edge bar accent matching the owning board half. */
  tone: 'corp' | 'runner';
  /** Classes for the outer relative container (flex/size layout). */
  className?: string;
  /** Classes for the inner scrollable element. */
  scrollClassName?: string;
  /** Optional testid prefix (renders `${testId}`, `${testId}-edge-start`, `${testId}-edge-end`). */
  testId?: string;
  children: React.ReactNode;
}

interface EdgeState {
  canStart: boolean;
  canEnd: boolean;
  alertStart: boolean;
  alertEnd: boolean;
}

const INITIAL_EDGES: EdgeState = {
  canStart: false,
  canEnd: false,
  alertStart: false,
  alertEnd: false,
};

function findScrollItem(root: HTMLElement, id: string): HTMLElement | null {
  const nodes = root.querySelectorAll<HTMLElement>('[data-scroll-item-id]');
  for (const node of nodes) {
    if (node.dataset.scrollItemId === id) return node;
  }
  return null;
}

/**
 * Scrollable container with subtle passive overflow edge cues and a bright pulsing
 * highlight bar whenever a new or updated item lands off-screen until the player scrolls to it.
 */
export const ScrollEdgeContainer: React.FC<ScrollEdgeContainerProps> = ({
  axis,
  itemSignatures,
  tone,
  className = '',
  scrollClassName = '',
  testId,
  children,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevSigsRef = useRef<Map<string, string> | null>(null);
  const pendingOffscreenRef = useRef<Map<string, 'start' | 'end'>>(new Map());
  const [edges, setEdges] = useState<EdgeState>(INITIAL_EDGES);

  const sigKey = useMemo(
    () => Array.from(itemSignatures.entries(), ([k, v]) => `${k}=${v}`).join('|'),
    [itemSignatures],
  );

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const canStart = axis === 'x' ? el.scrollLeft > 2 : el.scrollTop > 2;
    const canEnd =
      axis === 'x'
        ? el.scrollLeft + el.clientWidth < el.scrollWidth - 2
        : el.scrollTop + el.clientHeight < el.scrollHeight - 2;

    if (pendingOffscreenRef.current.size > 0) {
      const box = el.getBoundingClientRect();
      for (const [id, dir] of Array.from(pendingOffscreenRef.current.entries())) {
        const node = findScrollItem(el, id);
        if (!node) {
          pendingOffscreenRef.current.delete(id);
          continue;
        }
        const rect = node.getBoundingClientRect();
        if (axis === 'x') {
          if (dir === 'end' && (!canEnd || rect.left < box.right - 20)) {
            pendingOffscreenRef.current.delete(id);
          } else if (dir === 'start' && (!canStart || rect.right > box.left + 20)) {
            pendingOffscreenRef.current.delete(id);
          }
        } else {
          if (dir === 'end' && (!canEnd || rect.top < box.bottom - 14)) {
            pendingOffscreenRef.current.delete(id);
          } else if (dir === 'start' && (!canStart || rect.bottom > box.top + 14)) {
            pendingOffscreenRef.current.delete(id);
          }
        }
      }
    }

    let alertStart = false;
    let alertEnd = false;
    for (const dir of pendingOffscreenRef.current.values()) {
      if (dir === 'start' && canStart) alertStart = true;
      if (dir === 'end' && canEnd) alertEnd = true;
    }

    setEdges(prev =>
      prev.canStart === canStart &&
      prev.canEnd === canEnd &&
      prev.alertStart === alertStart &&
      prev.alertEnd === alertEnd
        ? prev
        : { canStart, canEnd, alertStart, alertEnd },
    );
  }, [axis]);

  // Track newly added / updated items and flag whichever edge they fell past
  useEffect(() => {
    const prev = prevSigsRef.current;
    const next = new Map(itemSignatures);
    prevSigsRef.current = next;

    const changedIds: string[] = [];
    if (prev !== null) {
      for (const [id, sig] of next.entries()) {
        if (prev.get(id) !== sig) changedIds.push(id);
      }
      for (const id of Array.from(pendingOffscreenRef.current.keys())) {
        if (!next.has(id)) pendingOffscreenRef.current.delete(id);
      }
    }

    const inspect = () => {
      const el = scrollRef.current;
      if (!el) return;
      if (changedIds.length > 0) {
        const box = el.getBoundingClientRect();
        for (const id of changedIds) {
          const node = findScrollItem(el, id);
          if (!node) continue;
          const rect = node.getBoundingClientRect();
          if (axis === 'x') {
            if (rect.right > box.right + 4) pendingOffscreenRef.current.set(id, 'end');
            else if (rect.left < box.left - 4) pendingOffscreenRef.current.set(id, 'start');
          } else {
            if (rect.bottom > box.bottom + 4) pendingOffscreenRef.current.set(id, 'end');
            else if (rect.top < box.top - 4) pendingOffscreenRef.current.set(id, 'start');
          }
        }
      }
      measure();
    };

    if (typeof requestAnimationFrame === 'function') {
      const raf = requestAnimationFrame(inspect);
      return () => cancelAnimationFrame(raf);
    }
    inspect();
    return undefined;
    // sigKey captures itemSignatures content deterministically without requiring caller memoization
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigKey, axis, measure]);

  // Re-measure on container resize (e.g. hand tray expand/collapse, device rotation)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const passiveBar = tone === 'corp' ? 'bg-cyan-400/50' : 'bg-pink-400/50';
  const passiveFade = tone === 'corp' ? 'from-[#060c14]/90' : 'from-[#0d070c]/90';

  return (
    <div className={`relative min-h-0 min-w-0 ${className}`}>
      <div
        ref={scrollRef}
        data-testid={testId}
        onScroll={measure}
        className={`h-full w-full min-h-0 min-w-0 ${scrollClassName}`}
      >
        {children}
      </div>

      {/* Start edge cue (left for x, top for y) */}
      {edges.canStart &&
        (axis === 'x' ? (
          <div
            aria-hidden="true"
            data-testid={testId ? `${testId}-edge-start` : undefined}
            data-alert={edges.alertStart ? 'true' : 'false'}
            className={`pointer-events-none absolute inset-y-0 left-0 z-10 flex items-stretch ${
              edges.alertStart ? 'w-6 bg-gradient-to-r from-amber-400/30 to-transparent' : `w-4 bg-gradient-to-r ${passiveFade} to-transparent`
            }`}
          >
            <div
              className={`my-1.5 rounded-r-full ${
                edges.alertStart
                  ? 'w-[4px] bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.95)] animate-pulse'
                  : `w-[2px] ${passiveBar}`
              }`}
            />
          </div>
        ) : (
          <div
            aria-hidden="true"
            data-testid={testId ? `${testId}-edge-start` : undefined}
            data-alert={edges.alertStart ? 'true' : 'false'}
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col ${
              edges.alertStart ? 'h-5 bg-gradient-to-b from-amber-400/30 to-transparent' : `h-3.5 bg-gradient-to-b ${passiveFade} to-transparent`
            }`}
          >
            <div
              className={`mx-2 rounded-b-full ${
                edges.alertStart
                  ? 'h-[3px] bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.95)] animate-pulse'
                  : `h-[2px] ${passiveBar}`
              }`}
            />
          </div>
        ))}

      {/* End edge cue (right for x, bottom for y) */}
      {edges.canEnd &&
        (axis === 'x' ? (
          <div
            aria-hidden="true"
            data-testid={testId ? `${testId}-edge-end` : undefined}
            data-alert={edges.alertEnd ? 'true' : 'false'}
            className={`pointer-events-none absolute inset-y-0 right-0 z-10 flex justify-end items-stretch ${
              edges.alertEnd ? 'w-6 bg-gradient-to-l from-amber-400/30 to-transparent' : `w-4 bg-gradient-to-l ${passiveFade} to-transparent`
            }`}
          >
            <div
              className={`my-1.5 rounded-l-full ${
                edges.alertEnd
                  ? 'w-[4px] bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.95)] animate-pulse'
                  : `w-[2px] ${passiveBar}`
              }`}
            />
          </div>
        ) : (
          <div
            aria-hidden="true"
            data-testid={testId ? `${testId}-edge-end` : undefined}
            data-alert={edges.alertEnd ? 'true' : 'false'}
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col justify-end ${
              edges.alertEnd ? 'h-5 bg-gradient-to-t from-amber-400/30 to-transparent' : `h-3.5 bg-gradient-to-t ${passiveFade} to-transparent`
            }`}
          >
            <div
              className={`mx-2 rounded-t-full ${
                edges.alertEnd
                  ? 'h-[3px] bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.95)] animate-pulse'
                  : `h-[2px] ${passiveBar}`
              }`}
            />
          </div>
        ))}
    </div>
  );
};
