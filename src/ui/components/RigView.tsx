import React from 'react';
import { RunnerRig } from '../../core/types/state';
import { CardInstance } from '../../core/types/card';
import { CardView } from './CardView';
import { getCardScript } from '../../core';
import { Cpu, HardDrive, Link2, Users } from 'lucide-react';
import { clearHostLink, lightHostLink, useHostLinkLit } from '../hostLinks';
import type { IceSubtype } from '../../core/scripts/types';

interface RigViewProps {
  rig: RunnerRig;
  onInspectCard?: (card: CardInstance) => void;
  /** The Runner's identity, Stack and Heap, shown beside the rig. */
  aside?: React.ReactNode;
  /** What a hosted card sits on: Corp ice (Botulus, "R&D ice 1 · Ice Wall") or a rig card (Gamdragon Pro on a breaker). */
  hostLabel?: (card: CardInstance) => string | undefined;
  /** The ice types an icebreaker breaks, shown as icons on it. */
  breaks?: (card: CardInstance) => IceSubtype[];
  /** May the viewer see cards hosted facedown (Read-Write Share)? */
  canSeeSecrets?: boolean;
  /** True when the Runner board sits on the top half: Hardware/Resources on top, Programs along the bottom facing Corp ice. */
  mirrored?: boolean;
}

/** An installed card, with any cards hosted faceup on it (Bling, Madani, Detente) tucked beneath. */
const RigCard: React.FC<{
  card: CardInstance;
  onInspect?: (card: CardInstance) => void;
  hostLabel?: string;
  breaks?: IceSubtype[];
  canSeeSecrets?: boolean;
}> = ({ card, onInspect, hostLabel, breaks = [], canSeeSecrets = true }) => {
  const hosted = card.hostedCards ?? [];
  const faceDown = !!getCardScript(card.cardCode)?.hostedFaceDown;
  const lit = useHostLinkLit(card.instanceId);
  // Hover a hosted card or its host and both outline: Corp ice, or a rig card hosting another (Gamdragon Pro)
  const link = card.hostedOnId ? [card.instanceId, card.hostedOnId] : card.hostedCardIds.length > 0 ? [card.instanceId, ...card.hostedCardIds] : null;
  const linkProps = link
    ? { onMouseEnter: () => lightHostLink(link), onMouseLeave: clearHostLink }
    : {};
  const face = (
    <div className={`relative rounded-[2px] ${lit ? 'host-link-lit' : ''}`} {...linkProps} data-testid={card.hostedOnId ? `on-host-${card.instanceId}` : undefined}>
      <CardView
        card={card}
        size="fit"
        onInspect={onInspect}
        typeIcons={breaks}
        tag={
          card.hostedOnId ? (
            <div
              data-tip={`Hosted on ${hostLabel ?? 'another card'}`}
              className="pointer-events-auto max-w-full min-w-0 flex items-center gap-[0.2em] rounded bg-pink-950/95 border border-pink-500 px-[0.2em] text-[0.8em] leading-[1.3em] font-bold text-pink-100"
            >
              <Link2 className="w-[1.1em] h-[1.1em] shrink-0" />
              <span className="truncate">{hostLabel ? `On ${hostLabel}` : 'Hosted'}</span>
            </div>
          ) : undefined
        }
      />
    </div>
  );
  if (hosted.length === 0) return face;
  return (
    <div className="flex items-end gap-0.5 shrink-0" data-testid={`hosted-on-${card.instanceId}`}>
      {face}
      <div className="flex flex-col gap-0.5" title={`Hosted (${hosted.length})`}>
        {hosted.map(h => (
          <CardView key={h.instanceId} card={h} size="fit-sm" notInstalled onInspect={onInspect} isFaceDown={faceDown} canPeek={canSeeSecrets} typeIcons />
        ))}
      </div>
    </div>
  );
};

const Row: React.FC<{
  icon: React.ReactNode;
  label: string;
  color: string;
  cards: CardInstance[];
  onInspect?: (card: CardInstance) => void;
  hostLabel?: (card: CardInstance) => string | undefined;
  breaks?: (card: CardInstance) => IceSubtype[];
  className?: string;
  style?: React.CSSProperties;
  /** Compact inline chip used when a sibling bucket (Hardware/Resources) has cards and this one is empty. */
  compactEmpty?: boolean;
  canSeeSecrets?: boolean;
}> = ({ icon, label, color, cards, onInspect, hostLabel, breaks, className = '', style, compactEmpty = false, canSeeSecrets }) => {
  const empty = cards.length === 0;
  if (empty && compactEmpty) {
    return (
      <div className={`shrink-0 flex flex-col gap-0.5 ${className}`} style={style}>
        <div className={`flex items-center gap-1 text-[11px] font-mono font-bold uppercase tracking-wider ${color}`}>
          {icon}
          <span>
            {label} (0)
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center px-3 py-1.5 bg-black/30 rounded-[2px] border border-dashed border-slate-800/80 text-[11px] text-slate-600 italic whitespace-nowrap">
          None
        </div>
      </div>
    );
  }
  return (
    <div className={`min-w-0 flex flex-col gap-0.5 ${className}`} style={style}>
      <div className={`flex items-center gap-1 text-[11px] font-mono font-bold uppercase tracking-wider ${color}`}>
        {icon}
        <span>
          {label} ({cards.length})
        </span>
      </div>
      <div
        data-auto-fit-track={empty ? undefined : ''}
        className={`flex gap-1.5 p-1 bg-black/40 rounded-[2px] border border-slate-800/80 overflow-x-auto items-center ${
          empty ? 'min-h-[2rem]' : ''
        }`}
        style={empty ? undefined : { minHeight: 'calc(var(--card-h) + 0.5rem)' }}
      >
        {empty ? (
          <span className="text-[11px] text-slate-600 italic m-auto">None</span>
        ) : (
          cards.map(card => <RigCard key={card.instanceId} card={card} onInspect={onInspect} hostLabel={hostLabel?.(card)} breaks={breaks?.(card)} canSeeSecrets={canSeeSecrets} />)
        )}
      </div>
    </div>
  );
};

export const RigView: React.FC<RigViewProps> = ({ rig, onInspectCard, aside, hostLabel, breaks, canSeeSecrets, mirrored = false }) => {
  const hwCount = rig.hardware.length;
  const resCount = rig.resources.length;
  const bothPopulated = hwCount > 0 && resCount > 0;
  const programsRow = (
    <Row icon={<Cpu className="w-3 h-3" />} label="Programs" color="text-cyber-neonCyan" cards={rig.programs} onInspect={onInspectCard} hostLabel={hostLabel} breaks={breaks} canSeeSecrets={canSeeSecrets} />
  );
  const hwResRow = (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-2 min-w-0">
      <Row
        icon={<HardDrive className="w-3 h-3" />}
        label="Hardware"
        color="text-amber-400"
        cards={rig.hardware}
        onInspect={onInspectCard}
        hostLabel={hostLabel}
        canSeeSecrets={canSeeSecrets}
        compactEmpty={resCount > 0}
        className={bothPopulated ? 'w-full sm:basis-0' : hwCount === 0 && resCount > 0 ? 'w-full sm:w-auto' : 'w-full sm:flex-1'}
        style={bothPopulated ? { flexGrow: hwCount } : undefined}
      />
      <Row
        icon={<Users className="w-3 h-3" />}
        label="Resources"
        color="text-cyber-neonPink"
        cards={rig.resources}
        onInspect={onInspectCard}
        hostLabel={hostLabel}
        canSeeSecrets={canSeeSecrets}
        compactEmpty={hwCount > 0}
        className={bothPopulated ? 'w-full sm:basis-0' : resCount === 0 && hwCount > 0 ? 'w-full sm:w-auto' : 'w-full sm:flex-1'}
        style={bothPopulated ? { flexGrow: resCount } : undefined}
      />
    </div>
  );
  return (
    // Desktop: single row alongside aside, programs nearest the center line facing Corp ice, then hardware and resources sized to their contents.
    // Mobile (< sm): hardware and resources stack so neither gets squeezed on narrow screens.
    <div className="flex gap-2 min-w-0">
      {aside && (
        <div className="flex flex-col gap-0.5 shrink-0">
          {/* Match the top row heading + border/padding so the identity card top aligns flush with the top row cards */}
          <div className="text-[11px] font-mono font-bold uppercase tracking-wider invisible select-none" aria-hidden="true">
            &nbsp;
          </div>
          <div className="flex flex-col items-center gap-3 pt-[5px]">{aside}</div>
        </div>
      )}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        {mirrored ? (
          <>
            {hwResRow}
            {programsRow}
          </>
        ) : (
          <>
            {programsRow}
            {hwResRow}
          </>
        )}
      </div>
    </div>
  );
};
