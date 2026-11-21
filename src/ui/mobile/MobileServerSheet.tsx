import React from 'react';
import { ChevronRight, Crosshair, Eye, FolderOpen, Play, Shield } from 'lucide-react';
import {
  CardInstance,
  GameAction,
  GameState,
  cardDef,
  iceStrength,
  iceSubtypes,
  knownInRd,
} from '../../core';
import { canSeeCorpSecrets, canSeeRunnerSecrets, Viewer } from '../viewer';
import { IceTypeIcons } from '../components/IceTypeIcons';
import { useSeat } from '../seat';
import type { ZoneId } from '../components/ZoneViewer';
import { MobileBottomSheet } from './MobileBottomSheet';

interface MobileServerSheetProps {
  state: GameState;
  serverId: string | null;
  viewer: Viewer;
  runnerCanAct: boolean;
  actionableCardIds: ReadonlySet<string>;
  onAction: (action: GameAction) => void;
  onSelectCard: (card: CardInstance) => void;
  onOpenZone: (zone: ZoneId) => void;
  onClose: () => void;
}

/**
 * Tap-to-act bottom sheet for a Corp server: full-width Run button, pile browser shortcut,
 * and an ordered outermost-to-innermost list of every Ice and Root card protecting the server.
 */
export const MobileServerSheet: React.FC<MobileServerSheetProps> = ({
  state,
  serverId,
  viewer,
  runnerCanAct,
  actionableCardIds,
  onAction,
  onSelectCard,
  onOpenZone,
  onClose,
}) => {
  const seat = useSeat();
  const server = serverId ? state.corp.servers[serverId] : undefined;
  if (!server) return null;

  const corpVisible = canSeeCorpSecrets(viewer);
  const runAction: GameAction = { type: 'INITIATE_RUN', player: 'runner', targetServerId: server.id };
  const canRun = runnerCanAct && seat.can(runAction);

  const archivesCount = state.corp.archives.faceUp.length + state.corp.archives.faceDown.length;
  const rdSeenCount = canSeeRunnerSecrets(viewer) ? knownInRd(state).length : 0;
  const canBrowseRd = server.id === 'rd' && (Boolean(state.winner) || rdSeenCount > 0);
  const canBrowseArchives = server.id === 'archives';

  // List ice outermost first (approach order during a run)
  const iceApproachOrder = [...server.ice].map((ice, idx) => ({ ice, pos: idx + 1 })).reverse();

  const subtitle = [
    `${server.ice.length} ice`,
    server.root.length > 0 ? `${server.root.length} in root` : null,
    server.id === 'rd' ? `${state.corp.rd.length} in R&D` : null,
    server.id === 'hq' ? `${state.corp.hq.length} in HQ` : null,
    server.id === 'archives' ? `${archivesCount} in Archives` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const footer =
    canRun || canBrowseArchives || canBrowseRd ? (
      <div className="w-full flex flex-wrap gap-2">
        {canBrowseArchives && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenZone('archives');
            }}
            className="flex-1 min-w-[130px] h-11 px-3 rounded-[3px] bg-slate-900 active:bg-slate-800 border border-slate-600 text-slate-100 font-bold text-xs inline-flex items-center justify-center gap-1.5"
          >
            <FolderOpen className="w-4 h-4 text-cyan-400" /> Browse Archives ({archivesCount})
          </button>
        )}
        {canBrowseRd && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenZone('rd');
            }}
            className="flex-1 min-w-[130px] h-11 px-3 rounded-[3px] bg-slate-900 active:bg-slate-800 border border-amber-600/80 text-amber-200 font-bold text-xs inline-flex items-center justify-center gap-1.5"
          >
            <Eye className="w-4 h-4 text-amber-400" />
            {state.winner ? `Browse R&D (${state.corp.rd.length})` : `Seen in R&D (${rdSeenCount})`}
          </button>
        )}
        {canRun && (
          <button
            type="button"
            data-testid={`mobile-run-${server.id}`}
            onClick={() => {
              onAction(runAction);
              onClose();
            }}
            className="flex-1 min-w-[150px] h-11 px-4 rounded-[3px] bg-gradient-to-b from-pink-600 to-pink-700 text-white font-bold text-xs border border-pink-400 inline-flex items-center justify-center gap-1.5 shadow"
          >
            <Crosshair className="w-4 h-4" /> Run {server.name}
          </button>
        )}
      </div>
    ) : undefined;

  return (
    <MobileBottomSheet
      open
      title={server.name}
      subtitle={subtitle}
      accentClass="border-cyan-500/80"
      onClose={onClose}
      footer={footer}
      testId="mobile-server-sheet"
    >
      <div className="space-y-3 text-xs">
        {/* Ice Stack (Outermost -> Innermost) */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Protecting Ice {iceApproachOrder.length > 0 ? '(outermost → innermost)' : ''}
          </div>
          {iceApproachOrder.length === 0 ? (
            <div className="text-slate-500 italic py-1">Unprotected — no ice installed</div>
          ) : (
            <div className="space-y-1.5">
              {iceApproachOrder.map(({ ice, pos }) => {
                const known = ice.isRezzed || corpVisible || Boolean(ice.runnerKnows);
                const def = known ? cardDef(ice) : null;
                const subtypes = ice.isRezzed ? iceSubtypes(ice, state) : [];
                const str = ice.isRezzed ? iceStrength(state, ice) : null;
                const actionable = actionableCardIds.has(ice.instanceId);
                return (
                  <button
                    key={ice.instanceId}
                    type="button"
                    onClick={() => onSelectCard(ice)}
                    className={`w-full min-h-[44px] px-2.5 py-2 rounded-[3px] border text-left flex items-center justify-between gap-2 ${
                      actionable
                        ? 'border-amber-400/90 bg-amber-950/30'
                        : ice.isRezzed
                          ? 'border-cyan-700/80 bg-[#0b1927]'
                          : 'border-slate-700 border-dashed bg-slate-950/70'
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 font-bold shrink-0">#{pos}</span>
                      {ice.isRezzed && subtypes.length > 0 ? (
                        <IceTypeIcons types={subtypes} side="ice" row className="text-[7.5px] shrink-0" />
                      ) : (
                        <Shield className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <span className={`font-bold truncate ${ice.isRezzed ? 'text-cyan-100' : 'text-slate-300 italic'}`}>
                        {def ? def.title : 'Unrezzed Ice'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!ice.isRezzed && !corpVisible && ice.runnerKnows && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 text-[10px] font-bold">Seen</span>
                      )}
                      {ice.advancementCounters > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-200 text-[10px] font-bold">
                          {ice.advancementCounters} adv
                        </span>
                      )}
                      {str !== null && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-cyan-800 text-cyan-200 text-[10px] font-bold">
                          Str {str}
                        </span>
                      )}
                      {actionable && <Play className="w-3.5 h-3.5 text-amber-400 fill-amber-400/30" />}
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Root Cards */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Server Root</div>
          {server.root.length === 0 ? (
            <div className="text-slate-500 italic py-1">No cards installed in root</div>
          ) : (
            <div className="space-y-1.5">
              {server.root.map(card => {
                const known = card.isRezzed || Boolean(card.faceUp) || corpVisible || Boolean(card.runnerKnows);
                const def = known ? cardDef(card) : null;
                const actionable = actionableCardIds.has(card.instanceId);
                return (
                  <button
                    key={card.instanceId}
                    type="button"
                    onClick={() => onSelectCard(card)}
                    className={`w-full min-h-[44px] px-2.5 py-2 rounded-[3px] border text-left flex items-center justify-between gap-2 ${
                      actionable
                        ? 'border-amber-400/90 bg-amber-950/30'
                        : card.isRezzed
                          ? 'border-cyan-700/80 bg-[#0b1927]'
                          : 'border-slate-700 border-dashed bg-slate-950/70'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className={`font-bold truncate ${card.isRezzed ? 'text-slate-100' : 'text-slate-300 italic'}`}>
                        {def ? def.title : 'Face-down Card'}
                      </div>
                      {def && (
                        <div className="text-[10px] text-slate-400 capitalize">
                          {def.type_code}
                          {!card.isRezzed ? (corpVisible ? ' · Unrezzed' : ' · Seen') : ''}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {card.advancementCounters > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-200 text-[10px] font-bold">
                          {card.advancementCounters} adv
                        </span>
                      )}
                      {actionable && <Play className="w-3.5 h-3.5 text-amber-400 fill-amber-400/30" />}
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </MobileBottomSheet>
  );
};
