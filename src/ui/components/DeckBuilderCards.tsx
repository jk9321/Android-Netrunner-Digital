import React, { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { describeFormatStatuses, formatStatuses, getFormat, influenceCost, isBanned, isInCardPool } from '../../core';
import { CardDefinition } from '../../core/types/card';
import { iceSubtypes } from '../../core/engine/ice';
import { FACTION_COLOR } from '../cardLabels';
import { asInstance, unscripted } from '../deckBuilderUtils';
import { IceTypeIcons, breakerTypes } from './IceTypeIcons';

/** The card under the pointer gets the same text popout as on the table, so there's no need to inspect it. */
export function useCardHover() {
  const [hover, setHover] = useState<{ code: string; rect: DOMRect } | null>(null);
  const hoverProps = (code: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => setHover({ code, rect: e.currentTarget.getBoundingClientRect() }),
    onMouseLeave: () => setHover(null),
  });
  // A scroll moves the card away from its popout
  useEffect(() => {
    if (!hover) return;
    const clear = () => setHover(null);
    window.addEventListener('scroll', clear, true);
    return () => window.removeEventListener('scroll', clear, true);
  }, [hover]);
  return { hover, setHover, hoverProps };
}

export const InfluencePips: React.FC<{ identity: CardDefinition; card: CardDefinition }> = ({ identity, card }) => {
  const cost = influenceCost(identity, card);
  return cost > 0 ? <span className={FACTION_COLOR[card.faction_code]} title={`${cost} influence`}>{'●'.repeat(cost)}</span> : null;
};

/** Small marker for cards banned or restricted in some format, explained on hover. */
export const FormatMarker: React.FC<{ card: CardDefinition }> = ({ card }) => {
  const statuses = formatStatuses(card);
  if (statuses.length === 0) return null;
  const banned = statuses.some(s => s.status === 'banned');
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${banned ? 'text-red-400' : 'text-amber-300'}`}
      title={describeFormatStatuses(statuses)}
      data-testid={`format-marker-${card.code}`}
    >
      <Ban className="w-3 h-3" />
      <span className="text-[10px] font-bold">{banned ? 'BAN' : 'RES'}</span>
    </span>
  );
};

export const Stat: React.FC<{ label: string; value: string; ok: boolean }> = ({ label, value, ok }) => (
  <div className="flex-1 min-w-[5.5rem] rounded-[2px] border border-slate-800 bg-[#090d15] px-2.5 py-1.5">
    <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`text-sm font-bold ${ok ? 'text-slate-100' : 'text-amber-400'}`}>{value}</div>
  </div>
);

/** The same ice-type / breaks-type icons as in game: what ice is, and what an icebreaker breaks. */
export const TypeIcons: React.FC<{ card: CardDefinition; className?: string }> = ({ card, className }) =>
  card.type_code === 'ice' ? (
    <IceTypeIcons types={iceSubtypes(asInstance(card.code))} side="ice" row className={className} />
  ) : (
    <IceTypeIcons types={breakerTypes(asInstance(card.code))} side="breaker" row className={className} />
  );

/** Badges on a card image: banned or out of the format's pool, not scripted, and how many copies. */
export const CardBadges: React.FC<{ card: CardDefinition; format: ReturnType<typeof getFormat>; count: number }> = ({
  card: c,
  format,
  count: n,
}) => (
  <>
    {(isBanned(format, c) || !isInCardPool(format, c)) && (
      <span
        className="absolute top-1 left-1 rounded bg-red-900/90 text-red-200 text-[10px] font-bold px-1 py-0.5"
        title={isBanned(format, c) ? `Banned in ${format.name} (${format.banList?.name})` : `Not in the ${format.name} card pool`}
        data-testid={`banned-${c.code}`}
      >
        {isBanned(format, c) ? 'BANNED' : 'NOT LEGAL'}
      </span>
    )}
    {unscripted(c) && (
      <span
        className="absolute bottom-1 left-1 right-1 rounded bg-amber-900/90 text-amber-200 text-[10px] font-bold text-center py-0.5"
        title="This card's abilities are not implemented yet"
      >
        NOT SCRIPTED YET
      </span>
    )}
    <TypeIcons card={c} className={`absolute left-1 text-[11px] ${unscripted(c) ? 'bottom-6' : 'bottom-1'}`} />
    {n > 0 && (
      <span className="absolute top-1 right-1 min-w-[1.5rem] h-6 px-1 rounded-full bg-black/85 border border-slate-500 text-xs font-bold flex items-center justify-center">
        {n}
      </span>
    )}
  </>
);
