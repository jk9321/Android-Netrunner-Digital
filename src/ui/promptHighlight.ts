import { useSyncExternalStore } from 'react';

/** The board card a prompt option points at, with where it sits in words. */
export interface PromptTarget {
  id: string;
  label: string | null;
}

/** An interactive card target on the tabletop registered by an open prompt or install bar. */
export interface BoardCardTarget {
  onClick: () => void;
}

/** An interactive server target on the tabletop registered by an open prompt or install bar. */
export interface BoardServerTarget {
  onClick: () => void;
  title?: string;
}

/**
 * Links a decision's card and server options to the board: hover an option
 * and its board card or server column lights up with an outline, or click the
 * board card / server directly to pick it as a target.
 * A module store so only the linked elements repaint, not the whole table.
 */
let hovered: PromptTarget | null = null;
let hoveredServerId: string | null = null;
let selected: ReadonlySet<string> = new Set();
let targetOwner: object | null = null;
let cardTargets: ReadonlyMap<string, BoardCardTarget> = new Map();
let serverTargets: ReadonlyMap<string, BoardServerTarget> = new Map();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

export function hoverPromptTarget(target: PromptTarget | null) {
  if (hovered?.id === target?.id && hovered?.label === target?.label) return;
  hovered = target;
  notify();
}

export function hoverPromptServer(serverId: string | null) {
  if (hoveredServerId === serverId) return;
  hoveredServerId = serverId;
  notify();
}

export function selectPromptTargets(ids: string[]) {
  if (ids.length === selected.size && ids.every(id => selected.has(id))) return;
  selected = new Set(ids);
  notify();
}

export function setBoardTargets(
  owner: object,
  targets: { cards?: ReadonlyMap<string, BoardCardTarget>; servers?: ReadonlyMap<string, BoardServerTarget> },
) {
  targetOwner = owner;
  cardTargets = targets.cards ?? new Map();
  serverTargets = targets.servers ?? new Map();
  notify();
}

export function clearBoardTargets(owner: object) {
  if (targetOwner !== owner) return;
  targetOwner = null;
  cardTargets = new Map();
  serverTargets = new Map();
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How a board card is linked to the open prompt: the hovered option's label, picked, or not at all. */
export function usePromptHighlight(instanceId: string): { hovered: boolean; label: string | null; selected: boolean } {
  // The same getter serves server rendering (tests render the board to markup)
  const getHovered = () => hovered?.id === instanceId;
  const getSelected = () => selected.has(instanceId);
  const isHovered = useSyncExternalStore(subscribe, getHovered, getHovered);
  const isSelected = useSyncExternalStore(subscribe, getSelected, getSelected);
  return { hovered: isHovered, label: isHovered ? (hovered?.label ?? null) : null, selected: isSelected };
}

/** Whether a server column is highlighted by a hovered prompt or install option. */
export function usePromptServerHighlight(serverId: string): boolean {
  const getHovered = () => hoveredServerId === serverId;
  return useSyncExternalStore(subscribe, getHovered, getHovered);
}

/** The active click target for a board card, if the open prompt or picker lets the player pick it. */
export function useBoardCardTarget(instanceId: string): BoardCardTarget | undefined {
  const getTarget = () => cardTargets.get(instanceId);
  return useSyncExternalStore(subscribe, getTarget, getTarget);
}

/** The active click target for a server column, if the open prompt or install bar lets the player pick it. */
export function useBoardServerTarget(serverId: string): BoardServerTarget | undefined {
  const getTarget = () => serverTargets.get(serverId);
  return useSyncExternalStore(subscribe, getTarget, getTarget);
}
