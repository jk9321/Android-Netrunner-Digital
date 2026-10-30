import React from 'react';
import { RunState, ServerState } from '../../core/types/state';
import { CardInstance, SideCode } from '../../core/types/card';
import type { Viewer } from '../viewer';
import { CardView } from './CardView';
import { cardDef } from '../../data/cards';
import { Database, Crosshair, Zap, ChevronsUp, Award, Bug } from 'lucide-react';
import { clearHostLink, lightHostLink, useHostLinkLit } from '../hostLinks';
import type { IceSubtype } from '../../core/scripts/types';
import { Credits } from './CreditIcon';

interface ServerColumnProps {
  server: ServerState;
  activePlayer: SideCode;
  perspective?: Viewer;
  /** The run in progress, when it targets this server: highlights the server and the ice the Runner is at. */
  run?: RunState | null;
  onInitiateRun?: (serverId: string) => void;
  onSelectServer?: (serverId: string) => void;
  onRezCard?: (instanceId: string) => void;
  onAdvanceCard?: (instanceId: string, serverId: string) => void;
  onScoreCard?: (instanceId: string) => void;
  /** Legality checks from the engine; buttons only show when the action is legal. */
  canRez?: (card: CardInstance) => boolean;
  canAdvance?: (card: CardInstance) => boolean;
  canScore?: (card: CardInstance) => boolean;
  onInspectCard?: (card: CardInstance) => void;
  /** A central server's own card, first in its root: HQ's identity, R&D's deck, the Archives pile. */
  anchor?: React.ReactNode;
  /** Runner cards installed on a piece of this server's ice (Botulus, Tranquilizer). */
  hostedOnIce?: (ice: CardInstance) => CardInstance[];
  /** The ice's subtypes (barrier, code gate, sentry), shown as icons when the viewer can see the ice. */
  iceTypes?: (ice: CardInstance) => IceSubtype[];
}


/**
 * A piece of ice lying sideways. Trojans on it are named in a tag, and hovering
 * the ice outlines it with them (hover the trojan in the rig for the reverse).
 */
const IceSlot: React.FC<{
  ice: CardInstance;
  hosted: CardInstance[];
  atRunner: boolean;
  children: React.ReactNode;
}> = ({ ice, hosted, atRunner, children }) => {
  const lit = useHostLinkLit(ice.instanceId);
  const link = hosted.length > 0 ? [ice.instanceId, ...hosted.map(h => h.instanceId)] : null;
  return (
    <div
      data-run-ice={atRunner || undefined}
      onMouseEnter={link ? () => lightHostLink(link) : undefined}
      onMouseLeave={link ? clearHostLink : undefined}
      className={`relative card-sideways rounded-xl ${atRunner ? 'run-ice' : ''} ${lit ? 'host-link-lit' : ''}`}
    >
      {children}
    </div>
  );
};

/** The trojans on a piece of ice, named in a tag on it. */
const HostedTag: React.FC<{ ice: CardInstance; hosted: CardInstance[] }> = ({ ice, hosted }) => (
  <div
    data-tip={`Installed on this ice: ${hosted.map(h => cardDef(h).title).join(', ')}`}
    className="pointer-events-auto max-w-full min-w-0 flex items-center gap-[0.2em] rounded bg-pink-950/95 border border-pink-500 px-[0.2em] text-[0.8em] leading-[1.3em] font-bold text-pink-100"
    data-testid={`hosts-${ice.instanceId}`}
  >
    <Bug className="w-[1.1em] h-[1.1em] shrink-0" />
    <span className="truncate">{hosted.map(h => cardDef(h).title).join(', ')}</span>
  </div>
);

const ICE_PHASE_LABEL: Partial<Record<RunState['phase'], string>> = {
  approach_ice: 'Approaching',
  encounter_ice: 'Encountering',
  movement: 'Passed',
};

/** Rez, advance and score sit over the card, so they cost no table height; the card keeps them clear of its badges. */
const smallButton =
  'pointer-events-auto px-[0.2em] w-full bg-cyan-950/95 hover:bg-cyan-800 text-cyan-200 text-[0.9em] leading-[1.6em] font-mono font-bold whitespace-nowrap rounded border border-cyan-500 shadow flex items-center justify-center gap-0.5 transition-all';

export const ServerColumn: React.FC<ServerColumnProps> = ({
  server,
  activePlayer,
  perspective = 'both',
  run = null,
  onInitiateRun,
  onSelectServer,
  onRezCard,
  onAdvanceCard,
  onScoreCard,
  canRez = () => false,
  canAdvance = () => false,
  canScore = () => false,
  onInspectCard,
  anchor,
  hostedOnIce = () => [],
  iceTypes = () => [],
}) => {
  const canCorpPeek = perspective !== 'runner';
  const isRunTarget = run !== null;
  // The ice the Runner is at, and what they're doing there
  const runIceId =
    run && (run.phase === 'approach_ice' || run.phase === 'encounter_ice' || run.phase === 'movement')
      ? (run.encounter?.iceId ?? (run.icePosition !== null ? server.ice[run.icePosition]?.instanceId : undefined))
      : undefined;
  const iceLabel = run ? ICE_PHASE_LABEL[run.phase] : undefined;
  const atRoot = run !== null && (run.phase === 'approach_server' || run.phase === 'access');

  return (
    <div
      onClick={() => onSelectServer && onSelectServer(server.id)}
      data-testid={`server-${server.id}`}
      data-run-target={isRunTarget || undefined}
      style={{ minWidth: 'calc(var(--card-h) + 0.75rem)' }}
      className={`relative shrink-0 flex flex-col items-center gap-1 bg-slate-900/70 border rounded-2xl px-1.5 pt-1 pb-1.5 transition-all duration-200 shadow-lg ${
        isRunTarget
          ? 'border-cyber-neonPink ring-2 ring-cyber-neonPink/60 bg-pink-950/30 run-target'
          : 'border-slate-800 hover:border-slate-600'
      }`}
    >
      {isRunTarget && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-30 px-2 py-0.5 rounded-full bg-cyber-neonPink text-white text-[10px] font-bold font-mono uppercase tracking-widest shadow-lg flex items-center gap-1 whitespace-nowrap pointer-events-none">
          <Crosshair className="w-3 h-3" /> Run target
        </div>
      )}
      {/* Server Header */}
      <div className="flex items-center justify-between gap-1 w-full text-[12px] font-mono">
        <span className="font-bold text-cyber-neonCyan flex items-center gap-1 truncate" title={server.name}>
          <Database className="w-3 h-3 text-cyan-400 shrink-0" />
          <span className="truncate">{server.name}</span>
        </span>
        {activePlayer === 'runner' && onInitiateRun && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInitiateRun(server.id);
            }}
            className="px-1.5 py-px text-[11px] bg-pink-950/60 text-pink-400 hover:bg-cyber-neonPink hover:text-white rounded border border-pink-500 transition-colors flex items-center gap-1 font-bold shrink-0"
            title="Initiate Run on this server"
          >
            <Crosshair className="w-3 h-3" /> Run
          </button>
        )}
      </div>

      {/* Server Root on the Corp's side: the central's own card, then assets, agendas and upgrades side by side */}
      <div
        className={`relative flex gap-1 flex-nowrap justify-center items-start w-full rounded-xl transition-colors ${
          atRoot ? 'bg-pink-500/10 ring-1 ring-cyber-neonPink/60' : ''
        }`}
      >
        {atRoot && (
          <span className="absolute -top-1 left-1/2 -translate-x-1/2 z-30 px-1.5 rounded-full bg-cyber-neonPink text-white text-[10px] font-bold uppercase tracking-wider whitespace-nowrap pointer-events-none">
            {run?.phase === 'access' ? 'Breaching' : 'Approaching'}
          </span>
        )}
        {anchor}
        {server.root.length === 0 && !anchor ? (
          <div className="card-fit rounded-xl border border-dashed border-slate-800 flex items-center justify-center text-[11px] text-slate-600 italic">
            Empty
          </div>
        ) : (
          server.root.map((card) => (
            <div key={card.instanceId} className="relative">
              <CardView
                card={card}
                isFaceDown={!card.isRezzed && !card.faceUp}
                canPeek={canCorpPeek || !!card.runnerKnows}
                seen={!canCorpPeek && !!card.runnerKnows && !card.isRezzed && !card.faceUp}
                size="fit"
                onInspect={onInspectCard}
                actions={<>
                {canRez(card) && onRezCard && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRezCard(card.instanceId);
                    }}
                    className={smallButton}
                  >
                    <Zap className="w-[1.1em] h-[1.1em] text-amber-400" /> Rez (<Credits amount={cardDef(card).cost || 0} />)
                  </button>
                )}
                {canAdvance(card) && onAdvanceCard && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdvanceCard(card.instanceId, server.id);
                    }}
                    className={smallButton}
                  >
                    <ChevronsUp className="w-[1.1em] h-[1.1em] text-amber-400" /> Adv ({card.advancementCounters}
                    {cardDef(card).advancement_cost ? `/${cardDef(card).advancement_cost}` : ''})
                  </button>
                )}
                {canScore(card) && onScoreCard && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onScoreCard(card.instanceId);
                    }}
                    className={smallButton}
                  >
                    <Award className="w-[1.1em] h-[1.1em] text-amber-400" /> Score
                  </button>
                )}
                </>}
              />
            </div>
          ))
        )}
      </div>

      {/* Protecting Ice, on the Runner's side of the root: innermost at the top, outermost at the bottom */}
      {server.ice.length > 0 && (
        <div className="flex flex-col gap-1 items-center" title={`${server.ice.length} ice`}>
          {server.ice.map((iceCard) => (
            <IceSlot
              key={iceCard.instanceId}
              ice={iceCard}
              hosted={hostedOnIce(iceCard)}
              atRunner={runIceId === iceCard.instanceId}
            >
              {/* Ice lies sideways, as on the table; the zoom panel shows it upright */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90">
                <CardView
                  card={iceCard}
                  isFaceDown={!iceCard.isRezzed && !iceCard.faceUp}
                  canPeek={canCorpPeek || !!iceCard.runnerKnows}
                  seen={!canCorpPeek && !!iceCard.runnerKnows && !iceCard.isRezzed && !iceCard.faceUp}
                  size="fit"
                  sideways
                  onInspect={onInspectCard}
                  // Unrezzed ice keeps its type secret from the Runner
                  typeIcons={iceCard.isRezzed || iceCard.faceUp || canCorpPeek || iceCard.runnerKnows ? iceTypes(iceCard) : []}
                  tag={hostedOnIce(iceCard).length > 0 ? <HostedTag ice={iceCard} hosted={hostedOnIce(iceCard)} /> : undefined}
                  actions={<>
                {canRez(iceCard) && onRezCard && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRezCard(iceCard.instanceId);
                    }}
                    className={smallButton}
                    title={`Rez ${cardDef(iceCard).title} for ${cardDef(iceCard).cost || 0} credits`}
                  >
                    <Zap className="w-[1.1em] h-[1.1em] text-amber-400" /> Rez (<Credits amount={cardDef(iceCard).cost || 0} />)
                  </button>
                )}
                {canAdvance(iceCard) && onAdvanceCard && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdvanceCard(iceCard.instanceId, server.id);
                    }}
                    className={smallButton}
                  >
                    <ChevronsUp className="w-[1.1em] h-[1.1em] text-amber-400" /> Adv ({iceCard.advancementCounters})
                  </button>
                )}
                  </>}
                />
              </div>
              {runIceId === iceCard.instanceId && iceLabel && (
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 z-30 px-1.5 rounded-full bg-amber-400 text-black text-[10px] font-bold font-mono uppercase tracking-wider shadow whitespace-nowrap pointer-events-none">
                  {iceLabel}
                </div>
              )}
            </IceSlot>
          ))}
        </div>
      )}
    </div>
  );
};
