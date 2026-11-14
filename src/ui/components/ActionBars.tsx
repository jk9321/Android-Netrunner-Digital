import { useEffect, useState } from 'react';
import { ArrowRight, Eye, Layers, Plus, Trash2, Zap } from 'lucide-react';
import { CardInstance, GameAction, GameState, SideCode, cardDef, findCardAnywhere, getCardScript, installedIce, trashableFirst, virusCountersInPlay } from '../../core';
import { legalFor, useSeat } from '../seat';
import { playableHostZones, runnerInstallCost } from '../../core/engine/actions/install';
import { playCost } from '../../core/engine/actions/play';
import { showConfirm } from './Dialog';
import { TrashFirstPicker, TrashSplitSegment } from './TrashFirstPicker';
import { ClickIcon, CreditIcon, Credits, TagIcon, VirusIcon } from './CreditIcon';
import { CorpInstallOptions } from './CorpInstallOptions';
import { hostedCardActions } from '../legal';
import { cardPositionLabel } from '../cardLabels';
import { hoverPromptTarget } from '../promptHighlight';

interface ActionBarProps {
  state: GameState;
  /** The hand card the player has selected, if any. */
  selectedCard: CardInstance | undefined;
  onAction: (action: GameAction) => void;
  onInspect?: (card: CardInstance) => void;
}

const isPlayable = (card: CardInstance | undefined) => !!card && ['operation', 'event'].includes(cardDef(card).type_code);

/** Render a live play/install cost in parentheses, highlighting when discounted or taxed vs. printed cost. */
function LiveCostParens({ printed, live, darkOnAmber = false }: { printed: number; live: number; darkOnAmber?: boolean }) {
  if (live === printed) {
    return (
      <span>
        (<Credits amount={live} />)
      </span>
    );
  }
  const colorClass = darkOnAmber
    ? live < printed
      ? 'text-emerald-950 bg-emerald-300/80 px-1 rounded'
      : 'text-red-950 bg-red-300/80 px-1 rounded'
    : live < printed
      ? 'text-emerald-300'
      : 'text-amber-300';
  return (
    <span className={colorClass}>
      (<s className="opacity-65 mr-0.5">{printed}</s>
      <Credits amount={live} />)
    </span>
  );
}

/** "Play <card>" for a selected operation or event of this side. */
function PlayButton({ side, state, selectedCard, onAction }: ActionBarProps & { side: SideCode }) {
  const seat = useSeat();
  if (!selectedCard || !isPlayable(selectedCard) || cardDef(selectedCard).side_code !== side) return null;
  const action: GameAction = { type: 'PLAY_OPERATION_OR_EVENT', player: side, cardInstanceId: selectedCard.instanceId };
  const implemented = Boolean(getCardScript(selectedCard.cardCode)?.onPlay);
  const printed = cardDef(selectedCard).cost ?? 0;
  const live = playCost(state, selectedCard);
  return (
    <button
      onClick={() => onAction(action)}
      disabled={!seat.can(action)}
      title={implemented ? undefined : 'This card\'s effect is not implemented yet'}
      className="px-4 py-1.5 bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-black text-xs font-bold rounded-[2px] border border-amber-300 border-b-2 border-b-amber-700 transition-all flex items-center gap-1.5 shadow-lg disabled:opacity-40 disabled:animate-none animate-pulse active:translate-y-[1px] active:border-b-[1px]"
    >
      <Zap className="w-3.5 h-3.5" />{' '}
      {implemented ? (
        <>
          <span>Play {cardDef(selectedCard).title}</span>
          <LiveCostParens printed={printed} live={live} darkOnAmber />
        </>
      ) : (
        'Effect not implemented yet'
      )}
    </button>
  );
}

/** Quick-inspect button for the currently selected hand card on touch screens (mouse users hover instead). */
function InspectSelectedButton({ side, selectedCard, onInspect }: { side: SideCode; selectedCard: CardInstance | undefined; onInspect?: (card: CardInstance) => void }) {
  if (!selectedCard || !onInspect || cardDef(selectedCard).side_code !== side) return null;
  return (
    <button
      onClick={() => onInspect(selectedCard)}
      data-testid="inspect-selected-card"
      title={`Inspect ${cardDef(selectedCard).title}`}
      className="[@media(hover:hover)_and_(pointer:fine)]:hidden px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-bold rounded-[2px] border border-slate-700 border-b-2 border-b-slate-600 transition-all flex items-center gap-1.5 shadow active:translate-y-[1px] active:border-b-[1px]"
    >
      <Eye className="w-3.5 h-3.5 text-amber-400" /> Inspect {cardDef(selectedCard).title}
    </button>
  );
}

/**
 * Install a trojan on one piece of ice. Unrezzed ice all looks alike, so the
 * button names the ice's position and hovering it lights that ice up on the table.
 */
function InstallOnIceButton({ state, host, onClick }: { state: GameState; host: CardInstance; onClick: () => void }) {
  const position = cardPositionLabel(state, host);
  // The button goes away once the card is installed or deselected; don't leave its ice lit
  useEffect(() => () => hoverPromptTarget(null), []);
  return (
    <button
      onClick={() => {
        hoverPromptTarget(null);
        onClick();
      }}
      onMouseEnter={() => hoverPromptTarget({ id: host.instanceId, label: position })}
      onMouseLeave={() => hoverPromptTarget(null)}
      className="px-2 py-1.5 bg-gradient-to-b from-pink-600 to-pink-800 hover:from-pink-500 hover:to-pink-700 text-white text-xs font-bold rounded-[2px] border border-pink-400 border-b-2 border-b-pink-300 transition-all flex items-center gap-1.5 shadow-lg active:translate-y-[1px] active:border-b-[1px]"
    >
      <Plus className="w-3.5 h-3.5" /> Install on {host.isRezzed ? cardDef(host).title : 'unrezzed ice'} · {position}
    </button>
  );
}

/** The Corp's click actions, plays and installs for the selected card, and End Turn. */
export function CorpActions(props: ActionBarProps) {
  const seat = useSeat();
  const { state, selectedCard, onAction, onInspect } = props;
  const { corp } = state;
  const startingTurn = state.turnStep?.kind === 'corp_turn_start';
  const turnAction: GameAction = startingTurn ? { type: 'START_TURN', player: 'corp' } : { type: 'END_TURN', player: 'corp' };
  return (
    <div className="flex flex-col gap-2 p-2 bg-gradient-to-b from-[#0e141e] to-[#080c13] border border-cyan-900/60 rounded-[2px] shadow-inner">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-bold text-cyan-400 font-mono uppercase w-full">Corp Actions ({corp.clicks} Clicks):</span>
        {/* Basic click actions sit in an equal 3-column row so they never wrap awkwardly */}
        <div className="grid grid-cols-3 gap-1.5 w-full">
          <button
            onClick={() => onAction({ type: 'GAIN_CREDIT', player: 'corp' })}
            disabled={!seat.can({ type: 'GAIN_CREDIT', player: 'corp' })}
            className="px-1.5 py-1.5 bg-gradient-to-b from-cyan-950/90 to-cyan-950/40 hover:from-cyan-900/90 hover:to-cyan-900/40 border border-cyan-700/80 border-b-2 border-b-cyan-500 text-cyan-200 text-xs font-bold rounded-[2px] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 shadow active:translate-y-[1px] active:border-b-[1px]"
          >
            <CreditIcon className="w-3.5 h-3.5 text-amber-400" /> +1 Credit
          </button>
          <button
            onClick={() => onAction({ type: 'DRAW_CARD', player: 'corp' })}
            disabled={!seat.can({ type: 'DRAW_CARD', player: 'corp' })}
            className="px-1.5 py-1.5 bg-gradient-to-b from-cyan-950/90 to-cyan-950/40 hover:from-cyan-900/90 hover:to-cyan-900/40 border border-cyan-700/80 border-b-2 border-b-cyan-500 text-cyan-200 text-xs font-bold rounded-[2px] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 shadow active:translate-y-[1px] active:border-b-[1px]"
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400" /> Draw Card
          </button>
          <button
            onClick={async () => {
              // Purging with no virus counters out is legal (rule 10.1.2) but wastes the turn, so check first
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
            className="px-1 py-1.5 bg-gradient-to-b from-cyan-950/90 to-cyan-950/40 hover:from-cyan-900/90 hover:to-cyan-900/40 border border-cyan-700/80 border-b-2 border-b-cyan-500 text-cyan-200 text-xs font-bold rounded-[2px] transition-all flex items-center justify-center gap-1 disabled:opacity-40 shadow whitespace-nowrap active:translate-y-[1px] active:border-b-[1px]"
            title="Spend 3 clicks to remove every virus counter"
          >
            <VirusIcon className="w-[17px] h-[17px] text-lime-400 shrink-0" />
            <span>Purge (3<ClickIcon className="w-3 h-3 text-red-400 inline-block align-middle mx-0.5" />)</span>
          </button>
        </div>
        {legalFor(seat, 'corp').map(a => {
          if (a.type !== 'TRASH_RESOURCE') return null;
          const res = findCardAnywhere(state, a.cardInstanceId);
          return (
            <button
              key={a.cardInstanceId}
              onClick={() => {
                hoverPromptTarget(null);
                onAction(a);
              }}
              onMouseEnter={() => res && hoverPromptTarget({ id: res.instanceId, label: null })}
              onMouseLeave={() => hoverPromptTarget(null)}
              className="px-2 py-1.5 bg-gradient-to-b from-red-950/90 to-red-950/40 hover:from-red-900/90 hover:to-red-900/40 border border-red-700/80 border-b-2 border-b-red-500 text-red-200 text-xs font-bold rounded-[2px] transition-all flex items-center gap-1.5 shadow active:translate-y-[1px] active:border-b-[1px]"
              title="The Runner is tagged: spend a click and 2 credits to trash this resource"
            >
              <Trash2 className="w-3.5 h-3.5" /> Trash {res ? cardDef(res).title : 'resource'} (1<ClickIcon className="w-3 h-3 text-red-400 inline-block align-middle mx-0.5" /> + <Credits amount={2} />)
            </button>
          );
        })}
        <PlayButton {...props} side="corp" />
        {selectedCard && !isPlayable(selectedCard) && cardDef(selectedCard).side_code === 'corp' && (
          <CorpInstallOptions state={state} card={selectedCard} onAction={onAction} />
        )}
        <InspectSelectedButton side="corp" selectedCard={selectedCard} onInspect={onInspect} />
      </div>

      {/* End Turn Button - Prominently Anchored (before the turn begins it takes the mandatory draw instead) */}
      <button
        onClick={() => onAction(turnAction)}
        disabled={!seat.can(turnAction)}
        title={startingTurn ? 'Rez assets or upgrades first if you want them working this turn, then take the mandatory draw' : undefined}
        data-testid="end-turn"
        className={`px-3 py-1.5 bg-gradient-to-b from-cyan-600 to-cyan-800 hover:from-cyan-500 hover:to-cyan-700 text-white font-mono text-xs font-bold rounded-[2px] border border-cyan-400 border-b-2 border-b-cyan-300 transition-all shadow-lg shadow-cyan-950 flex items-center gap-1.5 self-end disabled:opacity-40 active:translate-y-[1px] active:border-b-[1px] ${
          !startingTurn && corp.clicks === 0 ? 'end-turn-pulse end-turn-corp' : ''
        }`}
      >
        {startingTurn ? 'Draw & Start Turn' : 'End Corp Turn'} <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** The Runner's click actions, plays and installs for the selected card (or cards hosted on hardware), and End Turn. */
export function RunnerActions(props: ActionBarProps) {
  const seat = useSeat();
  const { state, selectedCard, onAction, onInspect } = props;
  const { runner } = state;
  const installable = selectedCard && !isPlayable(selectedCard) ? selectedCard : undefined;
  const onIce = installable && getCardScript(installable.cardCode)?.installsOnIce;
  // A trojan needs a host; any installed ice stands in for it when asking why the install is blocked
  const iceHosts = onIce ? installedIce(state) : [];
  // Why the selected grip card can't be installed now (shown beside the disabled Install button), or null if it can
  const installBlocked =
    installable && cardDef(installable).side_code === 'runner'
      ? onIce && iceHosts.length === 0
        ? `${cardDef(installable).title} must be installed on a piece of ice and there is none installed`
        : seat.reason({ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: installable.instanceId, hostInstanceId: iceHosts[0]?.instanceId })
      : null;
  // Programs: trash installed programs first (rules 8.5.6c), which the memory limit may require
  const [makingRoom, setMakingRoom] = useState<string | null>(null);
  // Trojans: the programs already chosen to trash, while the ice to install on is picked
  const [pendingTrash, setPendingTrash] = useState<string[] | null>(null);
  const installTrashing = (card: CardInstance, trashFirst: string[], hostInstanceId?: string): GameAction => ({ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: card.instanceId, trashFirst, hostInstanceId });
  // Can this card be installed if the Runner trashes installed programs first?
  const canMakeRoomFor = (card: CardInstance) => {
    const trojan = getCardScript(card.cardCode)?.installsOnIce;
    const all = trashableFirst(state, card, null).map(c => c.instanceId);
    const ice = trojan ? installedIce(state)[0]?.instanceId : undefined;
    return all.length > 0 && (!trojan || !!ice) && seat.can(installTrashing(card, all, ice));
  };
  const canMakeRoom = !!installable && canMakeRoomFor(installable);
  // Cards hosted on hardware (Bling, Madani) that can be played or installed as if in the grip
  const hostedActions = hostedCardActions(state, legalFor(seat, 'runner'));
  // Hosted programs that fit only after trashing installed programs (rules 8.5.6c): Gourmand on Bling with full MU
  const hostedNeedingRoom = playableHostZones(state)
    .flat()
    .filter(c => !hostedActions.some(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === c.instanceId) && canMakeRoomFor(c));
  // The card the player is choosing programs to trash for: the selected grip card or a hosted one
  const roomCard = makingRoom ? findCardAnywhere(state, makingRoom) : undefined;
  const roomOnIce = !!roomCard && !!getCardScript(roomCard.cardCode)?.installsOnIce;
  // A card that installs only on ice (Botulus, from the grip or hosted on Bling): the ice the player is choosing between (rules 1.13.6c, 8.5.16b)
  const [pickingHost, setPickingHost] = useState<string | null>(null);
  const hostChoices: GameAction[] = !pickingHost
    ? []
    : pendingTrash
      ? installedIce(state).map(h => installTrashing(findCardAnywhere(state, pickingHost)!, pendingTrash, h.instanceId)).filter(a => seat.can(a))
      : legalFor(seat, 'runner').filter(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === pickingHost && a.hostInstanceId);
  const pickingCard = pickingHost ? findCardAnywhere(state, pickingHost) : undefined;
  if (pickingCard && hostChoices.length > 0) {
    return (
      <div className="flex flex-col gap-2 p-2 bg-gradient-to-b from-[#180a10] to-[#0d0407] border border-pink-900/60 rounded-[2px] shadow-inner">
        <span className="text-xs font-bold text-pink-400 font-mono uppercase">
          Install {pickingCard.instanceId === installable?.instanceId ? '' : 'hosted '}
          {cardDef(pickingCard).title} on:
        </span>
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="ice-host-picker">
          {hostChoices.map(a => {
            if (a.type !== 'INSTALL_CARD' || !a.hostInstanceId) return null;
            const host = findCardAnywhere(state, a.hostInstanceId);
            return host ? (
              <InstallOnIceButton
                key={a.hostInstanceId}
                state={state}
                host={host}
                onClick={() => {
                  setPickingHost(null);
                  setPendingTrash(null);
                  onAction(a);
                }}
              />
            ) : null;
          })}
        </div>
        <button
          onClick={() => {
            setPickingHost(null);
            setPendingTrash(null);
          }}
          className="px-2 py-1.5 bg-gradient-to-b from-pink-950/90 to-pink-950/40 hover:from-pink-900/90 hover:to-pink-900/40 border border-pink-700/80 border-b-2 border-b-pink-500 text-pink-200 text-xs font-bold rounded-[2px] transition-all self-end shadow active:translate-y-[1px] active:border-b-[1px]"
        >
          Cancel
        </button>
      </div>
    );
  }
  if (roomCard) {
    const firstIce = roomOnIce ? installedIce(state)[0]?.instanceId : undefined;
    const neededMu = cardDef(roomCard).memory_cost ?? 0;
    const freeMu = Math.max(0, state.runner.memoryUnitsTotal - state.runner.memoryUnitsUsed);
    return (
      <div className="flex flex-col gap-2 p-2 bg-gradient-to-b from-[#180a10] to-[#0d0407] border border-pink-900/60 rounded-[2px] shadow-inner">
        <TrashFirstPicker
          key={roomCard.instanceId}
          heading={`Install ${roomCard.instanceId === installable?.instanceId ? '' : 'hosted '}${cardDef(roomCard).title}, trashing first:`}
          cards={trashableFirst(state, roomCard, null)}
          statusText={
            neededMu > 0
              ? trash => {
                  const freed = trash.reduce((sum, id) => {
                    const p = findCardAnywhere(state, id);
                    return sum + (p ? (cardDef(p).memory_cost ?? 0) : 0);
                  }, 0);
                  const total = freeMu + freed;
                  return total >= neededMu
                    ? <span className="text-emerald-400">✓ {total}/{neededMu} MU available</span>
                    : `Need ${neededMu - total} more MU`;
                }
              : undefined
          }
          confirmLabel={trash => `${roomOnIce ? 'Choose ice' : 'Install'}${trash.length > 0 ? `, trash ${trash.length}` : ''}`}
          canConfirm={trash => seat.can(installTrashing(roomCard, trash, firstIce))}
          onConfirm={trash => {
            setMakingRoom(null);
            if (roomOnIce) {
              setPendingTrash(trash);
              setPickingHost(roomCard.instanceId);
              return;
            }
            onAction(installTrashing(roomCard, trash));
          }}
          onCancel={() => setMakingRoom(null)}
        />
      </div>
    );
  }
  const canNormalInstall = installable
    ? onIce
      ? legalFor(seat, 'runner').some(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === installable.instanceId)
      : installBlocked === null
    : false;
  const autoFreeMu = !!installable && !canNormalInstall && canMakeRoom;
  const splitTrash = !!installable && canNormalInstall && canMakeRoom;
  return (
    <div className="flex flex-col gap-2 p-2 bg-gradient-to-b from-[#180a10] to-[#0d0407] border border-pink-900/60 rounded-[2px] shadow-inner">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-bold text-pink-400 font-mono uppercase w-full">Runner Actions ({runner.clicks} Clicks):</span>
        {/* Basic click actions sit in an equal 2-column row */}
        <div className="grid grid-cols-2 gap-1.5 w-full">
          <button
            onClick={() => onAction({ type: 'GAIN_CREDIT', player: 'runner' })}
            disabled={runner.clicks < 1}
            className="px-2 py-1.5 bg-gradient-to-b from-pink-950/90 to-pink-950/40 hover:from-pink-900/90 hover:to-pink-900/40 border border-pink-700/80 border-b-2 border-b-pink-500 text-pink-200 text-xs font-bold rounded-[2px] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 shadow active:translate-y-[1px] active:border-b-[1px]"
          >
            <CreditIcon className="w-3.5 h-3.5 text-amber-400" /> +1 Credit
          </button>
          <button
            onClick={() => onAction({ type: 'DRAW_CARD', player: 'runner' })}
            disabled={runner.clicks < 1}
            className="px-2 py-1.5 bg-gradient-to-b from-pink-950/90 to-pink-950/40 hover:from-pink-900/90 hover:to-pink-900/40 border border-pink-700/80 border-b-2 border-b-pink-500 text-pink-200 text-xs font-bold rounded-[2px] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 shadow active:translate-y-[1px] active:border-b-[1px]"
          >
            <Layers className="w-3.5 h-3.5 text-pink-400" /> Draw Card
          </button>
        </div>
        {runner.tags > 0 && (
          <button
            onClick={() => onAction({ type: 'REMOVE_TAG', player: 'runner' })}
            disabled={!seat.can({ type: 'REMOVE_TAG', player: 'runner' })}
            className="px-2 py-1.5 bg-gradient-to-b from-pink-950/90 to-pink-950/40 hover:from-pink-900/90 hover:to-pink-900/40 border border-pink-700/80 border-b-2 border-b-pink-500 text-pink-200 text-xs font-bold rounded-[2px] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 shadow w-full active:translate-y-[1px] active:border-b-[1px]"
          >
            <TagIcon className="w-[18px] h-[18px] text-red-400 shrink-0" /> Remove Tag (1<ClickIcon className="w-3 h-3 text-red-400 inline-block align-middle mx-0.5" /> + <Credits amount={2} />)
          </button>
        )}
        <PlayButton {...props} side="runner" />
        {installable && (() => {
          const mainBtn = (
            <button
              onClick={() => {
                if (autoFreeMu) {
                  setMakingRoom(installable.instanceId);
                  return;
                }
                if (onIce) {
                  setPickingHost(installable.instanceId);
                  return;
                }
                onAction({ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: installable.instanceId });
              }}
              disabled={!canNormalInstall && !autoFreeMu}
              title={autoFreeMu ? 'Not enough memory — click to choose installed programs to trash first' : (installBlocked ?? (onIce ? 'Choose the ice to install it on' : undefined))}
              className={`px-2 py-1.5 bg-gradient-to-b from-pink-600 to-pink-800 hover:from-pink-500 hover:to-pink-700 text-white text-xs font-bold border border-pink-400 border-b-2 border-b-pink-300 transition-all flex items-center gap-1.5 shadow-lg animate-pulse disabled:opacity-40 disabled:animate-none active:translate-y-[1px] active:border-b-[1px] ${
                splitTrash ? 'rounded-l-[2px]' : 'rounded-[2px]'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{onIce ? `Install ${cardDef(installable).title}` : 'Install Card'}</span>
              <LiveCostParens printed={cardDef(installable).cost ?? 0} live={runnerInstallCost(state, installable)} />
              {autoFreeMu && <span className="text-pink-200 font-normal">— free MU…</span>}
            </button>
          );
          if (!splitTrash) return mainBtn;
          return (
            <div className="inline-flex items-stretch">
              {mainBtn}
              <TrashSplitSegment
                title="Trash installed programs first"
                onClick={() => setMakingRoom(installable.instanceId)}
                testId="install-trash-programs"
                className="border-pink-400 border-b-pink-300"
              />
            </div>
          );
        })()}
        <InspectSelectedButton side="runner" selectedCard={selectedCard} onInspect={onInspect} />
        {installable && installBlocked !== null && !autoFreeMu && (
          <span className="w-full text-xs text-amber-300 font-mono" data-testid="install-blocked-reason">
            Can't install: {installBlocked}
          </span>
        )}
        {hostedActions.map(a => {
          if (a.type !== 'INSTALL_CARD' && a.type !== 'PLAY_OPERATION_OR_EVENT') return null;
          const onIceHosted = a.type === 'INSTALL_CARD' && !!a.hostInstanceId;
          // A hosted trojan gets one button that opens the ice picker, not one button per ice
          if (onIceHosted && hostedActions.find(b => b.type === 'INSTALL_CARD' && b.cardInstanceId === a.cardInstanceId) !== a) return null;
          const hosted = findCardAnywhere(state, a.cardInstanceId);
          if (!hosted) return null;
          const hostedSplit = a.type === 'INSTALL_CARD' && canMakeRoomFor(hosted);
          const btn = (
            <button
              key={`${a.type}-${a.cardInstanceId}`}
              onClick={() => (onIceHosted ? setPickingHost(a.cardInstanceId) : onAction(a))}
              data-testid={`hosted-${a.cardInstanceId}`}
              className={`px-2 py-1.5 bg-gradient-to-b from-pink-900/90 to-pink-900/40 hover:from-pink-800/90 hover:to-pink-800/40 border border-pink-600/80 border-b-2 border-b-pink-400 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow active:translate-y-[1px] active:border-b-[1px] ${
                hostedSplit ? 'rounded-l-[2px]' : 'rounded-[2px]'
              }`}
              title={onIceHosted ? 'This card is hosted faceup on your hardware; choose the ice to install it on' : 'This card is hosted faceup on your hardware'}
            >
              {a.type === 'INSTALL_CARD' ? <Plus className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
              <span>{a.type === 'INSTALL_CARD' ? 'Install' : 'Play'} hosted {cardDef(hosted).title}</span>
              <LiveCostParens
                printed={cardDef(hosted).cost ?? 0}
                live={a.type === 'INSTALL_CARD' ? runnerInstallCost(state, hosted) : playCost(state, hosted)}
              />
            </button>
          );
          if (!hostedSplit) return btn;
          return (
            <div key={`${a.type}-${a.cardInstanceId}`} className="inline-flex items-stretch">
              {btn}
              <TrashSplitSegment
                title="Trash installed programs first"
                onClick={() => setMakingRoom(hosted.instanceId)}
                testId={`hosted-room-${hosted.instanceId}`}
                className="border-pink-600/80 border-b-pink-400"
              />
            </div>
          );
        })}
        {hostedNeedingRoom.map(c => (
          <button
            key={`room-${c.instanceId}`}
            onClick={() => setMakingRoom(c.instanceId)}
            data-testid={`hosted-room-${c.instanceId}`}
            title="Not enough memory: click to trash installed programs first"
            className="px-2 py-1.5 bg-gradient-to-b from-pink-900/90 to-pink-900/40 hover:from-pink-800/90 hover:to-pink-800/40 border border-pink-600/80 border-b-2 border-b-pink-400 text-white text-xs font-bold rounded-[2px] transition-all flex items-center gap-1.5 shadow active:translate-y-[1px] active:border-b-[1px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Install hosted {cardDef(c).title}</span>
            <LiveCostParens printed={cardDef(c).cost ?? 0} live={runnerInstallCost(state, c)} />
            <span className="text-pink-200 font-normal">— free MU…</span>
          </button>
        ))}
      </div>

      {/* End Turn Button - Prominently Anchored */}
      <button
        onClick={() => onAction({ type: 'END_TURN', player: 'runner' })}
        disabled={!seat.can({ type: 'END_TURN', player: 'runner' })}
        data-testid="end-turn"
        className={`px-3 py-1.5 bg-gradient-to-b from-pink-600 to-pink-800 hover:from-pink-500 hover:to-pink-700 text-white font-mono text-xs font-bold rounded-[2px] border border-pink-400 border-b-2 border-b-pink-300 transition-all shadow-lg shadow-pink-950 flex items-center gap-1.5 self-end disabled:opacity-40 active:translate-y-[1px] active:border-b-[1px] ${
          runner.clicks === 0 ? 'end-turn-pulse end-turn-runner' : ''
        }`}
      >
        End Runner Turn <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
