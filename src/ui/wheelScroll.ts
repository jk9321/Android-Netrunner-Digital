/**
 * Mouse wheel over a sideways-scrolling bar (a hand, the rig, the servers row) scrolls it sideways, as long as
 * nothing under the pointer can scroll the way the wheel turned. Vertical scrolling elsewhere is untouched,
 * and so are sideways wheels, trackpads' horizontal swipes, and zoom gestures.
 */
function canScroll(el: HTMLElement, axis: 'x' | 'y', delta: number): boolean {
  const style = getComputedStyle(el);
  const overflow = axis === 'x' ? style.overflowX : style.overflowY;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  if (axis === 'x') {
    return delta > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0;
  }
  return delta > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
}

export function sidewaysTarget(start: EventTarget | null, deltaY: number): HTMLElement | null {
  let el = start instanceof HTMLElement ? start : start instanceof Node ? start.parentElement : null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (canScroll(el, 'y', deltaY)) return null;
    if (canScroll(el, 'x', deltaY)) return el;
    el = el.parentElement;
  }
  return null;
}

export function installWheelScroll(): void {
  document.addEventListener(
    'wheel',
    e => {
      if (e.ctrlKey || e.shiftKey || e.defaultPrevented || e.deltaMode === undefined) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const bar = sidewaysTarget(e.target, e.deltaY);
      if (!bar) return;
      // Line-based wheels report small steps; scale them to something visible
      const step = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      bar.scrollLeft += step;
      e.preventDefault();
    },
    { passive: false },
  );
}
