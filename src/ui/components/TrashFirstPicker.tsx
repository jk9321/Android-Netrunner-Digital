import { useState } from 'react';
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
  const toggle = (id: string) => setTrash(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]));
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="trash-first">
      <span className="text-xs text-amber-300 font-bold">{heading}</span>
      {cards.map(card => {
        const picked = trash.includes(card.instanceId);
        return (
          <button
            key={card.instanceId}
            onClick={() => toggle(card.instanceId)}
            data-testid={`trash-first-${card.instanceId}`}
            className={`px-2.5 py-1 text-xs font-bold rounded-xl border transition-all flex items-center gap-1 ${
              picked ? 'bg-red-600 border-red-400 text-white line-through' : 'bg-slate-800 border-slate-600 text-slate-200 hover:border-red-400'
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
        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1 shadow-lg"
      >
        <Plus className="w-3.5 h-3.5" /> {confirmLabel(trash)}
      </button>
      <button onClick={onCancel} className="px-2 py-1 text-xs text-slate-400 hover:text-white">
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
      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-amber-500/50 text-amber-300 text-xs font-bold rounded-xl transition-all flex items-center gap-1"
    >
      <Trash2 className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
