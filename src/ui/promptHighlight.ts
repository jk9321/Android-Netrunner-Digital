import { useSyncExternalStore } from 'react';

/** The board card a prompt option points at, with where it sits in words. */
export interface PromptTarget {
  id: string;
  label: string | null;
}

/**
 * Links a decision's card options to the same cards on the table: hover an
 * option and its board card lights up with its position, and picked options
 * stay marked. Facedown cards all look alike, so this is how a player tells
 * which one they are choosing (Tāo Salonga swapping unrezzed ice).
 * A module store so only the linked cards repaint, not the whole table.
 */
let hovered: PromptTarget | null = null;
let selected: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

export function hoverPromptTarget(target: PromptTarget | null) {
  if (hovered?.id === target?.id) return;
  hovered = target;
  notify();
}

export function selectPromptTargets(ids: string[]) {
  if (ids.length === selected.size && ids.every(id => selected.has(id))) return;
  selected = new Set(ids);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How a board card is linked to the open prompt: the hovered option's label, picked, or not at all. */
export function usePromptHighlight(instanceId: string): { hovered: boolean; label: string | null; selected: boolean } {
  const isHovered = useSyncExternalStore(subscribe, () => hovered?.id === instanceId);
  const isSelected = useSyncExternalStore(subscribe, () => selected.has(instanceId));
  return { hovered: isHovered, label: isHovered ? (hovered?.label ?? null) : null, selected: isSelected };
}
