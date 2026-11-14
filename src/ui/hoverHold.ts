/**
 * While a hand spreads out its cards slide under the pointer. Hovering them
 * would flick the zoom panel and popout through every card that passes by, so
 * the hand holds hover previews until it has settled; CardView then shows the
 * preview for whichever card the pointer is actually on.
 */
let heldUntil = 0;

export function holdHover(ms: number): void {
  heldUntil = Math.max(heldUntil, Date.now() + ms);
}

/** Milliseconds left before hover previews may open again (0 when not held). */
export function hoverHoldRemaining(): number {
  return Math.max(0, heldUntil - Date.now());
}
