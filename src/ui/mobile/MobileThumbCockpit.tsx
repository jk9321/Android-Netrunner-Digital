import React from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Eye, Layers, Play, Plus, ScrollText, X } from 'lucide-react';
import {
  CardInstance,
  GameAction,
  GameState,
  SideCode,
  cardDef,
  getCardScript,
  installedIce,
  trashableFirst,
  virusCountersInPlay,
} from '../../core';
import { runnerInstallCost } from '../../core/engine/actions/install';
import { playCost } from '../../core/engine/actions/play';
import { CreditIcon, Credits, TagIcon, VirusIcon } from '../components/CreditIcon';
import { WindowBar } from '../components/WindowBar';
import { showConfirm } from '../components/Dialog';
import { useSeat } from '../seat';
import type { RunnerInstallFlow } from '../components/ActionBars';

interface MobileThumbCockpitProps {
  state: GameState;
  side: SideCode | null;
  canAct: boolean;
  handCards: CardInstance[];
  handSizeLimit: number;
  selectedCardId: string | null;
  onSelectCard: (id: string | null) => void;
  onInspect: (card: CardInstance) => void;
  onAction: (action: GameAction) => void;
  handExpanded: boolean;
  onHandExpandedChange: (expanded: boolean) => void;
  /** Number of currently available card abilities / hosted actions / resource trashes. */
  abilityCount: number;
  /** True when the player has hosted/recurring credit toggles available in the options sheet. */
  hasCreditHolds?: boolean;
  onOpenAbilities: () => void;
  onOpenLog: () => void;
  hasUnreadLog: boolean;
  /** Opens the Corp install picker sheet when Corp taps Install on a selected hand card. */
  onOpenCorpInstall: () => void;
  runnerFlow: RunnerInstallFlow;
  aiThinking: boolean;
  /** Trimmer vertical chrome for short phone landscape viewports. */
  compact?: boolean;
}

const isPlayableType = (card: CardInstance | undefined) => !!card && ['operation', 'event'].includes(cardDef(card).type_code);

/**
 * Fixed bottom thumb cockpit for mobile phones:
 * 1. Contextual Play/Install bar when a hand card is selected
 * 2. 44px Action Pill Strip (+1¢, Draw, Purge/Untag, abilities chip, Log, End Turn)
 * 3. Peeking Hand Tray (~56px tucked showing titles + costs, expands smoothly upward on tap)
 */
export const MobileThumbCockpit: React.FC<MobileThumbCockpitProps> = ({
  state,
  side,
  canAct,
  handCards,
  handSizeLimit,
  selectedCardId,
  onSelectCard,
  onInspect,
  onAction,
  handExpanded,
  onHandExpandedChange,
  abilityCount,
  hasCreditHolds = false,
  onOpenAbilities,
  onOpenLog,
  hasUnreadLog,
  onOpenCorpInstall,
  runnerFlow,
  aiThinking,
  compact = false,
}) => {
  const seat = useSeat();
  const isCorp = side === 'corp';
  const isActiveTurn = side !== null && state.activePlayer === side && canAct;
  const startingCorpTurn = isCorp && state.turnStep?.kind === 'corp_turn_start';
  const selectedCard = selectedCardId ? handCards.find(c => c.instanceId === selectedCardId) : undefined;
  const overLimit = handCards.length > handSizeLimit;

  const endTurnAction: GameAction | null =
    side === 'corp'
      ? startingCorpTurn
        ? { type: 'START_TURN', player: 'corp' }
        : { type: 'END_TURN', player: 'corp' }
      : side === 'runner'
        ? { type: 'END_TURN', player: 'runner' }
        : null;

  const zeroClicks =
    (side === 'corp' && !startingCorpTurn && state.corp.clicks === 0) ||
    (side === 'runner' && state.runner.clicks === 0);

  // Selected card action computation (mirrors ActionBars without duplicating engine logic)
  const selectedAction = (() => {
    if (!selectedCard || !side || !isActiveTurn) return null;
    const def = cardDef(selectedCard);
    if (def.side_code !== side) return null;

    if (isPlayableType(selectedCard)) {
      const action: GameAction = { type: 'PLAY_OPERATION_OR_EVENT', player: side, cardInstanceId: selectedCard.instanceId };
      const live = playCost(state, selectedCard);
      const implemented = Boolean(getCardScript(selectedCard.cardCode)?.onPlay);
      return {
        label: implemented ? 'Play' : 'N/A',
        cost: live,
        disabled: !implemented || !seat.can(action),
        onClick: () => {
          onAction(action);
          onSelectCard(null);
          onHandExpandedChange(false);
        },
      };
    }

    if (side === 'corp') {
      return {
        label: 'Install…',
        cost: null,
        disabled: state.corp.clicks === 0,
        onClick: () => {
          onHandExpandedChange(false);
          onOpenCorpInstall();
        },
      };
    }

    // Runner installable (Program / Hardware / Resource)
    const onIce = Boolean(getCardScript(selectedCard.cardCode)?.installsOnIce);
    const live = runnerInstallCost(state, selectedCard);
    const normalAction: GameAction = { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: selectedCard.instanceId };
    const canNormal = onIce ? installedIce(state).some(i => seat.can({ ...normalAction, hostInstanceId: i.instanceId })) : seat.can(normalAction);
    const allTrashable = trashableFirst(state, selectedCard, null).map(c => c.instanceId);
    const firstIce = onIce ? installedIce(state)[0]?.instanceId : undefined;
    const needRoom =
      !canNormal &&
      allTrashable.length > 0 &&
      (!onIce || !!firstIce) &&
      seat.can({ ...normalAction, trashFirst: allTrashable, ...(firstIce ? { hostInstanceId: firstIce } : {}) });

    return {
      label: needRoom ? 'Free MU…' : onIce ? 'Install on Ice…' : 'Install',
      cost: live,
      disabled: !canNormal && !needRoom,
      onClick: () => {
        if (needRoom) {
          runnerFlow.setMakingRoom(selectedCard.instanceId);
          onHandExpandedChange(false);
          onOpenAbilities();
          return;
        }
        if (onIce) {
          runnerFlow.setPickingHost(selectedCard.instanceId);
          onHandExpandedChange(false);
          onOpenAbilities();
          return;
        }
        onAction(normalAction);
        onSelectCard(null);
        onHandExpandedChange(false);
      },
    };
  })();

  const handleCardTap = (card: CardInstance) => {
    if (selectedCardId === card.instanceId) {
      onSelectCard(null);
    } else {
      onHandExpandedChange(true);
      onSelectCard(card.instanceId);
    }
  };

  const accentBtn = isCorp
    ? 'bg-cyan-950/85 active:bg-cyan-900 border-cyan-700/80 text-cyan-100'
    : 'bg-pink-950/85 active:bg-pink-900 border-pink-700/80 text-pink-100';
  const endBtn = isCorp
    ? 'bg-gradient-to-b from-cyan-600 to-cyan-700 border-cyan-400 text-white'
    : 'bg-gradient-to-b from-pink-600 to-pink-700 border-pink-400 text-white';

  return (
    <div
      data-testid="mobile-thumb-cockpit"
      className="shrink-0 bg-[#070b12] border-t border-slate-800 pb-[env(safe-area-inset-bottom)] z-20"
    >
      {/* Inline Contextual Selected-Card Bar */}
      {selectedCard && (
        <div
          data-testid="mobile-selected-card-bar"
          className="px-2 py-1.5 bg-[#0e1524] border-b border-amber-500/50 flex items-center justify-between gap-2 text-xs"
        >
          <div className="min-w-0 flex-1">
            <div className="font-bold text-amber-300 truncate">{cardDef(selectedCard).title}</div>
            <div className="text-[11px] text-slate-400 capitalize truncate">
              {cardDef(selectedCard).type_code}
              {cardDef(selectedCard).keywords ? ` · ${cardDef(selectedCard).keywords}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onInspect(selectedCard)}
              data-testid="mobile-inspect-selected"
              className="h-10 px-2.5 rounded-[2px] bg-slate-800 active:bg-slate-700 border border-slate-600 text-slate-200 font-bold text-xs inline-flex items-center gap-1"
            >
              <Eye className="w-3.5 h-3.5 text-amber-400" /> Info
            </button>
            {selectedAction && (
              <button
                type="button"
                disabled={selectedAction.disabled}
                onClick={selectedAction.onClick}
                data-testid="mobile-play-selected"
                className="h-10 px-3 rounded-[2px] bg-gradient-to-b from-amber-400 to-amber-500 text-black font-bold text-xs border border-amber-300 inline-flex items-center gap-1 disabled:opacity-40"
              >
                {selectedAction.label === 'Play' ? <Play className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{selectedAction.label}</span>
                {selectedAction.cost !== null && (
                  <span>
                    (<Credits amount={selectedAction.cost} />)
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onSelectCard(null);
                onHandExpandedChange(false);
              }}
              aria-label="Clear selection"
              className="h-10 w-8 flex items-center justify-center rounded-[2px] text-slate-400 active:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Paid-ability priority window banner (empty:hidden so it takes 0px outside priority windows) */}
      {side && canAct && (
        <div className="px-2 py-1 border-b border-slate-800/80 bg-[#0b111d] empty:hidden">
          <WindowBar state={state} side={side} onAction={onAction} />
        </div>
      )}

      {/* Action Pill Strip (44px thumb buttons in portrait, 36px in short landscape) */}
      <div className={`px-2 ${compact ? 'py-1' : 'py-1.5'} flex items-center gap-1.5 overflow-x-auto`}>
        {isActiveTurn && side ? (
          <>
            <button
              type="button"
              onClick={() => onAction({ type: 'GAIN_CREDIT', player: side })}
              disabled={!seat.can({ type: 'GAIN_CREDIT', player: side })}
              className={`${compact ? 'h-9' : 'h-11'} px-2.5 rounded-[3px] border text-xs font-bold inline-flex items-center gap-1 shrink-0 disabled:opacity-40 ${accentBtn}`}
            >
              <CreditIcon className="w-3.5 h-3.5 text-amber-400" /> +1
            </button>
            <button
              type="button"
              onClick={() => onAction({ type: 'DRAW_CARD', player: side })}
              disabled={!seat.can({ type: 'DRAW_CARD', player: side })}
              className={`${compact ? 'h-9' : 'h-11'} px-2.5 rounded-[3px] border text-xs font-bold inline-flex items-center gap-1 shrink-0 disabled:opacity-40 ${accentBtn}`}
            >
              <Layers className={`w-3.5 h-3.5 ${isCorp ? 'text-cyan-400' : 'text-pink-400'}`} /> Draw
            </button>
            {side === 'runner' && state.runner.tags > 0 && (
              <button
                type="button"
                onClick={() => onAction({ type: 'REMOVE_TAG', player: 'runner' })}
                disabled={!seat.can({ type: 'REMOVE_TAG', player: 'runner' })}
                className={`${compact ? 'h-9' : 'h-11'} px-2.5 rounded-[3px] border border-red-600/80 bg-red-950/80 text-red-200 text-xs font-bold inline-flex items-center gap-1 shrink-0 disabled:opacity-40`}
              >
                <TagIcon className="w-3.5 h-3.5 text-red-400" /> Untag
              </button>
            )}
            {side === 'corp' && virusCountersInPlay(state) > 0 && (
              <button
                type="button"
                onClick={async () => {
                  if (
                    virusCountersInPlay(state) === 0 &&
                    !(await showConfirm('There are no virus counters to purge. Spend 3 clicks anyway?', {
                      title: 'Nothing to purge',
                      confirmLabel: 'Purge anyway',
                      danger: true,
                    }))
                  )
                    return;
                  onAction({ type: 'PURGE_VIRUS', player: 'corp' });
                }}
                disabled={!seat.can({ type: 'PURGE_VIRUS', player: 'corp' })}
                className={`${compact ? 'h-9' : 'h-11'} px-2.5 rounded-[3px] border text-xs font-bold inline-flex items-center gap-1 shrink-0 disabled:opacity-40 ${accentBtn}`}
              >
                <VirusIcon className="w-4 h-4 text-lime-400" /> Purge
              </button>
            )}
          </>
        ) : (
          <div className="min-w-0 flex-1 flex items-center gap-1.5 text-xs text-slate-400 truncate">
            <span className="truncate">
              {aiThinking
                ? 'AI thinking…'
                : state.winner
                  ? 'Game over'
                  : `${state.activePlayer === 'corp' ? 'Corp' : 'Runner'}'s turn`}
            </span>
          </div>
        )}

        {/* Fallback Abilities / Options Chip (shown when legal abilities, hosted actions, or credit holds exist) */}
        {(abilityCount > 0 || hasCreditHolds) && (
          <button
            type="button"
            onClick={onOpenAbilities}
            data-testid="mobile-abilities-chip"
            className={`${compact ? 'h-9' : 'h-11'} px-2.5 rounded-[3px] border border-amber-500/80 bg-amber-950/60 active:bg-amber-900/70 text-amber-200 text-xs font-bold inline-flex items-center gap-1 shrink-0`}
            title="View usable card abilities and credit holds"
          >
            <Play className="w-3.5 h-3.5 text-amber-300 fill-amber-300/25" />
            <span>{abilityCount > 0 ? abilityCount : '¢'}</span>
          </button>
        )}

        {/* Log Sheet Trigger */}
        <button
          type="button"
          onClick={onOpenLog}
          data-testid="mobile-log-chip"
          className={`relative ${compact ? 'h-9' : 'h-11'} px-2.5 rounded-[3px] border border-slate-700 bg-slate-900 active:bg-slate-800 text-slate-200 text-xs font-bold inline-flex items-center gap-1 shrink-0`}
          title="Open game log"
        >
          <ScrollText className="w-3.5 h-3.5 text-slate-400" />
          <span>Log</span>
          {hasUnreadLog && <span className="w-2 h-2 rounded-full bg-emerald-400 absolute top-1 right-1" />}
        </button>

        {/* End / Start Turn */}
        {isActiveTurn && endTurnAction && (
          <button
            type="button"
            onClick={() => onAction(endTurnAction)}
            disabled={!seat.can(endTurnAction)}
            data-testid="end-turn"
            className={`ml-auto ${compact ? 'h-9' : 'h-11'} px-3 rounded-[3px] border text-xs font-bold inline-flex items-center gap-1 shrink-0 shadow disabled:opacity-40 ${endBtn} ${
              zeroClicks ? (isCorp ? 'end-turn-pulse end-turn-corp' : 'end-turn-pulse end-turn-runner') : ''
            }`}
          >
            <span>{startingCorpTurn ? 'Start' : 'End'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Peeking Hand Tray (tucked ~56px -> expanded ~148px) */}
      {side && (
        <div
          data-testid={`hand-dock-${side}`}
          className="border-t border-slate-800/90 bg-[#05080d]"
        >
          <div className="px-2 pt-1 pb-0.5 flex items-center justify-between text-[11px]">
            <button
              type="button"
              onClick={() => onHandExpandedChange(!handExpanded)}
              className={`font-bold uppercase tracking-wider inline-flex items-center gap-1 ${
                isCorp ? 'text-cyan-400' : 'text-pink-400'
              }`}
            >
              <span>{isCorp ? 'HQ' : 'Grip'} Hand</span>
              <span className={overLimit ? 'text-amber-300' : 'opacity-90'}>
                ({handCards.length}/{handSizeLimit})
              </span>
            </button>
            <button
              type="button"
              onClick={() => onHandExpandedChange(!handExpanded)}
              data-testid="mobile-hand-toggle"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] bg-slate-900 border border-slate-800 text-slate-300 font-bold text-[11px]"
            >
              {handExpanded ? (
                <>
                  Tuck <ChevronDown className="w-3 h-3" />
                </>
              ) : (
                <>
                  Expand <ChevronUp className="w-3 h-3" />
                </>
              )}
            </button>
          </div>

          <div
            data-testid={`hand-${side}`}
            className="flex gap-1.5 px-2 pb-1.5 pt-1 overflow-x-auto snap-x"
          >
            {handCards.length === 0 ? (
              <div className="text-xs text-slate-500 italic py-2 px-1">No cards in hand</div>
            ) : (
              handCards.map(card => {
                const def = cardDef(card);
                const selected = selectedCardId === card.instanceId;
                const liveCost = isPlayableType(card)
                  ? playCost(state, card)
                  : def.side_code === 'runner'
                    ? runnerInstallCost(state, card)
                    : def.cost ?? null;
                const printed = def.cost ?? null;
                const costColor =
                  liveCost !== null && printed !== null && liveCost !== printed
                    ? liveCost < printed
                      ? 'text-emerald-300'
                      : 'text-amber-300'
                    : 'text-amber-300';
                return (
                  <button
                    key={card.instanceId}
                    type="button"
                    data-hand-card
                    onClick={() => handleCardTap(card)}
                    className={`snap-start shrink-0 w-[104px] ${
                      handExpanded ? 'h-[98px]' : compact ? 'h-[34px]' : 'h-[42px]'
                    } p-1.5 rounded-[3px] border text-left flex flex-col justify-between transition-all ${
                      selected
                        ? 'border-amber-400 ring-1 ring-amber-400 -translate-y-1 bg-[#1b1609]'
                        : isCorp
                          ? 'border-cyan-800/80 bg-[#0a1522]'
                          : 'border-pink-800/80 bg-[#170b14]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-[11px] font-bold text-slate-100 leading-tight line-clamp-2">
                        {def.title}
                      </span>
                      {liveCost !== null && (
                        <span className={`px-1 rounded bg-slate-900 border border-slate-700 text-[10px] font-bold shrink-0 ${costColor}`}>
                          {liveCost}¢
                        </span>
                      )}
                    </div>
                    {handExpanded && (
                      <div className="mt-auto space-y-0.5">
                        <div className={`text-[10px] font-bold capitalize truncate ${isCorp ? 'text-cyan-300' : 'text-pink-300'}`}>
                          {def.type_code}
                          {def.agenda_points ? ` · ${def.advancement_cost ?? 0}/${def.agenda_points}` : ''}
                        </div>
                        {def.keywords && (
                          <div className="text-[10px] text-slate-400 truncate">{def.keywords}</div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
