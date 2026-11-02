import { useEffect, useState } from 'react';
import { hoverPromptTarget } from '../promptHighlight';
import { Plus, Trash2 } from 'lucide-react';
import { CardInstance, cardDef } from '../../core';

/**
 * Picks the player's own installed cards to trash as part of an install
 * (rules 8.5.6): ice on the server for ice, root cards for a root install,
 * programs for a program. The confirm button says what the install costs.
 */
export function TrashFirstPicker({
  heading,
  cards,
  confirmLabel,
  canConfirm,
  onConfirm,
  onCancel,
}: {
  heading: string;
  cards: CardInstance[];
  confirmLabel: (trash: string[]) => string;
  canConfirm: (trash: string[]) => boolean;
  onConfirm: (trash: string[]) => void;
  onCancel: () => void;
}) {
  const [trash, setTrash] = useState<string[]>([]);
  // Drop the board highlight if the picker closes while a button is hovered
  useEffect(() => () => hoverPromptTarget(null), []);
  const toggle =(id: string) => setTrash(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]));
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="trash-first">
      <span className="text-xs text-amber-300 font-bold">{heading}</span>
      {cards.map(card => {
        const picked = trash.includes(card.instanceId);
        return (
          <button
            key={card.instanceId}
            onClick={() => toggle(card.instanceId)}
            onMouseEnter={() => hoverPromptTarget({ id: card.instanceId, label: null })}
            onMouseLeave={() => hoverPromptTarget(null)}
            data-testid={`trash-first-${card.instanceId}`}
            className={`px-2.5 py-1 text-xs font-bold rounded-[2px] border border-b-2 transition-all flex items-center gap-1.5 active:translate-y-[1px] active:border-b-[1px] ${
              picked
                ? 'bg-red-950 border-red-500 border-b-red-400 text-white line-through shadow'
                : 'bg-gradient-to-b from-slate-900 to-slate-950 border-slate-700/80 border-b-slate-600 text-slate-200 hover:border-red-400/80'
            }`}
          >
            {picked && <Trash2 className="w-3 h-3" />}
            {cardDef(card).title}
            {cardDef(card).side_code === 'corp' && !card.isRezzed && !card.faceUp && ' (unrezzed)'}
          </button>
        );
      })}
      <button
        onClick={() => onConfirm(trash)}
        disabled={!canConfirm(trash)}
        data-testid="trash-first-confirm"
        className="px-3 py-1.5 bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-bold rounded-[2px] border border-amber-300 border-b-2 border-b-amber-700 transition-all flex items-center gap-1 shadow-lg active:translate-y-[1px] active:border-b-[1px]"
      >
        <Plus className="w-3.5 h-3.5" /> {confirmLabel(trash)}
      </button>
      <button
        onClick={onCancel}
        className="px-2.5 py-1.5 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 border border-slate-700/80 border-b-2 border-b-slate-600 text-slate-300 hover:text-white text-xs font-bold rounded-[2px] transition-all shadow active:translate-y-[1px] active:border-b-[1px]"
      >
        Cancel
      </button>
    </div>
  );
}

/** The small button that opens a TrashFirstPicker. */
export function TrashFirstButton({ label, title, onClick, testId }: { label: string; title: string; onClick: () => void; testId?: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      title={title}
      className="px-2.5 py-1.5 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 border border-amber-500/70 border-b-2 border-b-amber-600 text-amber-300 text-xs font-bold rounded-[2px] transition-all flex items-center gap-1.5 shadow active:translate-y-[1px] active:border-b-[1px]"
    >
      <Trash2 className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
