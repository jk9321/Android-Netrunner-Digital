import { type ReactNode, useEffect, useState } from 'react';
import { hoverPromptServer, hoverPromptTarget } from '../promptHighlight';
import { Plus, Trash2 } from 'lucide-react';
import { CardInstance, cardDef } from '../../core';

function iceSlotLabel(index: number, total: number): string | null {
  if (total <= 1) return null;
  if (index === 0) return 'Outer';
  if (index === total - 1) return 'Inner';
  return `#${index + 1}`;
}

/**
 * Picks the player's own installed cards to trash as part of an install
 * (rules 8.5.6): ice on the server for ice, root cards for a root install,
 * programs for a program. The confirm button says what the install costs.
 */
export function TrashFirstPicker({
  heading,
  cards,
  serverId,
  iceSlots,
  statusText,
  confirmLabel,
  canConfirm,
  onConfirm,
  onCancel,
}: {
  heading: string;
  cards: CardInstance[];
  serverId?: string;
  iceSlots?: boolean;
  statusText?: (trash: string[]) => ReactNode;
  confirmLabel: (trash: string[]) => string;
  canConfirm: (trash: string[]) => boolean;
  onConfirm: (trash: string[]) => void;
  onCancel: () => void;
}) {
  const [trash, setTrash] = useState<string[]>([]);
  // Drop the board & server highlight if the picker closes while a button is hovered
  useEffect(() => {
    if (serverId) hoverPromptServer(serverId);
    return () => {
      hoverPromptTarget(null);
      if (serverId) hoverPromptServer(null);
    };
  }, [serverId]);
  const toggle = (id: string) => setTrash(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]));
  const status = statusText?.(trash);
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="trash-first">
      <span className="text-xs text-amber-300 font-bold">{heading}</span>
      {cards.map((card, index) => {
        const picked = trash.includes(card.instanceId);
        const def = cardDef(card);
        const slot = iceSlots ? iceSlotLabel(index, cards.length) : null;
        return (
          <button
            key={card.instanceId}
            onClick={() => toggle(card.instanceId)}
            onMouseEnter={() => hoverPromptTarget({ id: card.instanceId, label: slot ?? null })}
            onMouseLeave={() => hoverPromptTarget(null)}
            data-testid={`trash-first-${card.instanceId}`}
            className={`px-2.5 py-1 text-xs font-bold rounded-[2px] border border-b-2 transition-all flex items-center gap-1.5 active:translate-y-[1px] active:border-b-[1px] ${
              picked
                ? 'bg-red-950 border-red-500 border-b-red-400 text-white line-through shadow'
                : 'bg-gradient-to-b from-slate-900 to-slate-950 border-slate-700/80 border-b-slate-600 text-slate-200 hover:border-red-400/80'
            }`}
          >
            {picked && <Trash2 className="w-3 h-3" />}
            {slot && <span className="text-slate-400 font-mono">{slot}:</span>}
            <span>{def.title}</span>
            {def.type_code === 'program' && (
              <span className="text-slate-400 font-mono">({def.memory_cost ?? 0} MU)</span>
            )}
            {def.side_code === 'corp' && !card.isRezzed && !card.faceUp && ' (unrezzed)'}
          </button>
        );
      })}
      {status && <span className="text-xs font-mono text-slate-300 mx-1">{status}</span>}
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

/** The attached trash icon segment on a split install pill. */
export function TrashSplitSegment({
  title,
  onClick,
  onMouseEnter,
  onMouseLeave,
  testId,
  className = '',
}: {
  title: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid={testId}
      title={title}
      aria-label={title}
      className={`px-2 py-1.5 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 border border-l-0 border-b-2 text-amber-300 text-xs font-bold rounded-r-[2px] transition-all flex items-center justify-center shadow active:translate-y-[1px] active:border-b-[1px] ${className}`}
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

/** Standalone trash-first button (used when an install isn't possible without trashing first). */
export function TrashFirstButton({
  label,
  title,
  onClick,
  onMouseEnter,
  onMouseLeave,
  testId,
}: {
  label: string;
  title: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid={testId}
      title={title}
      className="px-2.5 py-1.5 bg-gradient-to-b from-slate-900 to-slate-950 hover:bg-slate-800 border border-amber-500/70 border-b-2 border-b-amber-600 text-amber-300 text-xs font-bold rounded-[2px] transition-all flex items-center gap-1.5 shadow active:translate-y-[1px] active:border-b-[1px]"
    >
      <Trash2 className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
