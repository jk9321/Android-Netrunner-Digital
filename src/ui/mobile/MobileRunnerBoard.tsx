import React, { useMemo } from 'react';
import { Play } from 'lucide-react';
import {
  CardInstance,
  GameState,
  breakerStrength,
  cardDef,
  findCardAnywhere,
} from '../../core';
import { canSeeCorpSecrets, Viewer } from '../viewer';
import { CreditIcon, PowerIcon, VirusIcon } from '../components/CreditIcon';
import { IceTypeIcons, breakerTypes } from '../components/IceTypeIcons';
import { useBoardCardTarget, usePromptHighlight } from '../promptHighlight';
import type { ZoneId } from '../components/ZoneViewer';
import { MobileSideStatus } from './MobileHud';
import { ScrollEdgeContainer } from '../components/ScrollEdgeCue';

interface MobileRunnerBoardProps {
  gameState: GameState;
  viewer: Viewer;
  actionableCardIds: ReadonlySet<string>;
  mirrored: boolean;
  onTapCard: (card: CardInstance) => void;
  onOpenZone: (zone: ZoneId) => void;
}

function shortHostTag(state: GameState, card: CardInstance, viewer: Viewer): string | null {
  if (!card.hostedOnId) return null;
  const server = Object.values(state.corp.servers).find(s =>
    s.ice.some(i => i.instanceId === card.hostedOnId),
  );
  if (server) {
    const idx = server.ice.findIndex(i => i.instanceId === card.hostedOnId);
    const ice = server.ice[idx];
    const srv = server.id === 'archives' ? 'Arch' : server.id === 'rd' ? 'R&D' : server.id === 'hq' ? 'HQ' : server.name.replace(/^Remote\s+(?:Server\s+)?/i, 'R');
    const name =
      ice && (ice.isRezzed || ice.faceUp || ice.runnerKnows || canSeeCorpSecrets(viewer))
        ? cardDef(ice).title
        : `#${idx + 1}`;
    return `on ${srv} ${name}`;
  }
  const host = findCardAnywhere(state, card.hostedOnId);
  return host ? `on ${cardDef(host).title}` : null;
}

const MobileRigTile: React.FC<{
  card: CardInstance;
  state: GameState;
  viewer: Viewer;
  kind: 'program' | 'hardware' | 'resource';
  isActionable: boolean;
  onTap: () => void;
}> = ({ card, state, viewer, kind, isActionable, onTap }) => {
  const boardTarget = useBoardCardTarget(card.instanceId);
  const highlight = usePromptHighlight(card.instanceId);
  const def = cardDef(card);
  const breaks = kind === 'program' ? breakerTypes(card) : [];
  const liveStr = kind === 'program' && def.strength !== undefined ? breakerStrength(state, card) : null;
  const printedStr = def.strength ?? null;
  const strChanged = liveStr !== null && printedStr !== null && liveStr !== printedStr;
  const t = card.tokens ?? {};
  const hostTag = shortHostTag(state, card, viewer);

  const kindTone =
    kind === 'program'
      ? 'border-pink-700/80 bg-[#180c15]'
      : kind === 'hardware'
        ? 'border-cyan-800/80 bg-[#0b1622]'
        : 'border-purple-800/80 bg-[#140e20]';

  const ringClass = boardTarget
    ? 'border-amber-400 ring-2 ring-amber-400/90 bg-amber-950/50 animate-pulse'
    : highlight.hovered
      ? 'border-amber-400 ring-2 ring-amber-400 bg-amber-950/40'
      : highlight.selected
        ? 'border-cyan-400 ring-2 ring-cyan-400 bg-cyan-950/50'
        : isActionable
          ? 'border-amber-400/90 bg-[#1c1412] shadow-[0_0_8px_rgba(251,191,36,0.28)]'
          : kindTone;

  return (
    <button
      type="button"
      data-testid={`mobile-rig-${card.instanceId}`}
      data-card-id={card.instanceId}
      data-scroll-item-id={card.instanceId}
      onClick={e => {
        e.stopPropagation();
        if (boardTarget) {
          boardTarget.onClick();
          return;
        }
        onTap();
      }}
      className={`min-w-[84px] max-w-[126px] flex-1 basis-[86px] min-h-[42px] px-1.5 py-1 rounded-[3px] border text-left flex flex-col justify-between gap-0.5 text-[10px] leading-tight transition-colors ${ringClass}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-bold text-slate-100 line-clamp-2">{def.title}</span>
        {isActionable && <Play className="w-2.5 h-2.5 text-amber-400 fill-amber-400/30 shrink-0 mt-0.5" />}
      </div>

      <div className="flex items-center flex-wrap gap-1 text-[9px] font-bold">
        {breaks.length > 0 && <IceTypeIcons types={breaks} side="breaker" row className="text-[6.5px]" />}
        {liveStr !== null && (
          <span
            className={`px-1 rounded border ${
              strChanged
                ? liveStr > (printedStr ?? 0)
                  ? 'bg-emerald-950 border-emerald-500 text-emerald-200'
                  : 'bg-amber-950 border-amber-500 text-amber-200'
                : 'bg-slate-900 border-pink-800 text-pink-200'
            }`}
          >
            S{liveStr}
          </span>
        )}
        {kind === 'program' && (def.memory_cost ?? 0) > 0 && (
          <span className="text-cyan-300">{def.memory_cost}MU</span>
        )}
        {kind !== 'program' && (
          <span className={kind === 'hardware' ? 'text-cyan-400' : 'text-purple-300'}>
            {kind === 'hardware' ? 'HW' : 'RES'}
          </span>
        )}
        {(t.credit ?? 0) > 0 && (
          <span className="px-1 rounded bg-amber-950/80 border border-amber-700/70 text-amber-200 inline-flex items-center gap-0.5">
            <CreditIcon className="w-2.5 h-2.5 text-amber-400" />
            {t.credit}
          </span>
        )}
        {(t.virus ?? 0) > 0 && (
          <span className="px-1 rounded bg-lime-950/90 border border-lime-700/70 text-lime-200 inline-flex items-center gap-0.5">
            <VirusIcon className="w-2.5 h-2.5 text-lime-400" />
            {t.virus}
          </span>
        )}
        {(t.power ?? 0) > 0 && (
          <span className="px-1 rounded bg-purple-950/90 border border-purple-600/70 text-purple-200 inline-flex items-center gap-0.5">
            <PowerIcon className="w-2.5 h-2.5 text-purple-300" />
            {t.power}
          </span>
        )}
        {(card.hostedCards?.length ?? 0) > 0 && (
          <span className="px-1 rounded bg-slate-900 border border-slate-700 text-slate-200">
            +{card.hostedCards!.length}
          </span>
        )}
      </div>

      {hostTag && <div className="text-[9px] text-slate-400 truncate">{hostTag}</div>}
    </button>
  );
};

/**
 * Compact mobile Runner tabletop half: 1-row status strip + dense Program / Hardware & Resource
 * tile rows (Programs always sit closest to Corp ice; ID/Stack/Heap live in the status bar).
 */
export const MobileRunnerBoard: React.FC<MobileRunnerBoardProps> = ({
  gameState,
  viewer,
  actionableCardIds,
  mirrored,
  onTapCard,
  onOpenZone,
}) => {
  const { runner } = gameState;
  const { programs, hardware, resources } = runner.rig;
  const hwAndRes: { card: CardInstance; kind: 'hardware' | 'resource' }[] = [
    ...hardware.map(card => ({ card, kind: 'hardware' as const })),
    ...resources.map(card => ({ card, kind: 'resource' as const })),
  ];
  const isEmpty = programs.length === 0 && hwAndRes.length === 0;

  const statusBar = (
    <MobileSideStatus
      side="runner"
      edge={mirrored ? 'top' : 'bottom'}
      state={gameState}
      viewer={viewer}
      idActionable={actionableCardIds.has(runner.identity.instanceId)}
      onInspect={onTapCard}
      onOpenZone={onOpenZone}
    />
  );

  const programsBand = programs.length > 0 && (
    <div className="flex flex-wrap gap-1" data-testid="mobile-rig-programs">
      {programs.map(card => (
        <MobileRigTile
          key={card.instanceId}
          card={card}
          state={gameState}
          viewer={viewer}
          kind="program"
          isActionable={actionableCardIds.has(card.instanceId)}
          onTap={() => onTapCard(card)}
        />
      ))}
    </div>
  );

  const hwResBand = hwAndRes.length > 0 && (
    <div className="flex flex-wrap gap-1" data-testid="mobile-rig-support">
      {hwAndRes.map(({ card, kind }) => (
        <MobileRigTile
          key={card.instanceId}
          card={card}
          state={gameState}
          viewer={viewer}
          kind={kind}
          isActionable={actionableCardIds.has(card.instanceId)}
          onTap={() => onTapCard(card)}
        />
      ))}
    </div>
  );

  const rigItemSigs = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of programs) map.set(c.instanceId, '1');
    for (const c of hardware) map.set(c.instanceId, '1');
    for (const c of resources) map.set(c.instanceId, '1');
    return map;
  }, [programs, hardware, resources]);

  return (
    <section
      id="runner-board"
      data-testid="mobile-runner-board"
      className="flex-[46] min-h-0 min-w-0 flex flex-col bg-[#0d070c] border border-pink-950/90 rounded-[3px] overflow-hidden"
    >
      {mirrored && statusBar}
      <ScrollEdgeContainer
        axis="y"
        tone="runner"
        itemSignatures={rigItemSigs}
        className="flex-1"
        scrollClassName="overflow-x-hidden overflow-y-auto overscroll-y-contain p-1.5 flex flex-col gap-1.5"
        testId="mobile-runner-rig"
      >
        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500 italic">
            No rig cards installed
          </div>
        ) : mirrored ? (
          <>
            {hwResBand}
            {programsBand}
          </>
        ) : (
          <>
            {programsBand}
            {hwResBand}
          </>
        )}
      </ScrollEdgeContainer>
      {!mirrored && statusBar}
    </section>
  );
};
