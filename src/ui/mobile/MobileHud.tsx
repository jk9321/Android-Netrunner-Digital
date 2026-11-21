import React from 'react';
import { FastForward, Hand, Menu, SkipForward, Wifi, WifiOff } from 'lucide-react';
import { CardInstance, GameState, SideCode, cardDef, knownInHand } from '../../core';
import { AgendaDiamondIcon, BadPublicityIcon, ClickIcon, CoreDamageIcon, CreditIcon, MuIcon, TagIcon } from '../components/CreditIcon';
import { StatTumbler } from '../components/StatTumbler';
import { PersonStops, STOP_LABELS, nextStops } from '../stops';
import type { OnlineInfo } from '../useOnlineController';
import { canSeeCorpSecrets, canSeeRunnerSecrets, Viewer } from '../viewer';
import { runCreditPools } from '../liveValues';
import type { ZoneId } from '../components/ZoneViewer';

interface MobileTopBarProps {
  state: GameState;
  online: OnlineInfo | null;
  aiThinking: boolean;
  stops: PersonStops;
  onStops: (level: PersonStops) => void;
  onOpenMenu: () => void;
  onOpenZone: (zone: ZoneId) => void;
}

/** Slim top bar (~44px + safe-area-top) for the mobile app shell: menu, scores, turn/clicks, stops, online indicator. */
export const MobileTopBar: React.FC<MobileTopBarProps> = ({
  state,
  online,
  aiThinking,
  stops,
  onStops,
  onOpenMenu,
  onOpenZone,
}) => {
  const { corp, runner, activePlayer, turnNumber, winner } = state;
  const activeClicks = activePlayer === 'corp' ? `${corp.clicks}/3` : `${runner.clicks}/4`;
  const onlineConnected = online?.status === 'open';

  return (
    <header
      data-testid="mobile-top-bar"
      className="shrink-0 pt-[env(safe-area-inset-top)] bg-gradient-to-b from-[#0d121c] to-[#06090e] border-b border-slate-800 shadow-lg z-30"
    >
      <div className="h-11 px-2 flex items-center justify-between gap-1.5">
        {/* Menu Trigger */}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open game menu"
          data-testid="mobile-menu-button"
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-[2px] bg-slate-900 active:bg-slate-800 border border-slate-700 text-slate-200"
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Tappable Agenda Score Pill */}
        <div className="flex items-center gap-1 bg-[#04070c] border border-slate-800 rounded-[2px] px-1 py-0.5 shrink-0">
          <button
            type="button"
            data-testid="header-corp-score"
            onClick={() => onOpenZone('corp-score')}
            aria-label="Browse Corp score area"
            className="flex items-center gap-1 px-2 h-7 rounded-[2px] bg-cyan-950/80 border border-cyan-800/80 text-cyan-200 text-xs font-bold"
          >
            <AgendaDiamondIcon className="w-3 h-3 text-cyan-400" />
            <StatTumbler value={corp.score} />
          </button>
          <span className="text-[10px] text-slate-600 font-bold uppercase px-0.5">vs</span>
          <button
            type="button"
            data-testid="header-runner-score"
            onClick={() => onOpenZone('runner-score')}
            aria-label="Browse Runner score area"
            className="flex items-center gap-1 px-2 h-7 rounded-[2px] bg-pink-950/80 border border-pink-800/80 text-pink-200 text-xs font-bold"
          >
            <AgendaDiamondIcon className="w-3 h-3 text-pink-400" />
            <StatTumbler value={runner.score} />
          </button>
        </div>

        {/* Turn / Clicks + Online Status + Stops Toggle */}
        <div className="flex items-center gap-1 min-w-0">
          {online && (
            <span
              data-testid="online-connection"
              className={`shrink-0 p-1 ${onlineConnected ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}
              title={onlineConnected ? `Online · ${online.code}` : 'Reconnecting…'}
            >
              {onlineConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            </span>
          )}
          {!winner && (
            <span
              className={`px-1.5 h-7 inline-flex items-center gap-1 rounded-[2px] border text-[11px] font-bold whitespace-nowrap ${
                activePlayer === 'corp'
                  ? 'border-cyan-700/80 bg-cyan-950/50 text-cyan-300'
                  : 'border-pink-700/80 bg-pink-950/50 text-pink-300'
              }`}
            >
              <span>T{turnNumber}</span>
              <span className="opacity-60">·</span>
              <span className="inline-flex items-center gap-0.5">
                {activeClicks}
                <ClickIcon className="w-3 h-3 text-red-400" />
              </span>
            </span>
          )}
          <button
            type="button"
            data-testid="stops-toggle"
            onClick={() => onStops(nextStops(stops))}
            aria-label={`Stops: ${stops}`}
            title={STOP_LABELS[stops].title}
            className={`shrink-0 h-7 px-1.5 rounded-[2px] border text-[10px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
              aiThinking
                ? 'border-amber-500 text-amber-300 animate-pulse'
                : stops === 'full'
                  ? 'border-cyan-500 text-cyan-300'
                  : stops === 'none'
                    ? 'border-amber-700 text-amber-400'
                    : 'border-slate-700 text-slate-300'
            }`}
          >
            {aiThinking ? (
              <span data-testid="ai-status">AI…</span>
            ) : (
              <>
                {stops === 'full' ? <Hand className="w-3 h-3" /> : stops === 'none' ? <SkipForward className="w-3 h-3" /> : <FastForward className="w-3 h-3" />}
                <span>{STOP_LABELS[stops].short}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

interface MobileSideStatusProps {
  side: SideCode;
  edge: 'top' | 'bottom';
  state: GameState;
  viewer: Viewer;
  /** True when the side's identity currently has a legal paid/click ability. */
  idActionable?: boolean;
  onInspect: (card: CardInstance) => void;
  onOpenZone: (zone: ZoneId) => void;
}

/** Ultra-compact 1-row player status strip for mobile halves (ID, credits, MU/tags/BP, opponent hand, Stack/Heap/Archives). */
export const MobileSideStatus: React.FC<MobileSideStatusProps> = ({
  side,
  edge,
  state,
  viewer,
  idActionable = false,
  onInspect,
  onOpenZone,
}) => {
  const isCorp = side === 'corp';
  const player = isCorp ? state.corp : state.runner;
  const { corp, runner } = state;
  const pools = runCreditPools(state);
  const showOppHand = isCorp ? !canSeeCorpSecrets(viewer) : !canSeeRunnerSecrets(viewer);
  const handCount = isCorp ? corp.hq.length : runner.grip.length;
  const handLimit = player.handSizeLimit;
  const knownCount = showOppHand ? knownInHand(state, side).length : 0;
  const archivesCount = corp.archives.faceUp.length + corp.archives.faceDown.length;
  const isTurn = !state.winner && state.activePlayer === side;

  const borderClass =
    edge === 'top'
      ? `border-b ${isCorp ? 'border-cyan-950 bg-[#08101a]' : 'border-pink-950 bg-[#130910]'}`
      : `border-t ${isCorp ? 'border-cyan-950 bg-[#08101a]' : 'border-pink-950 bg-[#130910]'}`;
  const statClass = isCorp
    ? 'bg-cyan-950/80 border-cyan-800/80 text-cyan-200'
    : 'bg-pink-950/80 border-pink-800/80 text-pink-200';

  return (
    <div
      data-testid={`mobile-status-${side}`}
      className={`shrink-0 px-2 py-1 flex items-center justify-between gap-1.5 text-[11px] font-mono ${borderClass}`}
    >
      <button
        type="button"
        onClick={() => onInspect(player.identity)}
        className={`flex items-center gap-1 min-w-0 text-left rounded-[2px] px-1 -mx-1 ${
          idActionable ? 'ring-1 ring-amber-400/90 bg-amber-950/40' : ''
        }`}
        title={`Inspect ${cardDef(player.identity).title}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isTurn ? (isCorp ? 'bg-cyan-400 animate-pulse' : 'bg-pink-400 animate-pulse') : 'bg-slate-700'
          }`}
          aria-hidden="true"
        />
        <span className={`font-cyber font-bold text-[10px] shrink-0 ${isCorp ? 'text-cyan-400' : 'text-pink-400'}`}>
          {isCorp ? 'CORP' : 'RUN'}
        </span>
        <span className="text-slate-200 font-semibold truncate max-w-[6.75rem]">
          {cardDef(player.identity).title}
        </span>
        {idActionable && <span className="text-amber-300 text-[10px] font-bold shrink-0">⚡</span>}
      </button>

      <div className="flex items-center gap-1 shrink-0">
        {/* Credits */}
        <span
          data-testid={`${side}-credits`}
          className={`px-1.5 h-6 inline-flex items-center gap-0.5 rounded-[2px] border font-bold ${statClass}`}
        >
          <CreditIcon className="w-3 h-3 text-amber-400" />
          <StatTumbler value={player.credits} />
          {!isCorp && (state.activeRun?.badPublicityCredits ?? 0) > 0 && (
            <span className="text-amber-300 text-[10px]">+{state.activeRun!.badPublicityCredits}</span>
          )}
          {isCorp && pools.corpRez && pools.corpRez.bonus > 0 && (
            <span className="text-emerald-300 text-[10px]">+{pools.corpRez.bonus}</span>
          )}
        </span>

        {/* MU (Runner) */}
        {!isCorp && (
          <span className="px-1.5 h-6 inline-flex items-center gap-0.5 rounded-[2px] border border-slate-700 bg-slate-900 text-cyan-300 font-bold">
            <MuIcon className="w-3 h-3 text-cyan-400" />
            {runner.memoryUnitsUsed}/{runner.memoryUnitsTotal}
          </span>
        )}

        {/* Tags (Runner, when > 0) */}
        {!isCorp && runner.tags > 0 && (
          <span className="px-1.5 h-6 inline-flex items-center gap-0.5 rounded-[2px] border border-red-600 bg-red-950/80 text-red-200 font-bold">
            <TagIcon className="w-3 h-3 text-red-400" />
            {runner.tags}
          </span>
        )}

        {/* Core Damage (Runner, when > 0) */}
        {!isCorp && runner.coreDamage > 0 && (
          <span className="px-1.5 h-6 inline-flex items-center gap-0.5 rounded-[2px] border border-red-700 bg-red-950/70 text-red-300 font-bold">
            <CoreDamageIcon className="w-3 h-3 text-red-400" />
            {runner.coreDamage}
          </span>
        )}

        {/* Bad Publicity (Corp, when > 0) */}
        {isCorp && corp.badPublicity > 0 && (
          <span className="px-1.5 h-6 inline-flex items-center gap-0.5 rounded-[2px] border border-amber-700 bg-amber-950/70 text-amber-300 font-bold">
            <BadPublicityIcon className="w-3 h-3 text-amber-400" />
            {corp.badPublicity}
          </span>
        )}

        {/* Opponent Hidden Hand Count */}
        {showOppHand && (
          <button
            type="button"
            data-testid={`hand-${side}`}
            onClick={knownCount > 0 ? () => onOpenZone(isCorp ? 'known-hq' : 'known-grip') : undefined}
            className={`px-1.5 h-6 inline-flex items-center gap-1 rounded-[2px] border font-bold ${
              !isCorp && handCount <= 1
                ? 'border-red-600 bg-red-950/70 text-red-200'
                : statClass
            }`}
            title={`${isCorp ? 'Corp HQ' : 'Runner Grip'}: ${handCount}/${handLimit}`}
          >
            <span>{isCorp ? 'HQ' : 'Grip'}</span>
            <span>{handCount}/{handLimit}</span>
            {knownCount > 0 && <span className="text-amber-300">({knownCount})</span>}
          </button>
        )}

        {/* Runner Stack Count (browsable once game ends) */}
        {!isCorp && (
          <button
            type="button"
            data-testid="pile-stack"
            onClick={state.winner ? () => onOpenZone('stack') : undefined}
            className="px-1.5 h-6 inline-flex items-center rounded-[2px] border border-slate-800 bg-slate-950 text-slate-400 font-semibold"
            title={`Stack: ${runner.stack.length} cards`}
          >
            Stk {runner.stack.length}
          </button>
        )}

        {/* Quick Discard Pile Link */}
        <button
          type="button"
          data-testid={isCorp ? 'pile-archives' : 'pile-heap'}
          onClick={() => onOpenZone(isCorp ? 'archives' : 'heap')}
          className="px-1.5 h-6 inline-flex items-center rounded-[2px] border border-slate-700 bg-slate-900 text-slate-300 font-semibold"
          title={isCorp ? 'Browse Archives' : 'Browse Heap'}
        >
          {isCorp ? `Arch ${archivesCount}` : `Heap ${runner.heap.length}`}
        </button>
      </div>
    </div>
  );
};
