import React, { useMemo } from 'react';
import { Eye, Play, Shield } from 'lucide-react';
import {
  CardInstance,
  GameState,
  ServerState,
  cardDef,
  iceStrength,
  iceSubtypes,
  knownInRd,
  rezCostOf,
} from '../../core';
import type { Seat } from '../seatLegality';
import { canSeeCorpSecrets, canSeeRunnerSecrets, Viewer } from '../viewer';
import { AdvancementIcon, AgendaIcon, CreditIcon, PowerIcon, VirusIcon } from '../components/CreditIcon';
import { IceTypeIcons } from '../components/IceTypeIcons';
import {
  useBoardCardTarget,
  useBoardServerTarget,
  usePromptHighlight,
  usePromptServerHighlight,
} from '../promptHighlight';
import type { ZoneId } from '../components/ZoneViewer';
import { MobileSideStatus } from './MobileHud';
import { ScrollEdgeContainer } from '../components/ScrollEdgeCue';

const CENTRAL_ORDER = ['hq', 'rd', 'archives'];

interface MobileCorpBoardProps {
  gameState: GameState;
  seat: Seat;
  viewer: Viewer;
  runnerCanAct: boolean;
  actionableCardIds: ReadonlySet<string>;
  mirrored: boolean;
  onTapCard: (card: CardInstance) => void;
  onTapServer: (serverId: string) => void;
  onOpenZone: (zone: ZoneId) => void;
}

/** Compact counter badges matching desktop counter iconography on mobile root/ice tiles. */
function CardTokenBadges({ card, knownToViewer }: { card: CardInstance; knownToViewer: boolean }) {
  const def = knownToViewer ? cardDef(card) : null;
  const tokens = card.tokens ?? {};
  const hasAny =
    card.advancementCounters > 0 ||
    (tokens.credit ?? 0) > 0 ||
    (tokens.virus ?? 0) > 0 ||
    (tokens.power ?? 0) > 0 ||
    (tokens.agenda ?? 0) > 0;
  if (!hasAny) return null;

  return (
    <>
      {card.advancementCounters > 0 && (
        <span className="px-1 rounded bg-amber-950/90 border border-amber-600/70 text-amber-200 inline-flex items-center gap-0.5">
          <AdvancementIcon className="w-2.5 h-2.5 text-amber-400" />
          {def?.type_code === 'agenda' && def.advancement_cost
            ? `${card.advancementCounters}/${def.advancement_cost}`
            : card.advancementCounters}
        </span>
      )}
      {(tokens.credit ?? 0) > 0 && (
        <span className="px-1 rounded bg-amber-950/80 border border-amber-700/70 text-amber-200 inline-flex items-center gap-0.5">
          <CreditIcon className="w-2.5 h-2.5 text-amber-400" />
          {tokens.credit}
        </span>
      )}
      {(tokens.virus ?? 0) > 0 && (
        <span className="px-1 rounded bg-lime-950/90 border border-lime-700/70 text-lime-200 inline-flex items-center gap-0.5">
          <VirusIcon className="w-2.5 h-2.5 text-lime-400" />
          {tokens.virus}
        </span>
      )}
      {(tokens.power ?? 0) > 0 && (
        <span className="px-1 rounded bg-purple-950/90 border border-purple-600/70 text-purple-200 inline-flex items-center gap-0.5">
          <PowerIcon className="w-2.5 h-2.5 text-purple-300" />
          {tokens.power}
        </span>
      )}
      {(tokens.agenda ?? 0) > 0 && (
        <span className="px-1 rounded bg-cyan-950/90 border border-cyan-600/70 text-cyan-200 inline-flex items-center gap-0.5">
          <AgendaIcon className="w-2.5 h-2.5 text-cyan-300" />
          {tokens.agenda}
        </span>
      )}
    </>
  );
}

const MobileIceStrip: React.FC<{
  ice: CardInstance;
  state: GameState;
  viewer: Viewer;
  isActiveEncounter: boolean;
  isActionable: boolean;
  hostedCount: number;
  onTap: () => void;
}> = ({ ice, state, viewer, isActiveEncounter, isActionable, hostedCount, onTap }) => {
  const boardTarget = useBoardCardTarget(ice.instanceId);
  const highlight = usePromptHighlight(ice.instanceId);
  const corpVisible = canSeeCorpSecrets(viewer);
  const knownToViewer = ice.isRezzed || Boolean(ice.faceUp) || corpVisible || Boolean(ice.runnerKnows);
  const def = knownToViewer ? cardDef(ice) : null;
  const subtypes = knownToViewer ? iceSubtypes(ice, ice.isRezzed ? state : undefined) : [];
  const liveStr = ice.isRezzed ? iceStrength(state, ice) : null;
  const printedStr = def?.strength ?? null;
  const strChanged = liveStr !== null && printedStr !== null && liveStr !== printedStr;
  const rez = !ice.isRezzed && corpVisible ? rezCostOf(state, ice) : null;

  const ringClass = boardTarget
    ? 'border-amber-400 ring-2 ring-amber-400/90 bg-amber-950/50 animate-pulse'
    : highlight.hovered
      ? 'border-amber-400 ring-2 ring-amber-400 bg-amber-950/40'
      : highlight.selected
        ? 'border-cyan-400 ring-2 ring-cyan-400 bg-cyan-950/50'
        : isActiveEncounter
          ? 'border-pink-400 ring-1 ring-pink-400 bg-pink-950/60'
          : isActionable
            ? 'border-amber-400/90 bg-[#101c2c] shadow-[0_0_8px_rgba(251,191,36,0.28)]'
            : ice.isRezzed
              ? 'border-cyan-600/80 bg-[#0b1b2b]'
              : 'border-slate-700/80 border-dashed bg-[#0a1019]';

  return (
    <button
      type="button"
      data-testid={`mobile-ice-${ice.instanceId}`}
      data-card-id={ice.instanceId}
      data-scroll-item-id={ice.instanceId}
      onClick={e => {
        e.stopPropagation();
        if (boardTarget) {
          boardTarget.onClick();
          return;
        }
        onTap();
      }}
      className={`w-full shrink-0 min-h-[26px] px-1 py-0.5 rounded-[2px] border text-left flex items-center justify-between gap-0.5 text-[9.5px] leading-tight transition-colors ${ringClass}`}
    >
      <div className="min-w-0 flex items-center gap-1 flex-1">
        {isActiveEncounter && <span className="text-pink-400 font-bold shrink-0">▶</span>}
        {subtypes.length > 0 && (
          <IceTypeIcons
            types={subtypes}
            side="ice"
            row
            className={`text-[6.5px] shrink-0 ${ice.isRezzed ? '' : 'opacity-75'}`}
          />
        )}
        {!ice.isRezzed && !knownToViewer && <Shield className="w-3 h-3 text-slate-500 shrink-0" />}
        <span
          className={`truncate font-semibold ${
            ice.isRezzed
              ? 'text-cyan-100'
              : knownToViewer
                ? 'text-slate-300 italic'
                : 'text-slate-400'
          }`}
        >
          {def ? def.title : 'Unrezzed'}
        </span>
      </div>

      <div className="flex items-center gap-0.5 shrink-0 font-bold text-[9px]">
        {!ice.isRezzed && !ice.faceUp && !corpVisible && ice.runnerKnows && (
          <span className="px-1 rounded bg-slate-800 text-amber-300">Seen</span>
        )}
        <CardTokenBadges card={ice} knownToViewer={knownToViewer} />
        {hostedCount > 0 && (
          <span className="px-1 rounded bg-pink-950/90 border border-pink-600/70 text-pink-200">
            +{hostedCount}
          </span>
        )}
        {liveStr !== null && (
          <span
            className={`px-1 rounded border text-[9.5px] ${
              strChanged
                ? liveStr > (printedStr ?? 0)
                  ? 'bg-emerald-950 border-emerald-500 text-emerald-200'
                  : 'bg-amber-950 border-amber-500 text-amber-200'
                : 'bg-slate-900 border-cyan-800 text-cyan-200'
            }`}
          >
            {liveStr}
          </span>
        )}
        {rez !== null && (
          <span className="px-1 rounded bg-slate-900 border border-slate-700 text-slate-300 text-[9px]">
            {rez}¢
          </span>
        )}
        {isActionable && <Play className="w-2.5 h-2.5 text-amber-400 fill-amber-400/30 shrink-0" />}
      </div>
    </button>
  );
};

const MobileRootTile: React.FC<{
  card: CardInstance;
  viewer: Viewer;
  isActionable: boolean;
  onTap: () => void;
}> = ({ card, viewer, isActionable, onTap }) => {
  const boardTarget = useBoardCardTarget(card.instanceId);
  const highlight = usePromptHighlight(card.instanceId);
  const corpVisible = canSeeCorpSecrets(viewer);
  const knownToViewer = card.isRezzed || Boolean(card.faceUp) || corpVisible || Boolean(card.runnerKnows);
  const def = knownToViewer ? cardDef(card) : null;
  const tokens = card.tokens ?? {};
  const hasCounters =
    card.advancementCounters > 0 ||
    (tokens.credit ?? 0) > 0 ||
    (tokens.virus ?? 0) > 0 ||
    (tokens.power ?? 0) > 0 ||
    (tokens.agenda ?? 0) > 0;

  const ringClass = boardTarget
    ? 'border-amber-400 ring-2 ring-amber-400/90 bg-amber-950/50 animate-pulse'
    : highlight.hovered
      ? 'border-amber-400 ring-2 ring-amber-400 bg-amber-950/40'
      : highlight.selected
        ? 'border-cyan-400 ring-2 ring-cyan-400 bg-cyan-950/50'
        : isActionable
          ? 'border-amber-400/90 bg-[#141e2e] shadow-[0_0_8px_rgba(251,191,36,0.28)]'
          : card.isRezzed
            ? 'border-cyan-700/80 bg-[#0c1a28]'
            : 'border-slate-700/80 border-dashed bg-[#0a1019]';

  return (
    <button
      type="button"
      data-testid={`mobile-root-${card.instanceId}`}
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
      className={`w-full shrink-0 min-h-[36px] px-1.5 py-1 rounded-[3px] border text-left flex flex-col justify-between gap-0.5 text-[10px] leading-tight transition-colors ${ringClass}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={`font-bold line-clamp-2 ${
            card.isRezzed
              ? 'text-slate-100'
              : knownToViewer
                ? 'text-slate-300 italic'
                : 'text-slate-400'
          }`}
        >
          {def ? def.title : 'Face-down'}
        </span>
        {isActionable && <Play className="w-2.5 h-2.5 text-amber-400 fill-amber-400/30 shrink-0 mt-0.5" />}
      </div>
      {(hasCounters || (!card.isRezzed && !corpVisible && card.runnerKnows) || (def && !card.isRezzed && corpVisible)) && (
        <div className="flex items-center flex-wrap gap-1 text-[9px] font-bold">
          {!card.isRezzed && !corpVisible && card.runnerKnows && (
            <span className="px-1 rounded bg-slate-800 text-amber-300">Seen</span>
          )}
          {!card.isRezzed && corpVisible && def && (
            <span className="text-slate-400 capitalize">{def.type_code}</span>
          )}
          <CardTokenBadges card={card} knownToViewer={knownToViewer} />
        </div>
      )}
    </button>
  );
};

const MobileServerColumn: React.FC<{
  server: ServerState;
  state: GameState;
  viewer: Viewer;
  canRun: boolean;
  actionableCardIds: ReadonlySet<string>;
  mirrored: boolean;
  hostedByIceId: Map<string, number>;
  onTapCard: (card: CardInstance) => void;
  onTapServer: (serverId: string) => void;
}> = ({ server, state, viewer, canRun, actionableCardIds, mirrored, hostedByIceId, onTapCard, onTapServer }) => {
  const serverTarget = useBoardServerTarget(server.id);
  const serverHovered = usePromptServerHighlight(server.id);
  const { corp, activeRun } = state;
  const isRunTarget = activeRun?.server === server.id;
  const runIceId =
    isRunTarget && activeRun && (activeRun.phase === 'approach_ice' || activeRun.phase === 'encounter_ice' || activeRun.phase === 'movement')
      ? (activeRun.encounter?.iceId ??
        (activeRun.icePosition !== null && !activeRun.positionEmpty
          ? server.ice[activeRun.icePosition]?.instanceId
          : undefined))
      : undefined;
  const rdSeen = server.id === 'rd' && canSeeRunnerSecrets(viewer) ? knownInRd(state).length : 0;

  const shortName =
    server.id === 'archives'
      ? 'ARCH'
      : server.id === 'rd'
        ? 'R&D'
        : server.id === 'hq'
          ? 'HQ'
          : server.name.replace(/^Remote\s+(?:Server\s+)?/i, 'R');

  const pileCount =
    server.id === 'archives'
      ? corp.archives.faceUp.length + corp.archives.faceDown.length
      : server.id === 'rd'
        ? corp.rd.length
        : server.id === 'hq'
          ? corp.hq.length
          : null;

  // Ice ordering: index 0 is innermost (closest to root), last index is outermost (facing Runner).
  // When Corp is on top (`!mirrored`): render root at top, then ice from innermost (0) down to outermost (len-1).
  // When Corp is on bottom (`mirrored`): render ice from outermost (len-1) down to innermost (0), then root anchored at bottom.
  const orderedIce = mirrored
    ? [...server.ice].map((ice, idx) => ({ ice, idx })).reverse()
    : server.ice.map((ice, idx) => ({ ice, idx }));

  const serverHeader = (
    <button
      type="button"
      data-testid={`mobile-server-${server.id}`}
      onClick={e => {
        e.stopPropagation();
        if (serverTarget) {
          serverTarget.onClick();
          return;
        }
        onTapServer(server.id);
      }}
      className={`w-full shrink-0 min-h-[26px] px-1.5 py-1 rounded-[2px] border text-[10px] font-bold flex items-center justify-between gap-1 transition-colors ${
        serverTarget
          ? 'border-amber-400 bg-amber-950/60 text-amber-200 ring-1 ring-amber-400'
          : isRunTarget
            ? 'border-pink-500 bg-pink-950/70 text-pink-200'
            : canRun
              ? 'border-cyan-700/90 bg-[#0d1d2d] text-cyan-200 active:bg-cyan-950'
              : 'border-slate-700/80 bg-[#0c1420] text-slate-200'
      }`}
    >
      <span className="truncate font-cyber tracking-wide">
        {shortName}
        {pileCount !== null && <span className="ml-1 font-mono text-slate-400 font-normal">{pileCount}</span>}
      </span>
      <span className="flex items-center gap-0.5 shrink-0">
        {rdSeen > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-300" title={`${rdSeen} known in R&D`}>
            <Eye className="w-2.5 h-2.5" />
            {rdSeen}
          </span>
        )}
        {canRun && <span className="px-1 rounded bg-pink-950/90 border border-pink-600/80 text-pink-300 text-[8.5px]">RUN</span>}
      </span>
    </button>
  );

  const rootTiles = server.root.map(card => (
    <MobileRootTile
      key={card.instanceId}
      card={card}
      viewer={viewer}
      isActionable={actionableCardIds.has(card.instanceId)}
      onTap={() => onTapCard(card)}
    />
  ));

  const iceStrips = orderedIce.map(({ ice }) => (
    <MobileIceStrip
      key={ice.instanceId}
      ice={ice}
      state={state}
      viewer={viewer}
      isActiveEncounter={runIceId === ice.instanceId}
      isActionable={actionableCardIds.has(ice.instanceId)}
      hostedCount={hostedByIceId.get(ice.instanceId) ?? 0}
      onTap={() => onTapCard(ice)}
    />
  ));

  const columnItemSigs = useMemo(() => {
    const map = new Map<string, string>();
    for (const ice of server.ice) map.set(ice.instanceId, '1');
    for (const card of server.root) map.set(card.instanceId, '1');
    return map;
  }, [server.ice, server.root]);

  return (
    <div
      data-testid={`server-${server.id}`}
      data-scroll-item-id={server.id}
      className={`h-full min-h-0 overflow-hidden flex-1 min-w-[82px] flex flex-col gap-1 p-1 rounded-[3px] border bg-[#080f18]/90 ${
        serverTarget || serverHovered
          ? 'border-amber-400 ring-1 ring-amber-400/70'
          : isRunTarget
            ? 'border-pink-500/90 shadow-[0_0_12px_rgba(236,72,153,0.22)]'
            : 'border-cyan-950/90'
      }`}
    >
      {!mirrored && serverHeader}
      {/* Note: never put justify-end on an overflow-y-auto flex column — it overflows above scrollTop=0 unreachably.
          Putting mt-auto on the inner stack anchors to bottom when it fits and scrolls cleanly from 0 when taller.
          Use overflow-x-hidden + overscroll-y-contain (never overscroll-contain) so horizontal swipes chain to the parent server row. */}
      <ScrollEdgeContainer
        axis="y"
        tone="corp"
        itemSignatures={columnItemSigs}
        className="flex-1"
        scrollClassName="flex flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain"
        testId={`mobile-server-scroll-${server.id}`}
      >
        <div className={`flex flex-col gap-1 shrink-0 ${mirrored ? 'mt-auto' : ''}`}>
          {mirrored ? (
            <>
              {iceStrips}
              {rootTiles}
            </>
          ) : (
            <>
              {rootTiles}
              {iceStrips}
            </>
          )}
        </div>
      </ScrollEdgeContainer>
      {mirrored && serverHeader}
    </div>
  );
};

/**
 * Compact mobile Corp tabletop half: 1-row status strip + tight server columns (~82px min,
 * so Archives + R&D + HQ + 1 Remote fit with zero horizontal scroll on phones) with 26px ice strips.
 */
export const MobileCorpBoard: React.FC<MobileCorpBoardProps> = ({
  gameState,
  seat,
  viewer,
  runnerCanAct,
  actionableCardIds,
  mirrored,
  onTapCard,
  onTapServer,
  onOpenZone,
}) => {
  const { corp, runner } = gameState;
  const servers = useMemo(
    () =>
      Object.values(corp.servers).sort(
        (a, b) => CENTRAL_ORDER.indexOf(b.id) - CENTRAL_ORDER.indexOf(a.id),
      ),
    [corp.servers],
  );

  // Track both newly created servers AND cards installed into an already-offscreen server
  const serverItemSigs = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of servers) {
      map.set(
        s.id,
        `${s.ice.map(i => i.instanceId).join(',')}|${s.root.map(r => r.instanceId).join(',')}`,
      );
    }
    return map;
  }, [servers]);

  // Count Runner trojans/hosted cards sitting on each piece of Corp ice
  const hostedByIceId = new Map<string, number>();
  for (const c of [...runner.rig.programs, ...runner.rig.hardware, ...runner.rig.resources]) {
    if (c.hostedOnId) hostedByIceId.set(c.hostedOnId, (hostedByIceId.get(c.hostedOnId) ?? 0) + 1);
  }

  const statusBar = (
    <MobileSideStatus
      side="corp"
      edge={mirrored ? 'bottom' : 'top'}
      state={gameState}
      viewer={viewer}
      idActionable={actionableCardIds.has(corp.identity.instanceId)}
      onInspect={onTapCard}
      onOpenZone={onOpenZone}
    />
  );

  return (
    <section
      id="corp-board"
      data-testid="mobile-corp-board"
      className="flex-[54] min-h-0 min-w-0 flex flex-col bg-[#060c14] border border-cyan-950/90 rounded-[3px] overflow-hidden"
    >
      {!mirrored && statusBar}
      <ScrollEdgeContainer
        axis="x"
        tone="corp"
        itemSignatures={serverItemSigs}
        className="flex-1"
        scrollClassName="flex items-stretch gap-1 p-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
        testId="mobile-corp-servers"
      >
        {servers.map(server => (
          <MobileServerColumn
            key={server.id}
            server={server}
            state={gameState}
            viewer={viewer}
            canRun={
              runnerCanAct &&
              seat.can({ type: 'INITIATE_RUN', player: 'runner', targetServerId: server.id })
            }
            actionableCardIds={actionableCardIds}
            mirrored={mirrored}
            hostedByIceId={hostedByIceId}
            onTapCard={onTapCard}
            onTapServer={onTapServer}
          />
        ))}
      </ScrollEdgeContainer>
      {mirrored && statusBar}
    </section>
  );
};
