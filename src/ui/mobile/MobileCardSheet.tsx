import React from 'react';
import { ChevronsUp, Crosshair, Maximize2, Play, Shield, Trash2 } from 'lucide-react';
import {
  CardInstance,
  GameAction,
  GameState,
  cardDef,
  findCardAnywhere,
  getCardScript,
  installedIce,
  isHidden,
  rezCostOf,
  trashableFirst,
} from '../../core';
import { playableHostZones } from '../../core/engine/actions/install';
import { getCardImageUrl } from '../../data/cards';
import { cardPositionLabel, typeLine } from '../cardLabels';
import { cardTextHtml } from '../cardText';
import { liveCardModifiers } from '../liveValues';
import { hostedCardActions } from '../legal';
import { legalFor, useSeat } from '../seat';
import { canSeeCorpSecrets, canSeeRunnerSecrets, Viewer } from '../viewer';
import { AgendaDiamondIcon, ClickIcon, Credits, renderSymbols } from '../components/CreditIcon';
import { RezIcon } from '../components/ServerColumn';
import { MobileBottomSheet } from './MobileBottomSheet';

interface MobileCardSheetProps {
  state: GameState;
  cardId: string | null;
  viewer: Viewer;
  corpCanAct: boolean;
  runnerCanAct: boolean;
  onAction: (action: GameAction) => void;
  onClose: () => void;
  onSelectCardId: (nextId: string) => void;
  onOpenFullZoom: (card: CardInstance) => void;
  /** Opens the Runner MU-replacement picker for a hosted program that needs room (rules 8.5.6c). */
  onMakeRoomForHosted?: (hostedCardId: string) => void;
}

/**
 * Tap-to-act bottom sheet for any installed board card or identity.
 * Shows card stats/rules (strictly respecting secret visibility) and full-width 44px
 * thumb-zone action buttons. Advance stays open for quick multi-advancing.
 */
export const MobileCardSheet: React.FC<MobileCardSheetProps> = ({
  state,
  cardId,
  viewer,
  corpCanAct,
  runnerCanAct,
  onAction,
  onClose,
  onSelectCardId,
  onOpenFullZoom,
  onMakeRoomForHosted,
}) => {
  const seat = useSeat();
  const card = cardId ? findCardAnywhere(state, cardId) ?? null : null;
  if (!card) return null;

  const isIdentity =
    card.instanceId === state.corp.identity.instanceId ||
    card.instanceId === state.runner.identity.instanceId;
  const def = cardDef(card);
  const isCorpCard = def.side_code === 'corp';
  const hiddenPlaceholder = isHidden(card);
  const faceVisible =
    !hiddenPlaceholder &&
    (card.isRezzed ||
      Boolean(card.faceUp) ||
      isIdentity ||
      (isCorpCard ? canSeeCorpSecrets(viewer) : canSeeRunnerSecrets(viewer)) ||
      Boolean(card.runnerKnows));

  const position = cardPositionLabel(state, card);
  const corpServer =
    isCorpCard && !isIdentity
      ? Object.values(state.corp.servers).find(
          s => s.ice.some(c => c.instanceId === card.instanceId) || s.root.some(c => c.instanceId === card.instanceId),
        )
      : undefined;
  const mods = faceVisible ? liveCardModifiers(state, card) : undefined;

  // Legal actions tied directly to this card
  const corpLegal = corpCanAct ? legalFor(seat, 'corp') : [];
  const runnerLegal = runnerCanAct ? legalFor(seat, 'runner') : [];

  const rezAction = corpLegal.find(a => a.type === 'REZ_CARD' && a.cardInstanceId === card.instanceId);
  const advanceAction = corpLegal.find(a => a.type === 'ADVANCE_CARD' && a.cardInstanceId === card.instanceId);
  const scoreAction = corpLegal.find(a => a.type === 'SCORE_AGENDA' && a.cardInstanceId === card.instanceId);
  const trashResAction = corpLegal.find(a => a.type === 'TRASH_RESOURCE' && a.cardInstanceId === card.instanceId);

  const abilityActions = [
    ...corpLegal.filter(a => a.type === 'USE_ABILITY' && a.cardInstanceId === card.instanceId),
    ...runnerLegal.filter(a => a.type === 'USE_ABILITY' && a.cardInstanceId === card.instanceId),
  ];

  // Hosted playable/installable Runner cards sitting on this host (e.g. Bling, Madani)
  const hostedIds = new Set((card.hostedCards ?? []).map(h => h.instanceId));
  const hostedPlayActions = runnerCanAct
    ? hostedCardActions(state, runnerLegal).filter(
        a => (a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'INSTALL_CARD') && hostedIds.has(a.cardInstanceId),
      )
    : [];

  // Hosted Runner programs on this card that only fit after trashing installed programs (rules 8.5.6c)
  const playableHostedSet =
    runnerCanAct && onMakeRoomForHosted
      ? new Set(playableHostZones(state).flat().map(h => h.instanceId))
      : null;
  const hostedNeedingRoom =
    playableHostedSet && playableHostedSet.size > 0
      ? (card.hostedCards ?? []).filter(h => {
          if (!playableHostedSet.has(h.instanceId)) return false;
          if (hostedPlayActions.some(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === h.instanceId)) return false;
          const trojan = Boolean(getCardScript(h.cardCode)?.installsOnIce);
          const all = trashableFirst(state, h, null).map(c => c.instanceId);
          const ice = trojan ? installedIce(state)[0]?.instanceId : undefined;
          return (
            all.length > 0 &&
            (!trojan || !!ice) &&
            seat.can({
              type: 'INSTALL_CARD',
              player: 'runner',
              cardInstanceId: h.instanceId,
              trashFirst: all,
              ...(ice ? { hostInstanceId: ice } : {}),
            })
          );
        })
      : [];

  // Runner trojans hosted on this Corp ice
  const trojansOnThis = [
    ...state.runner.rig.programs,
    ...state.runner.rig.hardware,
    ...state.runner.rig.resources,
  ].filter(c => c.hostedOnId === card.instanceId);

  // Quick Run button if Runner tapped a Corp card on a runnable server
  const runServerAction: GameAction | null =
    runnerCanAct && corpServer
      ? (() => {
          const act: GameAction = { type: 'INITIATE_RUN', player: 'runner', targetServerId: corpServer.id };
          return seat.can(act) ? act : null;
        })()
      : null;

  const counterEntries = Object.entries(card.tokens ?? {}).filter(([, n]) => n > 0);
  const hasFooterActions = Boolean(
    rezAction ||
      advanceAction ||
      scoreAction ||
      trashResAction ||
      abilityActions.length > 0 ||
      hostedPlayActions.length > 0 ||
      hostedNeedingRoom.length > 0 ||
      runServerAction,
  );

  const sheetTitle = faceVisible ? def.title : isCorpCard ? 'Unrezzed Corp Card' : 'Face-down Card';
  const sheetSubtitle = [
    position,
    faceVisible ? typeLine(def) : null,
    !card.isRezzed && !isIdentity && faceVisible
      ? isCorpCard && canSeeCorpSecrets(viewer)
        ? 'Unrezzed'
        : 'Unrezzed (last seen)'
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const footer = hasFooterActions ? (
    <div className="w-full flex flex-col gap-2" data-testid="mobile-card-actions">
      {/* Primary Corp row: Rez / Advance / Score */}
      {(rezAction || advanceAction || scoreAction) && (
        <div className="flex flex-wrap gap-2">
          {scoreAction && (
            <button
              type="button"
              data-testid="mobile-action-score"
              onClick={() => {
                onAction(scoreAction);
                onClose();
              }}
              className="flex-1 min-w-[130px] h-11 px-3 rounded-[3px] bg-gradient-to-b from-emerald-500 to-emerald-600 text-black font-bold text-xs border border-emerald-300 inline-flex items-center justify-center gap-1.5"
            >
              <AgendaDiamondIcon className="w-4 h-4" /> Score Agenda
            </button>
          )}
          {rezAction && (
            <button
              type="button"
              data-testid="mobile-action-rez"
              onClick={() => {
                onAction(rezAction);
                onClose();
              }}
              className="flex-1 min-w-[120px] h-11 px-3 rounded-[3px] bg-gradient-to-b from-cyan-500 to-cyan-600 text-black font-bold text-xs border border-cyan-300 inline-flex items-center justify-center gap-1.5"
            >
              <RezIcon className="w-4 h-4" />
              <span>Rez</span>
              <span>
                (<Credits amount={rezCostOf(state, card)} />)
              </span>
            </button>
          )}
          {advanceAction && (
            <button
              type="button"
              data-testid="mobile-action-advance"
              onClick={() => {
                // Keep sheet open for quick multi-advancing!
                onAction(advanceAction);
              }}
              className="flex-1 min-w-[140px] h-11 px-3 rounded-[3px] bg-amber-950/90 active:bg-amber-900 border border-amber-500 text-amber-200 font-bold text-xs inline-flex items-center justify-center gap-1.5"
            >
              <ChevronsUp className="w-4 h-4 text-amber-400" />
              <span>Advance</span>
              <span className="inline-flex items-center gap-0.5 text-amber-300">
                (<ClickIcon className="w-3 h-3" />+<Credits amount={1} />)
              </span>
              {faceVisible && def.type_code === 'agenda' && def.advancement_cost && (
                <span className="px-1 rounded bg-amber-900/90 text-[10px]">
                  {card.advancementCounters}/{def.advancement_cost}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Card Paid / Click Abilities */}
      {abilityActions.map(action => {
        if (action.type !== 'USE_ABILITY') return null;
        const ability = getCardScript(card.cardCode)?.abilities?.[action.abilityIndex];
        if (!ability) return null;
        const warning = ability.warning?.({ state, card, side: action.player });
        return (
          <button
            key={`${action.cardInstanceId}-${action.abilityIndex}`}
            type="button"
            data-testid={`mobile-action-ability-${action.abilityIndex}`}
            onClick={() => {
              onAction(action);
              onClose();
            }}
            className="w-full min-h-[44px] px-3 py-2 rounded-[3px] bg-amber-950/75 active:bg-amber-900 border border-amber-500/80 text-amber-100 font-bold text-xs text-left flex items-center gap-2"
          >
            <Play className="w-4 h-4 text-amber-300 shrink-0" />
            <span className="flex-1 leading-snug">
              {renderSymbols(ability.label)}
              {warning && <span className="block text-[11px] font-normal text-amber-300 mt-0.5">{warning}</span>}
            </span>
          </button>
        );
      })}

      {/* Hosted playable/installable cards */}
      {hostedPlayActions.map(action => {
        if (action.type !== 'PLAY_OPERATION_OR_EVENT' && action.type !== 'INSTALL_CARD') return null;
        const hosted = findCardAnywhere(state, action.cardInstanceId);
        if (!hosted) return null;
        const hostIce =
          action.type === 'INSTALL_CARD' && action.hostInstanceId
            ? findCardAnywhere(state, action.hostInstanceId)
            : undefined;
        const targetPos = hostIce ? cardPositionLabel(state, hostIce) : null;
        return (
          <button
            key={`${action.type}-${action.cardInstanceId}-${action.type === 'INSTALL_CARD' ? (action.hostInstanceId ?? '') : ''}`}
            type="button"
            onClick={() => {
              onAction(action);
              onClose();
            }}
            className="w-full min-h-[44px] px-3 py-2 rounded-[3px] bg-pink-950/80 active:bg-pink-900 border border-pink-600 text-pink-100 font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <Play className="w-4 h-4 text-pink-400 shrink-0" />
            <span className="truncate">
              {action.type === 'PLAY_OPERATION_OR_EVENT' ? 'Play' : 'Install'} hosted {cardDef(hosted).title}
              {targetPos ? ` on ${targetPos}` : ''}
            </span>
          </button>
        );
      })}

      {/* Hosted programs needing MU replacement (rules 8.5.6c) */}
      {hostedNeedingRoom.map(hosted => (
        <button
          key={`make-room-${hosted.instanceId}`}
          type="button"
          onClick={() => {
            onClose();
            onMakeRoomForHosted?.(hosted.instanceId);
          }}
          className="w-full min-h-[44px] px-3 py-2 rounded-[3px] bg-amber-950/80 active:bg-amber-900 border border-amber-500 text-amber-100 font-bold text-xs flex items-center justify-center gap-1.5"
        >
          <Play className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="truncate">Free MU to install {cardDef(hosted).title}…</span>
        </button>
      ))}

      {/* Corp Trash Tagged Resource */}
      {trashResAction && (
        <button
          type="button"
          data-testid="mobile-action-trash-resource"
          onClick={() => {
            onAction(trashResAction);
            onClose();
          }}
          className="w-full h-11 px-3 rounded-[3px] bg-red-950/90 active:bg-red-900 border border-red-600 text-red-200 font-bold text-xs inline-flex items-center justify-center gap-1.5"
        >
          <Trash2 className="w-4 h-4 text-red-400" />
          <span>Trash Resource</span>
          <span className="inline-flex items-center gap-0.5">
            (<ClickIcon className="w-3 h-3" />+<Credits amount={2} />)
          </span>
        </button>
      )}

      {/* Runner quick-run shortcut */}
      {runServerAction && corpServer && (
        <button
          type="button"
          data-testid="mobile-action-run-server"
          onClick={() => {
            onAction(runServerAction);
            onClose();
          }}
          className="w-full h-11 px-3 rounded-[3px] bg-gradient-to-b from-pink-600 to-pink-700 text-white font-bold text-xs border border-pink-400 inline-flex items-center justify-center gap-1.5"
        >
          <Crosshair className="w-4 h-4" /> Run {corpServer.name}
        </button>
      )}
    </div>
  ) : undefined;

  const hostedCardsHiddenFromViewer = Boolean(getCardScript(card.cardCode)?.hostedFaceDown) && !canSeeRunnerSecrets(viewer);

  return (
    <MobileBottomSheet
      open
      title={sheetTitle}
      subtitle={sheetSubtitle || undefined}
      accentClass={isCorpCard ? 'border-cyan-500/80' : 'border-pink-500/80'}
      onClose={onClose}
      footer={footer}
      headerActions={
        faceVisible ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFullZoom(card);
            }}
            aria-label="Open full card art"
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-[2px] bg-slate-900 active:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold min-h-[36px]"
          >
            <Maximize2 className="w-3.5 h-3.5" /> Art
          </button>
        ) : undefined
      }
      testId="mobile-card-sheet"
    >
      {!faceVisible ? (
        <div className="space-y-3 text-xs text-slate-300">
          <div className="flex items-center gap-3 p-3 rounded-[3px] border border-slate-800 bg-slate-950/70">
            <Shield className="w-8 h-8 text-slate-500 shrink-0" />
            <div>
              <div className="font-bold text-slate-200">{isCorpCard ? 'Unrezzed Corp Card' : 'Facedown Card'}</div>
              <div className="text-slate-400 mt-0.5">
                {position ? `${position} — ` : ''}Hidden until revealed or accessed.
              </div>
            </div>
          </div>
          {(card.advancementCounters > 0 || counterEntries.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {card.advancementCounters > 0 && (
                <span className="px-2 py-1 rounded bg-amber-950/80 border border-amber-700 text-amber-200 font-bold">
                  {card.advancementCounters} advancement {card.advancementCounters === 1 ? 'counter' : 'counters'}
                </span>
              )}
              {counterEntries.map(([kind, n]) => (
                <span key={kind} className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 font-bold capitalize">
                  {n} {kind}
                </span>
              ))}
            </div>
          )}
          {trojansOnThis.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Hosted on this ice</div>
              <div className="flex flex-wrap gap-1.5">
                {trojansOnThis.map(h => (
                  <button
                    key={h.instanceId}
                    type="button"
                    onClick={() => onSelectCardId(h.instanceId)}
                    className="px-2 py-1.5 rounded-[2px] border border-pink-700/80 bg-pink-950/50 active:bg-pink-900 text-pink-100 text-xs font-bold"
                  >
                    {isHidden(h) ? 'Facedown hosted card' : cardDef(h).title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          {/* Top Summary: Art thumbnail + Live Stats */}
          <div className="flex items-start gap-3">
            <img
              src={getCardImageUrl(card.cardCode)}
              alt={def.title}
              className="w-20 rounded-[4px] border border-slate-700 shrink-0 bg-slate-950"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                {def.cost !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-amber-300">
                    {def.type_code === 'ice' || def.type_code === 'asset' || def.type_code === 'upgrade' ? 'Rez ' : 'Cost '}
                    {mods?.cost ? `${mods.cost.printed}→${mods.cost.current}` : def.cost}¢
                  </span>
                )}
                {def.strength !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-cyan-800 text-cyan-200">
                    Str {mods?.strength ? `${mods.strength.printed}→${mods.strength.current}` : def.strength}
                  </span>
                )}
                {def.memory_cost !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-cyan-800 text-cyan-300">
                    {def.memory_cost} MU
                  </span>
                )}
                {def.agenda_points !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-200">
                    {def.advancement_cost ?? 0} / {def.agenda_points} pts
                  </span>
                )}
                {def.trash_cost !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                    Trash {def.trash_cost}¢
                  </span>
                )}
              </div>

              {(card.advancementCounters > 0 || counterEntries.length > 0) && (
                <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                  {card.advancementCounters > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-600 text-amber-200">
                      {card.advancementCounters} Adv
                    </span>
                  )}
                  {counterEntries.map(([kind, n]) => (
                    <span key={kind} className="px-1.5 py-0.5 rounded bg-slate-900 border border-amber-800/80 text-amber-200 capitalize">
                      {n} {kind}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Card Text */}
          {def.text && (
            <div
              className="p-2.5 rounded-[3px] bg-slate-950/80 border border-slate-800 text-slate-200 leading-relaxed space-y-1.5 card-text"
              dangerouslySetInnerHTML={{ __html: cardTextHtml(def.text) }}
            />
          )}

          {/* Hosted Cards / Trojans */}
          {((card.hostedCards?.length ?? 0) > 0 || trojansOnThis.length > 0) && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Hosted on this card</div>
              <div className="flex flex-wrap gap-1.5">
                {(card.hostedCards ?? []).map(h => {
                  const hHidden = isHidden(h) || hostedCardsHiddenFromViewer;
                  if (hHidden) {
                    return (
                      <span
                        key={h.instanceId}
                        data-testid="mobile-hosted-hidden"
                        className="px-2 py-1.5 rounded-[2px] border border-slate-700 border-dashed bg-slate-950 text-slate-400 text-xs font-bold"
                      >
                        Facedown hosted card
                      </span>
                    );
                  }
                  return (
                    <button
                      key={h.instanceId}
                      type="button"
                      onClick={() => onSelectCardId(h.instanceId)}
                      className="px-2 py-1.5 rounded-[2px] border border-slate-700 bg-slate-900 active:bg-slate-800 text-slate-200 text-xs font-bold"
                    >
                      {cardDef(h).title}
                    </button>
                  );
                })}
                {trojansOnThis.map(h => (
                  <button
                    key={h.instanceId}
                    type="button"
                    onClick={() => onSelectCardId(h.instanceId)}
                    className="px-2 py-1.5 rounded-[2px] border border-pink-700/80 bg-pink-950/50 active:bg-pink-900 text-pink-100 text-xs font-bold"
                  >
                    {isHidden(h) ? 'Facedown hosted card' : cardDef(h).title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </MobileBottomSheet>
  );
};
