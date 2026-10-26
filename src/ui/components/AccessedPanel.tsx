import { CardInstance } from '../../core';
import { CardView } from './CardView';
import { AccessedCard } from '../savedGame';
import { Viewer } from '../viewer';

/** The cards the Runner accessed in the latest run, so accesses with nothing to decide are still seen. */
export function AccessedPanel({
  cards,
  viewer,
  onInspect,
  onClose,
}: {
  cards: AccessedCard[];
  /** Cards accessed from R&D show face down to the Corp (rules 7.1.2). */
  viewer: Viewer;
  onInspect: (card: CardInstance) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed left-4 bottom-6 z-40 w-72 max-w-[calc(100vw-2rem)] bg-slate-950/95 border-2 border-pink-700 rounded-2xl p-3 shadow-2xl font-mono"
      data-testid="accessed-panel"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-pink-300 uppercase tracking-wider">Accessed this run ({cards.length})</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xs px-1.5" aria-label="Dismiss accessed cards">
          ✕
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cards.map(({ code, secretFrom }, i) => (
          <CardView
            key={`${code}-${i}`}
            card={{ instanceId: `accessed-${i}`, cardCode: code, isRezzed: true, advancementCounters: 0, tokens: {}, hostedCardIds: [] }}
            size="xs"
            notInstalled
            isFaceDown={secretFrom === viewer}
            canPeek={secretFrom !== viewer}
            onInspect={onInspect}
          />
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-1.5">Cards without a trash cost (ice, operations) can't be trashed.</p>
    </div>
  );
}
