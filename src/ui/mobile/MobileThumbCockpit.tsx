import React from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Eye, Layers, Play, Plus, ScrollText, Trash2, X } from 'lucide-react';
import {
  CardInstance,
  GameAction,
  GameState,
  SideCode,
  cardDef,
  getCardScript,
  iceSubtypes,
  installedIce,
  trashableFirst,
  virusCountersInPlay,
} from '../../core';
import { runnerInstallCost } from '../../core/engine/actions/install';
import { playCost } from '../../core/engine/actions/play';
import { CreditIcon, Credits, TagIcon, VirusIcon } from '../components/CreditIcon';
import { IceTypeIcons, breakerTypes } from '../components/IceTypeIcons';
import { WindowBar } from '../components/WindowBar';
import { legalFor, useSeat } from '../seat';
import type { RunnerInstallFlow } from '../components/ActionBars';

interface MobileThumbCockpitProps {
  state: GameState;
  side: SideCode | null;
  canAct: boolean;
  /** Passed separately so Open Table renders WindowBar for whichever side holds priority. */
  corpCanAct?: boolean;
  runnerCanAct?: boolean;
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
  /** True when extra options (credit holds or 0-virus Purge) are available in the options sheet. */
  hasExtraOptions?: boolean;
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
  corpCanAct,
  runnerCanAct,
  handCards,
  handSizeLimit,
  selectedCardId,
  onSelectCard,
  onInspect,
  onAction,
  handExpanded,
  onHandExpandedChange,
  abilityCount,
  hasExtraOptions = false,
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
  const showCorpWindow = corpCanAct ?? (side === 'corp' && canAct);
  const showRunnerWindow = runnerCanAct ?? (side === 'runner' && canAct);
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

  // Selected card action computation (mirrors ActionBars via seat legality)
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
        onTrashFirst: null as (() => void) | null,
      };
    }

    if (side === 'corp') {
      const canInstallDirectly = legalFor(seat, 'corp').some(
        a => a.type === 'INSTALL_CARD' && a.cardInstanceId === selectedCard.instanceId,
      );
      const canInstallWithTrash =
        !canInstallDirectly &&
        Object.values(state.corp.servers).some(s => {
          const cards = trashableFirst(state, selectedCard, s.id);
          return (
            cards.length > 0 &&
            seat.can({
              type: 'INSTALL_CARD',
              player: 'corp',
              cardInstanceId: selectedCard.instanceId,
              targetServerId: s.id,
              trashFirst: cards.map(c => c.instanceId),
            })
          );
        });
      return {
        label: 'Install…',
        cost: null,
        disabled: !canInstallDirectly && !canInstallWithTrash,
        onClick: () => {
          onHandExpandedChange(false);
          onOpenCorpInstall();
        },
        onTrashFirst: null as (() => void) | null,
      };
    }

    // Runner installable (Program / Hardware / Resource)
    const onIce = Boolean(getCardScript(selectedCard.cardCode)?.installsOnIce);
    const live = runnerInstallCost(state, selectedCard);
    const normalAction: GameAction = { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: selectedCard.instanceId };
    const canNormal = onIce ? installedIce(state).some(i => seat.can({ ...normalAction, hostInstanceId: i.instanceId })) : seat.can(normalAction);
    const allTrashable = trashableFirst(state, selectedCard, null).map(c => c.instanceId);
    const firstIce = onIce ? installedIce(state)[0]?.instanceId : undefined;
    const canMakeRoom =
      allTrashable.length > 0 &&
      (!onIce || !!firstIce) &&
      seat.can({ ...normalAction, trashFirst: allTrashable, ...(firstIce ? { hostInstanceId: firstIce } : {}) });
    const needRoom = !canNormal && canMakeRoom;

    const openMakeRoom = () => {
      runnerFlow.setPendingTrash(null);
      runnerFlow.setMakingRoom(selectedCard.instanceId);
      onHandExpandedChange(false);
      onOpenAbilities();
    };

    return {
      label: needRoom ? 'Free MU…' : onIce ? 'Install on Ice…' : 'Install',
      cost: live,
      disabled: !canNormal && !needRoom,
      onClick: () => {
        if (needRoom) {
          openMakeRoom();
          return;
        }
        if (onIce) {
          runnerFlow.setPendingTrash(null);
          runnerFlow.setPickingHost(selectedCard.instanceId);
          onHandExpandedChange(false);
          onOpenAbilities();
          return;
        }
        onAction(normalAction);
        onSelectCard(null);
        onHandExpandedChange(false);
      },
      // Voluntary trash-first replacement when MU is already free (rules 8.5.6c)
      onTrashFirst: canNormal && canMakeRoom ? openMakeRoom : null,
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
      {selectedCard && (() => {
        const selDef = cardDef(selectedCard);
        const selIsIce = selDef.type_code === 'ice';
        const selTypes = selIsIce ? iceSubtypes(selectedCard) : breakerTypes(selectedCard);
        return (
        <div
          data-testid="mobile-selected-card-bar"
          className="px-2 py-1.5 bg-[#0e1524] border-b border-amber-500/50 flex items-center justify-between gap-2 text-xs"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              {selTypes.length > 0 && (
                <IceTypeIcons types={selTypes} side={selIsIce ? 'ice' : 'breaker'} row className="text-[7px] shrink-0" />
              )}
              <span className="font-bold text-amber-300 truncate">{selDef.title}</span>
            </div>
            <div className="text-[11px] text-slate-400 capitalize truncate">
              {selDef.type_code}
              {selDef.keywords ? ` · ${selDef.keywords}` : ''}
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
              <>
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
                {selectedAction.onTrashFirst && (
                  <button
                    type="button"
                    onClick={selectedAction.onTrashFirst}
                    title="Trash installed programs first"
                    aria-label="Install after trashing installed programs"
                    className="h-10 px-2 rounded-[2px] bg-amber-950/90 active:bg-amber-900 border border-amber-500/80 text-amber-200 font-bold text-xs inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
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
        );
      })()}

      {/* Paid-ability priority window banner (renders for both sides in Open Table; empty:hidden outside priority windows) */}
      {(showCorpWindow || showRunnerWindow) && (
        <div className="px-2 py-1 border-b border-slate-800/80 bg-[#0b111d] flex flex-col gap-1 empty:hidden">
          {showCorpWindow && <WindowBar state={state} side="corp" onAction={onAction} />}
          {showRunnerWindow && <WindowBar state={state} side="runner" onAction={onAction} />}
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
                onClick={() => onAction({ type: 'PURGE_VIRUS', player: 'corp' })}
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

        {/* Fallback Abilities / Options Chip (shown when abilities, hosted actions, credit holds, or 0-virus Purge exist) */}
        {(abilityCount > 0 || hasExtraOptions) && (
          <button
            type="button"
            onClick={onOpenAbilities}
            data-testid="mobile-abilities-chip"
            className={`${compact ? 'h-9' : 'h-11'} px-2.5 rounded-[3px] border border-amber-500/80 bg-amber-950/60 active:bg-amber-900/70 text-amber-200 text-xs font-bold inline-flex items-center gap-1 shrink-0`}
            title="View usable card abilities and extra actions"
          >
            <Play className="w-3.5 h-3.5 text-amber-300 fill-amber-300/25" />
            <span>{abilityCount > 0 ? abilityCount : '···'}</span>
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
                const isIceCard = def.type_code === 'ice';
                const cardTypeIcons = isIceCard ? iceSubtypes(card) : breakerTypes(card);
                const typeIconSide = isIceCard ? 'ice' : 'breaker';
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
                      handExpanded ? 'h-[98px]' : compact ? 'h-[36px]' : 'h-[44px]'
                    } p-1.5 rounded-[3px] border text-left flex flex-col justify-between transition-all ${
                      selected
                        ? 'border-amber-400 ring-1 ring-amber-400 -translate-y-1 bg-[#1b1609]'
                        : isCorp
                          ? 'border-cyan-800/80 bg-[#0a1522]'
                          : 'border-pink-800/80 bg-[#170b14]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span
                        className={`text-[11px] font-bold text-slate-100 leading-tight ${
                          compact && !handExpanded ? 'truncate' : 'line-clamp-2'
                        }`}
                      >
                        {def.title}
                      </span>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        {liveCost !== null && (
                          <span className={`px-1 rounded bg-slate-900 border border-slate-700 text-[10px] font-bold leading-tight ${costColor}`}>
                            {liveCost}¢
                          </span>
                        )}
                        {!handExpanded && cardTypeIcons.length > 0 && (
                          <IceTypeIcons
                            types={cardTypeIcons}
                            side={typeIconSide}
                            row
                            className={compact ? 'text-[5.5px]' : 'text-[6.5px]'}
                          />
                        )}
                      </div>
                    </div>
                    {handExpanded && (
                      <div className="mt-auto space-y-0.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-[10px] font-bold capitalize truncate ${isCorp ? 'text-cyan-300' : 'text-pink-300'}`}>
                            {def.type_code}
                            {def.agenda_points ? ` · ${def.advancement_cost ?? 0}/${def.agenda_points}` : ''}
                          </span>
                          {cardTypeIcons.length > 0 && (
                            <IceTypeIcons
                              types={cardTypeIcons}
                              side={typeIconSide}
                              row
                              className="text-[7px] shrink-0"
                            />
                          )}
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
