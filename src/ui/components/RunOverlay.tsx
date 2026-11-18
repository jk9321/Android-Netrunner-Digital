import React from 'react';
import { GameState } from '../../core/types/state';
import { CardInstance } from '../../core/types/card';
import { CardView } from './CardView';
import { cardDef } from '../../data/cards';
import { GameAction, findCardAnywhere, getCardScript, iceStrength, iceSubtypes, rezCostOf } from '../../core';
import { useSeat } from '../seat';
import { EncounterPanel } from './EncounterPanel';
import { ArrowRight, LogOut, CheckCircle2, ShieldAlert, Play, ExternalLink, PanelRight, Eye } from 'lucide-react';
import { Credits } from './CreditIcon';
import { RezIcon } from './ServerColumn';
import { FloatingPanel } from './FloatingPanel';
import { Keyword } from './Keyword';
import { cardTextHtml } from '../cardText';
import { runCreditPools } from '../liveValues';

/** The glossary entry that explains each run phase. */
const PHASE_KEYWORD: Record<string, string> = {
  approach_ice: 'approach', encounter_ice: 'encounter', movement: 'jack-out', approach_server: 'approach', access: 'breach',
};

export interface RunOverlayProps {
  state: GameState;
  onContinueRun: () => void;
  onJackOut: () => void;
  /** Cards the Corp may rez right now (the approached ice, or the server's root), when the viewer is the Corp. */
  rezCards?: CardInstance[];
  onRez?: (card: CardInstance) => void;
  /** Corp abilities offered in the rez window (LEO Construction, Proprionegation). */
  rezAbilities?: Extract<GameAction, { type: 'USE_ABILITY' }>[];
  /** The Corp passes priority in this paid ability window (rules 9.2.7a). */
  onDoneRezzing?: () => void;
  /** The Corp passes this window and every later one in the run. */
  onPassRun?: () => void;
  /** Show Continue, Jack Out and the break buttons (the viewer is the Runner and it is their move). */
  runnerControls: boolean;
  /** May the viewer see unrezzed Corp cards? */
  canPeekCorp: boolean;
  onInspectCard?: (card: CardInstance) => void;
  /** Dispatches break / boost / bioroid actions from the encounter panel. */
  onAction: (action: GameAction) => void;
  /** Render docked full-height inside the right sidebar rather than as a floating window. */
  docked?: boolean;
  /** Toggle between sidebar-docked mode and floating pop-out mode. */
  onToggleDock?: () => void;
}

export const RunOverlay: React.FC<RunOverlayProps> = ({
  state,
  onContinueRun,
  onJackOut,
  rezCards = [],
  onRez,
  rezAbilities = [],
  onDoneRezzing,
  onPassRun,
  runnerControls,
  canPeekCorp,
  onInspectCard,
  onAction,
  docked = false,
  onToggleDock,
}) => {
  const seat = useSeat();
  const { activeRun } = state;
  if (!activeRun) return null;

  const server = state.corp.servers[activeRun.server];
  const pools = runCreditPools(state);
  const currentIce =
    activeRun.icePosition !== null && !activeRun.positionEmpty && server ? server.ice[activeRun.icePosition] : null;
  const canJackOut = seat.can({ type: 'JACK_OUT', player: 'runner' });
  const step = state.priority?.step;
  const continueLabel =
    step === 'run_initiation'
      ? 'Approach'
      : step === 'move_inward'
        ? 'Move Inward'
        : activeRun.phase === 'encounter_ice'
      ? activeRun.encounter?.broken.some(b => !b)
        ? 'Let Subroutines Fire'
        : 'Pass Ice'
      : activeRun.phase === 'approach_ice' && currentIce && !currentIce.isRezzed
        ? 'Pass Unrezzed Ice'
        : activeRun.phase === 'movement'
          ? 'Keep Going'
          : 'Continue Run';

  const statusBadges = (
    <div className={`flex items-center gap-1.5 flex-wrap ${docked ? '' : 'sm:gap-2 justify-end'}`}>
      {pools.runner && (
        <span
          data-testid="run-spendable-pool"
          title={
            pools.runner.poolLocked
              ? `Your normal credit pool (${pools.runner.pool}) cannot be spent during this run`
              : `Total credits you can spend during this run (${pools.runner.pool} in pool + ${pools.runner.bonus} from run/hosted sources)`
          }
          className={`text-[11px] sm:text-xs font-mono px-2 py-0.5 rounded-[2px] border font-bold shrink-0 inline-flex items-center gap-1 ${
            docked ? '' : 'sm:px-2.5 sm:py-1'
          } ${
            pools.runner.poolLocked
              ? 'bg-amber-950/90 text-amber-200 border-amber-500/80'
              : 'bg-emerald-950/90 text-emerald-200 border-emerald-500/80'
          }`}
        >
          <span>
            SPENDABLE: <Credits amount={pools.runner.total} />
          </span>
          <span className={pools.runner.poolLocked ? 'text-amber-300/90 font-normal' : 'text-emerald-300/90 font-normal'}>
            {pools.runner.poolLocked
              ? `(${pools.runner.sources.map(s => `${s.amount} ${s.label}`).join(' + ') || '0'} · ${pools.runner.pool} pool locked)`
              : `(${pools.runner.pool} pool ${pools.runner.sources.map(s => `+ ${s.amount} ${s.label}`).join(' ')})`}
          </span>
        </span>
      )}
      {pools.corpRez && (
        <span
          data-testid="run-corp-rez-pool"
          title={`Corp has ${pools.corpRez.bonus} recurring/hosted credits usable to rez cards on ${server?.name ?? 'this server'}`}
          className={`text-[11px] sm:text-xs font-mono bg-cyan-950/90 text-cyan-200 px-2 py-0.5 rounded-[2px] border border-cyan-500/80 font-bold shrink-0 inline-flex items-center gap-1 ${
            docked ? '' : 'sm:px-2.5 sm:py-1'
          }`}
        >
          <span>
            CORP REZ: <Credits amount={pools.corpRez.total} />
          </span>
          <span className="text-cyan-300/90 font-normal">
            ({pools.corpRez.pool} pool {pools.corpRez.sources.map(s => `+ ${s.amount} ${s.label}`).join(' ')})
          </span>
        </span>
      )}
      <span
        className={`text-[11px] sm:text-xs font-mono bg-pink-950 text-pink-300 px-2 py-0.5 rounded-[2px] border border-pink-700/80 font-bold shrink-0 ${
          docked ? '' : 'sm:px-2.5 sm:py-1'
        }`}
      >
        PHASE: <Keyword id={PHASE_KEYWORD[activeRun.phase] ?? 'run'}>{activeRun.phase.toUpperCase()}</Keyword>
      </span>
    </div>
  );

  const btnPad = docked ? 'px-3 py-1.5' : 'px-4 sm:px-5 py-2';
  const actionButtons = (
    <>
      {onRez &&
        rezCards.map(card => {
          const printed = cardDef(card).cost || 0;
          const live = rezCostOf(state, card);
          return (
            <button
              key={card.instanceId}
              onClick={() => onRez(card)}
              data-testid={`rez-${card.instanceId}`}
              className={`${btnPad} bg-cyan-700 hover:bg-cyan-600 text-white font-mono text-xs font-bold rounded-[2px] border border-cyan-400 border-b-2 border-b-cyan-500 active:translate-y-[1px] active:border-b-[1px] flex items-center justify-center gap-1.5 transition-all`}
              title="Corp rez window: rez this card before the Runner continues"
            >
              <RezIcon className="w-4 h-4 shrink-0" /> Rez {cardDef(card).title} (
              {live !== printed ? (
                <span className={live < printed ? 'text-emerald-300' : 'text-amber-300'}>
                  <s className="opacity-65 mr-0.5">{printed}</s>
                  <Credits amount={live} />
                </span>
              ) : (
                <Credits amount={live} />
              )}
              )
            </button>
          );
        })}
      {onRez &&
        rezAbilities.map(action => {
          const source = findCardAnywhere(state, action.cardInstanceId);
          const ability = source && getCardScript(source.cardCode)?.abilities?.[action.abilityIndex];
          if (!source || !ability) return null;
          return (
            <button
              key={`${action.cardInstanceId}-${action.abilityIndex}`}
              onClick={() => onAction(action)}
              data-testid={`run-ability-${action.cardInstanceId}`}
              className={`${btnPad} bg-cyan-900 hover:bg-cyan-800 text-white font-mono text-xs font-bold rounded-[2px] border border-cyan-500 border-b-2 border-b-cyan-600 active:translate-y-[1px] active:border-b-[1px] flex items-center justify-center gap-1.5 transition-all max-w-[16rem]`}
              title={ability.label}
            >
              <Play className="w-4 h-4 text-amber-300 shrink-0" /> {cardDef(source).title}
            </button>
          );
        })}
      {onDoneRezzing && (
        <button
          onClick={onDoneRezzing}
          data-testid="done-rezzing"
          className={`${btnPad} bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-bold rounded-[2px] border border-slate-600 border-b-2 border-b-slate-500 active:translate-y-[1px] active:border-b-[1px] flex items-center justify-center gap-1.5 transition-all`}
        >
          {rezCards.length > 0 ? "Don't rez" : 'Pass'} <ArrowRight className="w-4 h-4" />
        </button>
      )}
      {onPassRun && (
        <button
          onClick={onPassRun}
          data-testid="pass-run"
          title="Pass every remaining paid ability window in this run: you will not be asked to rez or use abilities again until it ends"
          className={`${btnPad} bg-slate-900 hover:bg-slate-800 text-slate-400 font-mono text-xs font-semibold rounded-[2px] border border-slate-700 flex items-center justify-center gap-1.5 transition-all`}
        >
          Pass rest of run
        </button>
      )}
      {runnerControls && (
        <>
          <button
            onClick={onContinueRun}
            className={`${docked ? 'flex-1 px-3 py-2' : 'flex-1 sm:flex-initial px-4 sm:px-5 py-2 sm:py-2.5'} bg-gradient-to-b from-pink-600 to-pink-700 hover:from-pink-500 hover:to-pink-600 text-white font-mono text-xs font-bold rounded-[2px] border-b-2 border-b-pink-400 active:translate-y-[1px] active:border-b-[1px] shadow-lg flex items-center justify-center gap-1.5 transition-all`}
          >
            {continueLabel} <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={onJackOut}
            disabled={!canJackOut}
            title={canJackOut ? 'End the run now' : 'You can jack out only after passing a piece of ice (or before approaching a server with no ice)'}
            className={`${btnPad} bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-semibold rounded-[2px] border border-slate-700 border-b-2 border-b-slate-600 active:translate-y-[1px] active:border-b-[1px] flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:hover:bg-slate-800`}
          >
            <LogOut className="w-4 h-4" /> Jack Out
          </button>
        </>
      )}
      {!runnerControls && !onDoneRezzing && (
        <span className="text-xs text-slate-400 font-mono max-w-[14rem]">
          Waiting on the {state.priority?.holder === 'corp' ? 'Corp' : 'Runner'}…
        </span>
      )}
    </>
  );

  const iceInspectable =
    currentIce && (currentIce.isRezzed || currentIce.faceUp || canPeekCorp || currentIce.runnerKnows);

  const iceSummaryText = currentIce ? (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert className="w-4 h-4 text-pink-400 shrink-0" />
        <span className="text-xs sm:text-sm font-bold text-slate-100 font-cyber truncate flex-1 min-w-0">
          {currentIce.isRezzed ? cardDef(currentIce).title : 'Unrezzed Ice Encounter'}
        </span>
        {docked && iceInspectable && onInspectCard && (
          <button
            type="button"
            onClick={() => onInspectCard(currentIce)}
            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[11px] font-mono text-amber-300 hover:text-amber-100 hover:bg-slate-800 border border-slate-700/80"
            title="Inspect card art and rules text"
          >
            <Eye className="w-3 h-3" /> Details
          </button>
        )}
      </div>
      <div className="text-xs text-slate-400 font-mono leading-relaxed">
        {currentIce.isRezzed ? (
          <>
            <div className="text-cyan-300 font-bold">
              <Keyword id="strength">Strength</Keyword>: {iceStrength(state, currentIce)} • {cardDef(currentIce).keywords}
            </div>
            <div
              className="text-[12px] text-slate-300 mt-1 max-h-24 sm:max-h-28 overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: cardTextHtml(cardDef(currentIce).text ?? '') }}
            />
          </>
        ) : activeRun.phase === 'movement' ? (
          'Passed. Jack out now, or keep going inward.'
        ) : (
          'Ice is unrezzed. Corporation has a rez window before the Runner encounters subroutines.'
        )}
      </div>
    </div>
  ) : (
    <div className="flex items-center gap-3 text-xs sm:text-sm font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800 p-3 rounded-[2px] flex-1">
      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
      <span>
        {activeRun.phase === 'initiation'
          ? server && server.ice.length > 0
            ? 'The run has begun. Next the Runner approaches the outermost ice.'
            : 'The run has begun. No ice protects this server.'
          : activeRun.phase === 'movement'
          ? 'No ice left between you and the server. Jack out now, or go on to the server.'
          : 'Breached Ice defense! Approaching server root to access files.'}
      </span>
    </div>
  );

  if (docked) {
    return (
      <div
        data-testid="run-overlay"
        className="shrink min-h-[min(56vh,calc(100%-7.5rem))] flex flex-col bg-[#090d15] border-2 border-cyber-neonPink rounded-[2px] shadow-2xl font-mono overflow-hidden"
      >
        <div className="px-3 py-2 border-b border-pink-900/50 bg-[#0c121d] shrink-0 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyber-neonPink"></span>
              </span>
              <h3 className="font-cyber font-bold text-cyber-neonPink text-xs tracking-wider truncate">
                RUN // {server?.name?.toUpperCase()}
              </h3>
            </div>
            {onToggleDock && (
              <button
                type="button"
                onClick={onToggleDock}
                data-testid="run-overlay-popout"
                title="Pop out into floating window"
                aria-label="Pop out run panel"
                className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[11px] font-mono text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700"
              >
                <ExternalLink className="w-3 h-3" /> Pop out
              </button>
            )}
          </div>
          {statusBadges}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
          {currentIce ? (
            <div className="bg-[#080d14] p-2.5 rounded-[2px] border border-slate-800">{iceSummaryText}</div>
          ) : (
            iceSummaryText
          )}

          <EncounterPanel state={state} onAction={onAction} readOnly={!runnerControls} compact />
        </div>

        <div className="p-2 border-t border-pink-900/50 bg-[#070a11] flex flex-wrap items-center gap-1.5 shrink-0">
          {actionButtons}
        </div>
      </div>
    );
  }

  return (
    <FloatingPanel
      testId="run-overlay"
      zIndexClass="z-40"
      accentClass="border-cyber-neonPink"
      dotClass="bg-pink-400"
      defaultPlacement="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      minimizedPlacement="left-1/2 top-32 -translate-x-1/2"
      widthClass="w-[50rem]"
      minimizedLabel={`Run on ${server?.name ?? 'server'}: ${activeRun.phase.replace(/_/g, ' ')}`}
      headerActions={
        onToggleDock ? (
          <button
            type="button"
            onClick={onToggleDock}
            data-testid="run-overlay-dock"
            title="Dock run panel back into sidebar"
            aria-label="Dock run panel"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-[11px] font-mono text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/80 shrink-0"
          >
            <PanelRight className="w-3.5 h-3.5" /> Dock
          </button>
        ) : undefined
      }
      title={
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-pink-900/50 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 sm:h-3.5 sm:w-3.5 bg-cyber-neonPink"></span>
            </span>
            <h3 className="font-cyber font-bold text-cyber-neonPink text-xs sm:text-sm tracking-wider truncate">
              RUN IN PROGRESS // {server?.name?.toUpperCase()}
            </h3>
          </div>
          {statusBadges}
        </div>
      }
    >
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-5 my-2">
        {currentIce ? (
          <div className="flex items-center gap-3 sm:gap-4 bg-[#080d14] p-2.5 sm:p-3 rounded-[2px] border border-slate-800 flex-1 min-w-0">
            <CardView
              card={currentIce}
              isFaceDown={!currentIce.isRezzed && !currentIce.faceUp}
              canPeek={canPeekCorp || !!currentIce.runnerKnows}
              seen={!canPeekCorp && !!currentIce.runnerKnows && !currentIce.isRezzed && !currentIce.faceUp}
              size="md"
              typeIcons={iceSubtypes(currentIce, state)}
              onInspect={iceInspectable ? onInspectCard : undefined}
            />
            {iceSummaryText}
          </div>
        ) : (
          iceSummaryText
        )}

        {/* Action buttons */}
        <div className="flex flex-row sm:flex-col flex-wrap gap-2 shrink-0 justify-end">
          {actionButtons}
        </div>
      </div>

      <EncounterPanel state={state} onAction={onAction} readOnly={!runnerControls} />
    </FloatingPanel>
  );
};
