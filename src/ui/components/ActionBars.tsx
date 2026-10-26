import { useEffect, useState } from 'react';
import { ArrowRight, Biohazard, Layers, Plus, Tag, Trash2, Zap } from 'lucide-react';
import { CardInstance, GameAction, GameState, SideCode, cardDef, findCardAnywhere, getCardScript, getLegalActions, isLegalAction, trashableFirst } from '../../core';
import { TrashFirstButton, TrashFirstPicker } from './TrashFirstPicker';
import { CreditIcon, Credits } from './CreditIcon';
import { CorpInstallOptions } from './CorpInstallOptions';
import { hostedCardActions, illegalReason } from '../legal';
import { cardPositionLabel } from '../cardLabels';
import { hoverPromptTarget } from '../promptHighlight';

interface ActionBarProps {
  state: GameState;
  /** The hand card the player has selected, if any. */
  selectedCard: CardInstance | undefined;
  onAction: (action: GameAction) => void;
}

const isPlayable = (card: CardInstance | undefined) => !!card && ['operation', 'event'].includes(cardDef(card).type_code);

/** "Play <card>" for a selected operation or event of this side. */
function PlayButton({ side, state, selectedCard, onAction }: ActionBarProps & { side: SideCode }) {
  if (!selectedCard || !isPlayable(selectedCard) || cardDef(selectedCard).side_code !== side) return null;
  const action: GameAction = { type: 'PLAY_OPERATION_OR_EVENT', player: side, cardInstanceId: selectedCard.instanceId };
  const implemented = Boolean(getCardScript(selectedCard.cardCode)?.onPlay);
  return (
    <button
      onClick={() => onAction(action)}
      disabled={!isLegalAction(state, action)}
      title={implemented ? undefined : 'This card\'s effect is not implemented yet'}
      className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-lg disabled:opacity-40 disabled:animate-none animate-pulse"
    >
      <Zap className="w-3.5 h-3.5" /> {implemented ? `Play ${cardDef(selectedCard).title}` : 'Effect not implemented yet'}
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
      className="px-2 py-1 bg-cyber-neonPink hover:bg-pink-600 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-lg"
    >
      <Plus className="w-3.5 h-3.5" /> Install on {host.isRezzed ? cardDef(host).title : 'unrezzed ice'} · {position}
    </button>
  );
}

/** The Corp's click actions, plays and installs for the selected card, and End Turn. */
export function CorpActions(props: ActionBarProps) {
  const { state, selectedCard, onAction } = props;
  const { corp } = state;
  const startingTurn = state.turnStep?.kind === 'corp_turn_start';
  const turnAction: GameAction = startingTurn ? { type: 'START_TURN', player: 'corp' } : { type: 'END_TURN', player: 'corp' };
  return (
    <div className="flex flex-col gap-2 p-2 bg-cyan-950/40 border border-cyan-800/80 chamfer-sm shadow-inner">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-bold text-cyan-400 font-mono uppercase w-full">Corp Actions ({corp.clicks} Clicks):</span>
        <button
          onClick={() => onAction({ type: 'GAIN_CREDIT', player: 'corp' })}
          disabled={corp.clicks < 1}
          className="px-2 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
        >
          <CreditIcon className="w-3.5 h-3.5 text-amber-400" /> +1 Credit
        </button>
        <button
          onClick={() => onAction({ type: 'DRAW_CARD', player: 'corp' })}
          disabled={corp.clicks < 1}
          className="px-2 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
        >
          <Layers className="w-3.5 h-3.5 text-cyan-400" /> Draw Card
        </button>
        <button
          onClick={() => onAction({ type: 'PURGE_VIRUS', player: 'corp' })}
          disabled={!isLegalAction(state, { type: 'PURGE_VIRUS', player: 'corp' })}
          className="px-2 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
          title="Spend 3 clicks to remove every virus counter"
        >
          <Biohazard className="w-3.5 h-3.5 text-lime-400" /> Purge (3 clicks)
        </button>
        {getLegalActions(state, 'corp').map(a => {
          if (a.type !== 'TRASH_RESOURCE') return null;
          const res = findCardAnywhere(state, a.cardInstanceId);
          return (
            <button
              key={a.cardInstanceId}
              onClick={() => onAction(a)}
              className="px-2 py-1 bg-red-950 hover:bg-red-900 border border-red-700 text-red-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow"
              title="The Runner is tagged: spend a click and 2 credits to trash this resource"
            >
              <Trash2 className="w-3.5 h-3.5" /> Trash {res ? cardDef(res).title : 'resource'} (1 click + <Credits amount={2} />)
            </button>
          );
        })}
        <PlayButton {...props} side="corp" />
        {selectedCard && !isPlayable(selectedCard) && cardDef(selectedCard).side_code === 'corp' && (
          <CorpInstallOptions state={state} card={selectedCard} onAction={onAction} />
        )}
      </div>

      {/* End Turn Button - Prominently Anchored (before the turn begins it takes the mandatory draw instead) */}
      <button
        onClick={() => onAction(turnAction)}
        disabled={!isLegalAction(state, turnAction)}
        title={startingTurn ? 'Rez assets or upgrades first if you want them working this turn, then take the mandatory draw' : undefined}
        className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold rounded-lg border border-cyan-400 transition-all shadow-lg shadow-cyan-950 flex items-center gap-1.5 self-end disabled:opacity-40 disabled:hover:scale-100"
      >
        {startingTurn ? 'Draw & Start Turn' : 'End Corp Turn'} <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** The Runner's click actions, plays and installs for the selected card (or cards hosted on hardware), and End Turn. */
export function RunnerActions(props: ActionBarProps) {
  const { state, selectedCard, onAction } = props;
  const { runner } = state;
  const installable = selectedCard && !isPlayable(selectedCard) ? selectedCard : undefined;
  const onIce = installable && getCardScript(installable.cardCode)?.installsOnIce;
  // Why the selected grip card can't be installed now (shown on the disabled Install button), or null if it can
  const installBlocked =
    installable && cardDef(installable).side_code === 'runner'
      ? illegalReason(state, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: installable.instanceId })
      : null;
  // Programs: trash installed programs first (rules 8.5.6c), which the memory limit may require
  const [makingRoom, setMakingRoom] = useState<string | null>(null);
  const installTrashing = (trashFirst: string[]): GameAction => ({ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: installable!.instanceId, trashFirst });
  const programs = installable && !onIce ? trashableFirst(state, installable, null) : [];
  const canMakeRoom = programs.length > 0 && isLegalAction(state, installTrashing(programs.map(c => c.instanceId)));
  if (installable && makingRoom === installable.instanceId) {
    return (
      <div className="flex flex-col gap-2 p-2 bg-pink-950/40 border border-pink-800/80 chamfer-sm shadow-inner">
        <TrashFirstPicker
          key={installable.instanceId}
          heading={`Install ${cardDef(installable).title}, trashing first:`}
          cards={programs}
          confirmLabel={trash => `Install${trash.length > 0 ? `, trash ${trash.length}` : ''}`}
          canConfirm={trash => isLegalAction(state, installTrashing(trash))}
          onConfirm={trash => {
            setMakingRoom(null);
            onAction(installTrashing(trash));
          }}
          onCancel={() => setMakingRoom(null)}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-2 bg-pink-950/40 border border-pink-800/80 chamfer-sm shadow-inner">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-bold text-pink-400 font-mono uppercase w-full">Runner Actions ({runner.clicks} Clicks):</span>
        <button
          onClick={() => onAction({ type: 'GAIN_CREDIT', player: 'runner' })}
          disabled={runner.clicks < 1}
          className="px-2 py-1 bg-pink-950 hover:bg-pink-900 border border-pink-700 text-pink-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
        >
          <CreditIcon className="w-3.5 h-3.5 text-amber-400" /> +1 Credit
        </button>
        <button
          onClick={() => onAction({ type: 'DRAW_CARD', player: 'runner' })}
          disabled={runner.clicks < 1}
          className="px-2 py-1 bg-pink-950 hover:bg-pink-900 border border-pink-700 text-pink-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
        >
          <Layers className="w-3.5 h-3.5 text-pink-400" /> Draw Card
        </button>
        {runner.tags > 0 && (
          <button
            onClick={() => onAction({ type: 'REMOVE_TAG', player: 'runner' })}
            disabled={!isLegalAction(state, { type: 'REMOVE_TAG', player: 'runner' })}
            className="px-2 py-1 bg-pink-950 hover:bg-pink-900 border border-pink-700 text-pink-200 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-40 shadow"
          >
            <Tag className="w-3.5 h-3.5 text-red-400" /> Remove Tag (1 click + <Credits amount={2} />)
          </button>
        )}
        <PlayButton {...props} side="runner" />
        {installable &&
          onIce &&
          getLegalActions(state, 'runner').map(a => {
            if (a.type !== 'INSTALL_CARD' || a.cardInstanceId !== installable.instanceId || !a.hostInstanceId) return null;
            const host = findCardAnywhere(state, a.hostInstanceId);
            return host ? <InstallOnIceButton key={a.hostInstanceId} state={state} host={host} onClick={() => onAction(a)} /> : null;
          })}
        {installable && !onIce && (
          <button
            onClick={() => onAction({ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: installable.instanceId })}
            disabled={installBlocked !== null}
            title={installBlocked ?? undefined}
            className="px-2 py-1 bg-cyber-neonPink hover:bg-pink-600 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-lg animate-pulse disabled:opacity-40 disabled:animate-none"
          >
            <Plus className="w-3.5 h-3.5" /> Install Card
          </button>
        )}
        {installable && canMakeRoom && (
          <TrashFirstButton
            label="Trash programs first"
            title="Trash installed programs first, to free memory for this one"
            onClick={() => setMakingRoom(installable.instanceId)}
            testId="install-trash-programs"
          />
        )}
        {hostedCardActions(state).map(a => {
          if (a.type !== 'INSTALL_CARD' && a.type !== 'PLAY_OPERATION_OR_EVENT') return null;
          const hosted = findCardAnywhere(state, a.cardInstanceId);
          if (!hosted) return null;
          return (
            <button
              key={`${a.type}-${a.cardInstanceId}-${a.type === 'INSTALL_CARD' ? a.hostInstanceId ?? '' : ''}`}
              onClick={() => onAction(a)}
              data-testid={`hosted-${a.cardInstanceId}`}
              className="px-2 py-1 bg-pink-900 hover:bg-pink-800 border border-pink-500 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow"
              title="This card is hosted faceup on your hardware"
            >
              {a.type === 'INSTALL_CARD' ? <Plus className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
              {a.type === 'INSTALL_CARD' ? 'Install' : 'Play'} hosted {cardDef(hosted).title}
            </button>
          );
        })}
      </div>

      {/* End Turn Button - Prominently Anchored */}
      <button
        onClick={() => onAction({ type: 'END_TURN', player: 'runner' })}
        disabled={!isLegalAction(state, { type: 'END_TURN', player: 'runner' })}
        className="px-3 py-1.5 bg-cyber-neonPink hover:bg-pink-600 text-white font-mono text-xs font-bold rounded-lg border border-pink-400 transition-all shadow-lg shadow-pink-950 flex items-center gap-1.5 self-end disabled:opacity-40 disabled:hover:scale-100"
      >
        End Runner Turn <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
