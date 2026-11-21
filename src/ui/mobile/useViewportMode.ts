import { useEffect, useState } from 'react';

/**
 * Viewport layout tier — cleanly decoupled from pointer capability (`useIsTouchDevice`).
 * - mobile-portrait: phone width (< 768px) in portrait or taller aspect
 * - mobile-landscape: short phone landscape (height < 500px and width < 1024px)
 * - tablet: medium screens (768px–1023px, e.g. iPad portrait)
 * - desktop: wide screens (1024px+, e.g. laptop/monitor/iPad landscape)
 */
export type ViewportMode = 'mobile-portrait' | 'mobile-landscape' | 'tablet' | 'desktop';

const MOBILE_WIDTH_MQ = '(max-width: 767px)';
const MOBILE_LANDSCAPE_MQ = '(max-height: 500px) and (max-width: 1023px) and (orientation: landscape)';
const TABLET_MQ = '(min-width: 768px) and (max-width: 1023px)';
const TOUCH_MQ = '(hover: none) and (pointer: coarse)';

export function detectViewportMode(): ViewportMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  if (window.matchMedia(MOBILE_LANDSCAPE_MQ).matches) return 'mobile-landscape';
  if (window.matchMedia(MOBILE_WIDTH_MQ).matches) return 'mobile-portrait';
  if (window.matchMedia(TABLET_MQ).matches) return 'tablet';
  return 'desktop';
}

export function isMobileViewport(mode: ViewportMode): boolean {
  return mode === 'mobile-portrait' || mode === 'mobile-landscape';
}

/** Tracks the active layout tier across window resizes and device rotations. */
export function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>(detectViewportMode);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const queries = [
      window.matchMedia(MOBILE_WIDTH_MQ),
      window.matchMedia(MOBILE_LANDSCAPE_MQ),
      window.matchMedia(TABLET_MQ),
    ];
    const update = () => setMode(detectViewportMode());
    for (const mq of queries) mq.addEventListener('change', update);
    return () => {
      for (const mq of queries) mq.removeEventListener('change', update);
    };
  }, []);
  return mode;
}

/** True on touch-only devices (phones & tablets), never on desktop mouse browsers regardless of window width. */
export function useIsTouchDevice(): boolean {
  const [touch, setTouch] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(TOUCH_MQ).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(TOUCH_MQ);
    const update = () => setTouch(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return touch;
}
