import React, { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { CardInstance } from '../../core/types/card';
import { cardDef, getCardBackUrl, getCardImageUrl } from '../../data/cards';
import { typeLine } from '../cardLabels';
import { GameState } from '../../core/types/state';
import { findCardAnywhere } from '../../core/engine/helpers';
import { liveValues } from '../liveValues';
import { renderSymbols } from './CreditIcon';
import { Eye } from 'lucide-react';

/** The card under the pointer, and whether this viewer may see its face. */
export interface ZoomTarget {
  card: CardInstance;
  hidden: boolean;
  /** Facedown, but the Runner remembers it (see CardView's seen). */
  seen?: boolean;
}

/**
 * Holds the last card hovered on the board. A tiny store rather than App
 * state, so hovering repaints only the zoom panel and not the whole table.
 */
export function createZoomStore() {
  let current: ZoomTarget | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    show(target: ZoomTarget) {
      if (current?.card.instanceId === target.card.instanceId && current.hidden === target.hidden && !!current.seen === !!target.seen) return;
      current = target;
      listeners.forEach(l => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ZoomStore = ReturnType<typeof createZoomStore>;

/**
 * Cards inside this provider send their hover to the zoom panel instead of
 * opening a floating popout. Modals stay outside it and keep the popout.
 */
export const ZoomContext = createContext<ZoomStore | null>(null);

export const useZoom = () => useContext(ZoomContext);

/** Full-size view of the hovered card, as on jinteki.net. Double-click a card for the rules text. */
export const ZoomPanel: React.FC<{ store: ZoomStore; state: GameState; onInspect: (card: CardInstance) => void }> = ({ store, state, onInspect }) => {
  const target = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [failed, setFailed] = useState<string | null>(null);

  if (!target) {
    return (
      <div className="zoom-card flex items-center justify-center border border-dashed border-slate-700 text-[12px] text-slate-500 text-center px-6">
        Hover any card on the table to see it here
      </div>
    );
  }

  const { card, hidden, seen } = target;
  const def = cardDef(card);
  const src = hidden ? getCardBackUrl(def.side_code || 'corp') : getCardImageUrl(card.cardCode);
  // The hovered instance is a snapshot; read counters and zones from the live state
  const live = hidden ? [] : liveValues(state, findCardAnywhere(state, card.instanceId) ?? card);

  return (
    <div className="flex flex-col items-center gap-1" data-testid="zoom-panel">
      <div className="zoom-card relative border border-amber-400/60 overflow-hidden bg-black">
        {failed === src ? (
          <div className="w-full h-full flex items-center justify-center p-3 text-center text-sm text-slate-300">{def.title}</div>
        ) : (
          <img
            src={src}
            alt={hidden ? 'Face-down card' : def.title}
            className={`w-full h-full object-cover ${seen ? 'opacity-60 grayscale-[50%]' : ''}`}
            onError={() => setFailed(src)}
          />
        )}
        {seen && <div className="seen-veil absolute inset-0 pointer-events-none" />}
        {live.length > 0 && (
          <div
            data-testid="zoom-live-values"
            className="absolute inset-x-1 top-[44%] -translate-y-full rounded bg-slate-950/90 border border-amber-400/60 px-2 py-1 text-[12px] font-mono text-amber-200 flex flex-col gap-0.5 pointer-events-none"
          >
            {live.map(line => (
              <div key={line} className="flex items-center gap-1 flex-wrap">{renderSymbols(line)}</div>
            ))}
          </div>
        )}
      </div>
      <div className="w-full flex items-center justify-between gap-2 text-[12px] font-mono min-w-0">
        <span className="truncate text-slate-300" title={seen ? `Unrezzed, last seen as ${def.title}` : undefined}>
          {hidden ? 'Face-down card' : seen ? `Unrezzed, last seen as ${def.title}` : `${def.title} · ${typeLine(def)}`}
        </span>
        {!hidden && (
          <button
            onClick={() => onInspect(card)}
            className="shrink-0 flex items-center gap-1 text-amber-300 hover:text-amber-100"
            title="Rules text and details"
          >
            <Eye className="w-3 h-3" /> Details
          </button>
        )}
      </div>
    </div>
  );
};
