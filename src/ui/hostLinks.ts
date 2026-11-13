import { useSyncExternalStore } from 'react';

/**
 * Which cards to outline while the pointer is on a host link: hover a trojan
 * in the rig and its host ice lights up, hover the ice and its trojans do.
 * A module store so only the linked cards repaint, not the whole table.
 */
let lit: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function lightHostLink(ids: string[]) {
  lit = new Set(ids);
  listeners.forEach(l => l());
}

export function clearHostLink() {
  if (lit.size === 0) return;
  lit = new Set();
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while this card is part of the hovered host link. */
export function useHostLinkLit(instanceId: string): boolean {
  const read = () => lit.has(instanceId);
  return useSyncExternalStore(subscribe, read, read);
}
