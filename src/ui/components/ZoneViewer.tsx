import React from 'react';
import { createPortal } from 'react-dom';
import { CardInstance, SideCode } from '../../core/types/card';
import { GameState } from '../../core/types/state';
import { RdKnownCard, knownInHand, knownInRd } from '../../core';
import { CardView } from './CardView';
import { X } from 'lucide-react';

export interface ZoneGroup {
  label: string;
  cards: CardInstance[];
  /** Face-down cards (Archives): shown only when the viewer may peek. */
  faceDown?: boolean;
  /** A line under the group label. */
  note?: string;
  /** A line under each card, matching `cards` by index. */
  captions?: string[];
}

export type ZoneId = 'archives' | 'heap' | 'rd' | 'stack' | 'corp-score' | 'runner-score' | 'removed' | 'known-hq' | 'known-grip';

const KNOWN_NOTE = 'A card that left this hand unseen (installed facedown, shuffled away) could be one of these.';

/**
 * Stand-ins showing only the names of known cards, so the list never points
 * at a real card that may have left the hand unseen.
 */
const knownCards = (state: GameState, owner: SideCode): CardInstance[] =>
  knownInHand(state, owner).map((k, i) => ({
    instanceId: `known-${owner}-${i}`,
    cardCode: k.code,
    isRezzed: false,
    advancementCounters: 0,
    tokens: {},
    hostedCardIds: [],
  }));

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** Where in R&D the Runner thinks a seen card is, e.g. "Top card", "Somewhere in the top 3 · may have been drawn". */
export function rdCaption(e: RdKnownCard, deckSize: number): string {
  const place =
    e.lo === e.hi
      ? e.lo === 0
        ? 'Top card'
        : e.lo === deckSize - 1
          ? 'Bottom card'
          : `${ordinal(e.lo + 1)} from the top`
      : e.lo === 0
        ? `Somewhere in the top ${e.hi + 1}`
        : `${ordinal(e.lo + 1)} to ${ordinal(e.hi + 1)} from the top`;
  return e.left === 'hq' ? `${place}, or drawn` : e.left === 'other' ? `${place}, or gone from R&D` : place;
}

const RD_NOTE = 'Cards the Runner accessed or looked at in R&D, until they are drawn, moved or R&D is shuffled. Cards the Corp rearranged in secret could be anywhere among them.';

/** The cards the Runner remembers in R&D, by name only, with where each one is. */
function rdSeenGroup(state: GameState): ZoneGroup {
  const known = knownInRd(state);
  return {
    label: 'Seen by the Runner',
    note: RD_NOTE,
    cards: known.map((k, i) => ({ instanceId: `known-rd-${i}`, cardCode: k.code, isRezzed: false, advancementCounters: 0, tokens: {}, hostedCardIds: [] })),
    captions: known.map(k => rdCaption(k, state.corp.rd.length)),
  };
}

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
    // Decks list the top card first (index 0 is the top)
    case 'rd':
      // During play only what the Runner remembers; once the game is over, the whole deck (rules 1.7.1)
      return {
        title: 'R&D',
        groups: state.winner ? [{ label: 'Top to bottom', cards: state.corp.rd, faceDown: true }, rdSeenGroup(state)] : [rdSeenGroup(state)],
      };
    case 'stack':
      return { title: 'STACK', groups: [{ label: 'Top to bottom', cards: state.runner.stack, faceDown: true }] };
    case 'heap':
      return { title: 'HEAP', groups: [{ label: 'Heap', cards: state.runner.heap }] };
    case 'corp-score':
      return { title: 'CORP SCORE AREA', groups: [{ label: 'Scored agendas', cards: state.corp.scoreArea }] };
    case 'runner-score':
      return { title: 'RUNNER SCORE AREA', groups: [{ label: 'Stolen agendas', cards: state.runner.scoreArea }] };
    case 'removed':
      return { title: 'REMOVED FROM GAME', groups: [{ label: 'Removed', cards: state.removedFromGame }] };
    // Cards seen in the opponent's hand (rules 1.21.3): remembered by name, they stay facedown there
    case 'known-hq':
      return { title: 'SEEN IN HQ', groups: [{ label: 'Seen in HQ', note: KNOWN_NOTE, cards: knownCards(state, 'corp') }] };
    case 'known-grip':
      return { title: 'SEEN IN GRIP', groups: [{ label: 'Seen in the grip', note: KNOWN_NOTE, cards: knownCards(state, 'runner') }] };
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
            <div className="text-[12px] uppercase tracking-wider text-slate-500 mb-2">
              {group.label} ({group.cards.length})
            </div>
            {group.note && <p className="text-xs text-slate-400 mb-2">{group.note}</p>}
            {group.cards.length === 0 ? (
              <p className="text-xs text-slate-600 italic">Empty</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {group.cards.map((card, i) => (
                  <div key={card.instanceId} className="flex flex-col items-center gap-1">
                    <CardView
                      card={card}
                      size="sm"
                      notInstalled
                      isFaceDown={group.faceDown}
                      canPeek={!group.faceDown || canPeek}
                      typeIcons
                      onInspect={!group.faceDown || canPeek ? onInspect : undefined}
                    />
                    {group.captions?.[i] && <span className="max-w-28 text-center text-[11px] text-slate-400 leading-tight">{group.captions[i]}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>,
    document.body
  );
