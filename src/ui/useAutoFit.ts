import { RefObject, useEffect } from 'react';
import { AUTO_FIT_EVENT, isAutoFitOn } from './cardSize';
import { animationsEnabled } from './animations';

/** Auto fit never shrinks cards below this share of their normal width, or below MIN_PX. */
export const AUTO_FIT_FLOOR = 0.5;
const MIN_PX = 44;

/** The smallest card width auto fit may pick for a given normal width. */
export function autoFitFloor(basePx: number): number {
  return Math.min(basePx, Math.max(basePx * AUTO_FIT_FLOOR, MIN_PX));
}

// --card-h is resolved on :root from the page's --card-w, so it has to be overridden along with it
function setSize(el: HTMLElement, widthPx: number): void {
  el.style.setProperty('--card-w', `${widthPx}px`);
  el.style.setProperty('--card-h', `${widthPx * 1.4}px`);
}
function clearSize(el: HTMLElement): void {
  el.style.removeProperty('--card-w');
  el.style.removeProperty('--card-h');
}

/**
 * Shrinks --card-w inside one scrolling board area until its contents fit
 * without scrolling (or the floor is reached, when scrolling returns).
 * Text stays the same size; only card art shrinks. The area's own override is
 * removed first on every pass so it can grow back when the board empties.
 */
export function useAutoFit(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    let running = false;

    const fit = () => {
      frame = 0;
      running = true;
      // Measure with no transition running, then glide from the old size to the new one
      const previous = parseFloat(getComputedStyle(el).getPropertyValue('--card-w'));
      el.style.transition = 'none';
      clearSize(el);
      if (isAutoFitOn()) {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--card-w);height:0';
        el.appendChild(probe);
        const base = probe.getBoundingClientRect().width;
        el.removeChild(probe);
        const overflows = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
        if (base > 0) {
          setSize(el, base);
          if (overflows()) {
            const floor = autoFitFloor(base);
            let lo = floor;
            let hi = base;
            setSize(el, floor);
            // If even the floor does not fit, stay at the floor and let it scroll
            if (!overflows()) {
              for (let i = 0; i < 7 && hi - lo > 1; i++) {
                const mid = (lo + hi) / 2;
                setSize(el, mid);
                if (overflows()) hi = mid;
                else lo = mid;
              }
              setSize(el, lo);
            }
          }
        }
      }
      const final = parseFloat(el.style.getPropertyValue('--card-w'));
      if (animationsEnabled() && Number.isFinite(previous) && Number.isFinite(final) && Math.abs(previous - final) > 0.5) {
        setSize(el, previous);
        void el.offsetWidth; // commit the starting size before the transition is switched on
        el.style.removeProperty('transition');
        setSize(el, final);
      } else {
        void el.offsetWidth;
        el.style.removeProperty('transition');
      }
      // Let observers triggered by our own changes settle before listening again
      requestAnimationFrame(() => {
        running = false;
      });
    };
    const schedule = () => {
      if (running || frame) return;
      frame = requestAnimationFrame(fit);
    };

    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    if (el.parentElement) resize.observe(el.parentElement);
    const mutation = new MutationObserver(schedule);
    mutation.observe(el, { childList: true, subtree: true });
    const settings = new MutationObserver(schedule);
    settings.observe(document.documentElement, { attributes: true, attributeFilter: ['data-card-size'] });
    window.addEventListener(AUTO_FIT_EVENT, schedule);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      settings.disconnect();
      window.removeEventListener(AUTO_FIT_EVENT, schedule);
      clearSize(el);
      el.style.removeProperty('transition');
    };
  }, [ref]);
}
