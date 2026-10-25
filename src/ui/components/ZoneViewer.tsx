import React from 'react';
import { createPortal } from 'react-dom';
import { CardInstance } from '../../core/types/card';
import { GameState } from '../../core/types/state';
import { CardView } from './CardView';
import { X } from 'lucide-react';

export interface ZoneGroup {
  label: string;
  cards: CardInstance[];
  /** Face-down cards (Archives): shown only when the viewer may peek. */
  faceDown?: boolean;
}

export type ZoneId = 'archives' | 'heap' | 'corp-score' | 'runner-score' | 'removed';

/** The title and card groups shown when browsing a zone. */
export function zoneContents(zone: ZoneId, state: GameState): { title: string; groups: ZoneGroup[] } {
  switch (zone) {
    case 'archives':
      return {
        title: 'ARCHIVES',
        groups: [
          { label: 'Face up', cards: state.corp.archives.faceUp },
          { label: 'Face down', cards: state.corp.archives.faceDown, faceDown: true },
        ],
      };
    case 'heap':
      return { title: 'HEAP', groups: [{ label: 'Heap', cards: state.runner.heap }] };
    case 'corp-score':
      return { title: 'CORP SCORE AREA', groups: [{ label: 'Scored agendas', cards: state.corp.scoreArea }] };
    case 'runner-score':
      return { title: 'RUNNER SCORE AREA', groups: [{ label: 'Stolen agendas', cards: state.runner.scoreArea }] };
    case 'removed':
      return { title: 'REMOVED FROM GAME', groups: [{ label: 'Removed', cards: state.removedFromGame }] };
  }
}

interface ZoneViewerProps {
  title: string;
  groups: ZoneGroup[];
  /** May the viewer look at face-down cards in these groups? */
  canPeek: boolean;
  onClose: () => void;
  onInspect?: (card: CardInstance) => void;
}

/** A browsable pile: Archives, Heap, score areas, cards removed from the game. */
export const ZoneViewer: React.FC<ZoneViewerProps> = ({ title, groups, canPeek, onClose, onInspect }) =>
  createPortal(
    <div
      onClick={onClose}
      className="fixed inset-x-0 bottom-0 top-16 z-[55] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="zone-viewer"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-5xl max-h-full overflow-y-auto bg-slate-950 border-2 border-slate-700 chamfer p-5 shadow-2xl font-mono text-slate-100"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-cyber font-bold tracking-wider text-sm">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        {groups.map(group => (
          <section key={group.label} className="mb-4 last:mb-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
              {group.label} ({group.cards.length})
            </div>
            {group.cards.length === 0 ? (
              <p className="text-xs text-slate-600 italic">Empty</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {group.cards.map(card => (
                  <CardView
                    key={card.instanceId}
                    card={card}
                    size="sm"
                    notInstalled
                    isFaceDown={group.faceDown}
                    canPeek={!group.faceDown || canPeek}
                    onInspect={!group.faceDown || canPeek ? onInspect : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>,
    document.body
  );
