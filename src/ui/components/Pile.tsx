import React from 'react';
import { CardInstance, SideCode } from '../../core';
import { getCardBackUrl } from '../../data/cards';
import { CardView } from './CardView';
import { Keyword } from './Keyword';
import { labelKeyword } from '../glossary';

const SIZE = { sm: 'w-28 h-40', md: 'w-36 h-52', lg: 'w-44 h-64', fit: 'card-fit' } as const;

interface PileProps {
  label: string;
  count: number;
  side: SideCode;
  /** Face-up top card (Archives, Heap); without it the pile shows a card back, or an empty slot. */
  topCard?: CardInstance;
  size?: keyof typeof SIZE;
  onClick?: () => void;
  onInspect?: (card: CardInstance) => void;
  testId?: string;
  /** Leave out the label under the pile (the server or rig already names it). */
  hideLabel?: boolean;
}

/** A deck or discard pile drawn as a card on the table, with its count. */
export const Pile: React.FC<PileProps> = ({ label, count, side, topCard, size = 'sm', onClick, onInspect, testId, hideLabel }) => (
  <div className="flex flex-col items-center gap-1 shrink-0">
    <button
      type="button"
      onClick={e => {
        e.stopPropagation();
        onClick?.();
      }}
      disabled={!onClick}
      data-testid={testId}
      title={onClick ? `Browse ${label}` : label}
      className={`relative ${SIZE[size]} rounded-xl ${onClick ? 'cursor-pointer hover:scale-105' : 'cursor-default'} transition-transform`}
    >
      {count === 0 ? (
        <div className="w-full h-full rounded-xl border-2 border-dashed border-slate-700 flex items-center justify-center text-[10px] text-slate-600 uppercase tracking-wider">
          Empty
        </div>
      ) : topCard ? (
        // Hover reaches the card so it previews like any other; clicks still bubble up to browse the pile
        <CardView card={topCard} size={size} notInstalled onInspect={onInspect} />
      ) : (
        <img
          src={getCardBackUrl(side)}
          alt={`${label} (face down)`}
          className="w-full h-full object-cover rounded-xl border-2 border-slate-700 shadow-[3px_3px_0_#1e293b,6px_6px_0_#0f172a]"
        />
      )}
      {count > 0 && (
        <span className="absolute -top-2 -right-2 min-w-[1.5rem] h-6 px-1 rounded-full bg-black/90 border border-slate-500 text-xs font-bold text-slate-100 flex items-center justify-center z-20">
          {count}
        </span>
      )}
    </button>
    {!hideLabel && (
      <Keyword id={labelKeyword(label)} className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</Keyword>
    )}
  </div>
);
