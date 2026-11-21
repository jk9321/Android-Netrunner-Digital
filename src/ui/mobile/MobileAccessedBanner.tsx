import React from 'react';
import { Eye, Shield, X } from 'lucide-react';
import { CardInstance, HIDDEN_CORP, getCardDefinition } from '../../core';
import type { AccessedCard } from '../savedGame';

interface MobileAccessedBannerProps {
  cards: AccessedCard[];
  onInspect: (card: CardInstance) => void;
  onClose: () => void;
}

/**
 * Compact inline banner docked right above the mobile thumb cockpit showing cards
 * accessed during the latest run. Respects R&D secrecy (cards without a `code` render
 * as hidden face-down pills for the Corp, rules 7.1.2).
 */
export const MobileAccessedBanner: React.FC<MobileAccessedBannerProps> = ({
  cards,
  onInspect,
  onClose,
}) => {
  if (cards.length === 0) return null;

  const untrashable = cards.some(({ code }) => {
    if (!code) return false;
    const def = getCardDefinition(code);
    return def.type_code !== 'agenda' && def.trash_cost == null;
  });

  return (
    <div
      data-testid="mobile-accessed-banner"
      className="shrink-0 bg-[#120914] border-t border-pink-700/80 px-2 py-1.5 font-mono text-xs z-20"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-pink-300">
          Accessed this run ({cards.length})
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss accessed cards"
          data-testid="mobile-accessed-dismiss"
          className="h-7 w-7 flex items-center justify-center rounded-[2px] bg-slate-900 active:bg-slate-800 border border-slate-700 text-slate-300"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {cards.map(({ code }, i) => {
          if (!code) {
            return (
              <span
                key={`hidden-${i}`}
                data-testid="mobile-accessed-hidden"
                className="shrink-0 h-9 px-2.5 rounded-[3px] border border-slate-700 border-dashed bg-slate-950 text-slate-400 text-[11px] font-bold inline-flex items-center gap-1.5"
              >
                <Shield className="w-3.5 h-3.5 text-slate-500" /> R&D Card (hidden)
              </span>
            );
          }
          const def = getCardDefinition(code);
          const synthetic: CardInstance = {
            instanceId: `accessed-${i}`,
            cardCode: code ?? HIDDEN_CORP,
            isRezzed: true,
            advancementCounters: 0,
            tokens: {},
            hostedCardIds: [],
          };
          return (
            <button
              key={`${code}-${i}`}
              type="button"
              onClick={() => onInspect(synthetic)}
              className="shrink-0 h-9 px-2.5 rounded-[3px] border border-pink-700/80 bg-[#1b0d1d] active:bg-pink-950 text-slate-100 text-[11px] font-bold inline-flex items-center gap-1.5"
            >
              <Eye className="w-3 h-3 text-amber-400 shrink-0" />
              <span className="truncate max-w-[10rem]">{def.title}</span>
              <span className="text-[10px] text-pink-300 capitalize font-normal">{def.type_code}</span>
            </button>
          );
        })}
      </div>

      {untrashable && (
        <div className="text-[10px] text-slate-400 mt-0.5">
          Cards without a trash cost can&apos;t be trashed.
        </div>
      )}
    </div>
  );
};
