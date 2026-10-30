import React from 'react';
import { GameState } from '../../core/types/state';
import { CardInstance } from '../../core/types/card';
import { CardView } from './CardView';
import { cardDef } from '../../data/cards';
import { GameAction, findCardAnywhere, getCardScript, iceStrength, isLegalAction, rezCostOf } from '../../core';
import { EncounterPanel } from './EncounterPanel';
import { ArrowRight, LogOut, CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react';
import { Credits } from './CreditIcon';
import { FloatingPanel } from './FloatingPanel';
import { Keyword } from './Keyword';
import { cardTextHtml } from '../cardText';

/** The glossary entry that explains each run phase. */
const PHASE_KEYWORD: Record<string, string> = {
  approach_ice: 'approach', encounter_ice: 'encounter', movement: 'jack-out', approach_server: 'approach', access: 'breach',
};

interface RunOverlayProps {
  state: GameState;
  onContinueRun: () => void;
  onJackOut: () => void;
  /** Cards the Corp may rez right now (the approached ice, or the server's root), when the viewer is the Corp. */
  rezCards?: CardInstance[];
  onRez?: (card: CardInstance) => void;
  /** Corp abilities offered in the rez window (LEO Construction, Proprionegation). */
  rezAbilities?: Extract<GameAction, { type: 'USE_ABILITY' }>[];
  /** Pass and play: the Corp is done rezzing and hands the screen back. */
  onDoneRezzing?: () => void;
  /** Show Continue, Jack Out and the break buttons (the viewer is the Runner and it is their move). */
  runnerControls: boolean;
  /** May the viewer see unrezzed Corp cards? */
  canPeekCorp: boolean;
  onInspectCard?: (card: CardInstance) => void;
  /** Dispatches break / boost / bioroid actions from the encounter panel. */
  onAction: (action: GameAction) => void;
}

export const RunOverlay: React.FC<RunOverlayProps> = ({
  state,
  onContinueRun,
  onJackOut,
  rezCards = [],
  onRez,
  rezAbilities = [],
  onDoneRezzing,
  runnerControls,
  canPeekCorp,
  onInspectCard,
  onAction,
}) => {
  const { activeRun } = state;
  if (!activeRun) return null;

  const server = state.corp.servers[activeRun.server];
  const currentIce =
    activeRun.icePosition !== null && server ? server.ice[activeRun.icePosition] : null;
  const canJackOut = isLegalAction(state, { type: 'JACK_OUT', player: 'runner' });
  const continueLabel =
    activeRun.phase === 'encounter_ice'
      ? activeRun.encounter?.broken.some(b => !b)
        ? 'Let Subroutines Fire'
        : 'Pass Ice'
      : activeRun.phase === 'approach_ice' && currentIce && !currentIce.isRezzed
        ? 'Pass Unrezzed Ice'
        : activeRun.phase === 'movement'
          ? 'Keep Going'
          : 'Continue Run';

  return (
    <FloatingPanel
      testId="run-overlay"
      zIndexClass="z-40"
      accentClass="border-cyber-neonPink"
      dotClass="bg-pink-400"
      defaultPlacement="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      minimizedPlacement="left-1/2 top-32 -translate-x-1/2"
      widthClass="w-[48rem]"
      minimizedLabel={`Run on ${server?.name ?? 'server'}: ${activeRun.phase.replace(/_/g, ' ')}`}
      title={
        <div className="flex items-center justify-between gap-2 border-b border-pink-900/50 pb-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyber-neonPink"></span>
            </span>
            <h3 className="font-cyber font-bold text-cyber-neonPink text-sm tracking-wider truncate">
              RUN IN PROGRESS // {server?.name?.toUpperCase()}
            </h3>
          </div>
          <span className="text-xs font-mono bg-pink-950 text-pink-300 px-2.5 py-1 rounded-lg border border-pink-700 font-bold shrink-0">
            PHASE: <Keyword id={PHASE_KEYWORD[activeRun.phase] ?? 'run'}>{activeRun.phase.toUpperCase()}</Keyword>
          </span>
        </div>
      }
    >

        <div className="flex items-center gap-5 my-2">
          {currentIce ? (
            <div className="flex items-center gap-4 bg-black/60 p-3 rounded-2xl border border-slate-800 flex-1">
              <CardView
                card={currentIce}
                isFaceDown={!currentIce.isRezzed && !currentIce.faceUp}
                canPeek={canPeekCorp || !!currentIce.runnerKnows}
                seen={!canPeekCorp && !!currentIce.runnerKnows && !currentIce.isRezzed && !currentIce.faceUp}
                size="md"
                typeIcons
                onInspect={currentIce.isRezzed || currentIce.faceUp || canPeekCorp || currentIce.runnerKnows ? onInspectCard : undefined}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldAlert className="w-4 h-4 text-pink-400" />
                  <span className="text-sm font-bold text-slate-100 font-cyber">
                    {currentIce.isRezzed ? cardDef(currentIce).title : 'Unrezzed Ice Encounter'}
                  </span>
                </div>
                <div className="text-xs text-slate-400 font-mono leading-relaxed">
                  {currentIce.isRezzed ? (
                    <>
                      <div className="text-cyan-300 font-bold">
                        <Keyword id="strength">Strength</Keyword>: {iceStrength(state, currentIce)} • {cardDef(currentIce).keywords}
                      </div>
                      <div
                        className="text-[12px] text-slate-300 mt-1 max-h-28 overflow-y-auto"
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
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800 p-4 rounded-2xl flex-1">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
              <span>
                {activeRun.phase === 'movement'
                  ? 'No ice left between you and the server. Jack out now, or go on to the server.'
                  : 'Breached Ice defense! Approaching server root to access files.'}
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 shrink-0">
            {onRez &&
              rezCards.map(card => (
                <button
                  key={card.instanceId}
                  onClick={() => onRez(card)}
                  data-testid={`rez-${card.instanceId}`}
                  className="px-5 py-2 bg-cyan-700 hover:bg-cyan-600 text-white font-mono text-xs font-bold rounded-xl border border-cyan-400 flex items-center justify-center gap-1.5 transition-colors"
                  title="Corp rez window: rez this card before the Runner continues"
                >
                  <ShieldAlert className="w-4 h-4" /> Rez {cardDef(card).title} (<Credits amount={rezCostOf(state, card)} />)
                </button>
              ))}
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
                    className="px-5 py-2 bg-cyan-900 hover:bg-cyan-800 text-white font-mono text-xs font-bold rounded-xl border border-cyan-500 flex items-center justify-center gap-1.5 transition-colors max-w-[16rem]"
                    title={ability.label}
                  >
                    <Sparkles className="w-4 h-4 text-amber-300 shrink-0" /> {cardDef(source).title}
                  </button>
                );
              })}
            {onDoneRezzing && (
              <button
                onClick={onDoneRezzing}
                data-testid="done-rezzing"
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-bold rounded-xl border border-slate-600 flex items-center justify-center gap-1.5 transition-colors"
              >
                {rezCards.length > 0 ? "Don't rez" : rezAbilities.length > 0 ? 'Let them in' : 'Done'} <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {runnerControls && (
            <>
            <button
              onClick={onContinueRun}
              className="px-5 py-2.5 bg-cyber-neonPink hover:bg-pink-600 text-white font-mono text-xs font-bold rounded-xl shadow-lg flex items-center justify-center gap-1.5 transition-all hover:scale-105"
            >
              {continueLabel} <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={onJackOut}
              disabled={!canJackOut}
              title={canJackOut ? 'End the run now' : 'You can jack out only after passing a piece of ice (or before approaching a server with no ice)'}
              className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-semibold rounded-xl border border-slate-700 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:hover:bg-slate-800"
            >
              <LogOut className="w-4 h-4" /> Jack Out
            </button>
            </>
            )}
            {!runnerControls && !onDoneRezzing && (
              <span className="text-xs text-slate-400 font-mono max-w-[10rem]">Waiting on the Runner…</span>
            )}
          </div>
        </div>

        <EncounterPanel state={state} onAction={onAction} readOnly={!runnerControls} />
    </FloatingPanel>
  );
};
