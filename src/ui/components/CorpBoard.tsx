import { useMemo, useRef } from 'react';
import { CardInstance, GameAction, GameState, iceSubtypes, knownInRd } from '../../core';
import type { Seat } from '../seatLegality';
import { canSeeRunnerSecrets, Viewer } from '../viewer';
import { AutoFitArea } from './AutoFitArea';
import { CardView } from './CardView';
import { Pile } from './Pile';
import { SectorRimTrace } from './SectorRimTrace';
import { ServerColumn } from './ServerColumn';
import { SideStrip } from './SideStrip';
import type { ZoneId } from './ZoneViewer';

/** Reversed: Archives sorts first; remotes (-1) keep their order after HQ. */
const CENTRAL_ORDER = ['hq', 'rd', 'archives'];

interface CorpBoardProps {
  gameState: GameState;
  seat: Seat;
  viewer: Viewer;
  corpCanAct: boolean;
  runnerCanAct: boolean;
  onInspectCard: (card: CardInstance) => void;
  onOpenZone: (zone: ZoneId) => void;
  onAction: (action: GameAction) => void;
  isShiftActive: boolean;
  /** True when Corp sits on the bottom half of the tabletop (ice grows upward toward Runner, SideStrip sits along the bottom edge). */
  mirrored?: boolean;
}

/** Corp sector: SideStrip and central & remote servers at full width. */
export function CorpBoard({
  gameState,
  seat,
  viewer,
  corpCanAct,
  runnerCanAct,
  onInspectCard,
  onOpenZone,
  onAction,
  isShiftActive,
  mirrored = false,
}: CorpBoardProps) {
  const corpTabRef = useRef<HTMLDivElement>(null);
  const corpChassisRef = useRef<HTMLElement>(null);
  const { corp, runner, activePlayer, activeRun, winner } = gameState;

  // Runner cards installed on Corp ice (trojans), for ServerColumn host badges
  const onIce = [...runner.rig.programs, ...runner.rig.hardware, ...runner.rig.resources].filter(c => c.hostedOnId);
  const rezAction = (card: CardInstance): GameAction => ({ type: 'REZ_CARD', player: 'corp', cardInstanceId: card.instanceId });

  // The servers only change with the game state or who is looking, so selecting a
  // card, opening a zone or resizing cards reuses them instead of redrawing the whole table.
  // (Their buttons call onAction, which always works on the latest state.)
  const serversView = useMemo(
    () =>
      // Central servers left to right: Archives, R&D, HQ, then remotes
      Object.values(corp.servers)
        .sort((a, b) => CENTRAL_ORDER.indexOf(b.id) - CENTRAL_ORDER.indexOf(a.id))
        .map(server => (
          <ServerColumn
            key={server.id}
            server={server}
            activePlayer={activePlayer}
            perspective={viewer}
            mirrored={mirrored}
            run={activeRun?.server === server.id ? activeRun : null}
            onInitiateRun={
              runnerCanAct
                ? (sId) => onAction({ type: 'INITIATE_RUN', player: 'runner', targetServerId: sId })
                : undefined
            }
            onRezCard={(cId) =>
              onAction({ type: 'REZ_CARD', player: 'corp', cardInstanceId: cId })
            }
            onAdvanceCard={(cId, sId) =>
              onAction({ type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: cId, serverId: sId })
            }
            onScoreCard={(cId) =>
              onAction({ type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: cId })
            }
            canRez={(card) => corpCanAct && seat.can(rezAction(card))}
            canAdvance={(card) =>
              corpCanAct &&
              seat.can({ type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: card.instanceId, serverId: server.id })
            }
            canScore={(card) =>
              corpCanAct && seat.can({ type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: card.instanceId })
            }
            onInspectCard={(card) => onInspectCard(card)}
            hostedOnIce={(ice) => onIce.filter(c => c.hostedOnId === ice.instanceId)}
            iceTypes={(ice) => iceSubtypes(ice, gameState)}
            anchor={
              server.id === 'hq' ? (
                <CardView card={corp.identity} size="fit" notInstalled onInspect={onInspectCard} />
              ) : server.id === 'rd' ? (
                <Pile
                  label="R&D"
                  count={corp.rd.length}
                  side="corp"
                  size="fit"
                  hideLabel
                  // Nobody may look through the decks during play; once the game is over anyone can (rules 1.7.1).
                  // During play it opens the cards the Runner has seen in R&D.
                  onClick={
                    gameState.winner || (canSeeRunnerSecrets(viewer) && knownInRd(gameState).length > 0)
                      ? () => onOpenZone('rd')
                      : undefined
                  }
                  seenCount={canSeeRunnerSecrets(viewer) ? knownInRd(gameState).length : undefined}
                  testId="pile-rd"
                />
              ) : server.id === 'archives' ? (
                <Pile
                  label="Archives"
                  count={corp.archives.faceUp.length + corp.archives.faceDown.length}
                  side="corp"
                  topCard={corp.archives.faceUp[corp.archives.faceUp.length - 1]}
                  size="fit"
                  hideLabel
                  onClick={() => onOpenZone('archives')}
                  testId="pile-archives"
                />
              ) : undefined
            }
          />
        )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState, seat, viewer, corpCanAct, runnerCanAct, mirrored],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col min-w-0 relative">
      <SectorRimTrace side="corp" isActive={isShiftActive} tabRef={corpTabRef} chassisRef={corpChassisRef} />
      <div
        ref={corpTabRef}
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-bold tracking-widest uppercase rounded-t-[2px] bg-cyan-950/80 border border-cyan-800/80 border-b-0 text-cyan-400 self-start -mb-[1px] z-10 font-mono"
      >
        <span>// SECTOR 01: CORP SERVERS</span>
        {activePlayer === 'corp' && !winner && <span className="text-[9px] text-cyan-300 font-semibold">[SERVERS_ONLINE]</span>}
      </div>
      <section
        ref={corpChassisRef}
        id="corp-board"
        className={`${activePlayer === 'corp' && !winner ? 'turn-active ' : ''}flex-1 min-h-0 flex flex-col gap-1.5 bg-gradient-to-b from-[#0d141e] to-[#080c13] border border-cyan-900/60 rounded-[2px] rounded-tl-none hud-frame hud-corp p-2 shadow-2xl relative w-full min-w-0`}
      >
        {!mirrored && <SideStrip side="corp" state={gameState} viewer={viewer} onInspect={onInspectCard} onOpenZone={onOpenZone} />}

        {/* Servers Grid */}
        <AutoFitArea className="flex items-start gap-2 flex-1 min-w-0 min-h-0 overflow-auto pt-2 pb-1">
          {serversView}
        </AutoFitArea>

        {mirrored && <SideStrip side="corp" state={gameState} viewer={viewer} onInspect={onInspectCard} onOpenZone={onOpenZone} />}
      </section>
    </div>
  );
}
