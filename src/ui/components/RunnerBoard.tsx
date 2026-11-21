import { useMemo, useRef } from 'react';
import { CardInstance, GameState, cardDef, findCardAnywhere } from '../../core';
import { canSeeCorpSecrets, canSeeRunnerSecrets, Viewer } from '../viewer';
import { AutoFitArea } from './AutoFitArea';
import { CardView } from './CardView';
import { breakerTypes } from './IceTypeIcons';
import { Pile } from './Pile';
import { RigView } from './RigView';
import { SectorRimTrace } from './SectorRimTrace';
import { SideStrip } from './SideStrip';
import type { ZoneId } from './ZoneViewer';

interface RunnerBoardProps {
  gameState: GameState;
  viewer: Viewer;
  onInspectCard: (card: CardInstance) => void;
  onOpenZone: (zone: ZoneId) => void;
  isShiftActive: boolean;
}

/** Runner sector (bottom half of the tabletop): full-width RigView with Stack/Heap piles and SideStrip. */
export function RunnerBoard({
  gameState,
  viewer,
  onInspectCard,
  onOpenZone,
  isShiftActive,
}: RunnerBoardProps) {
  const runnerTabRef = useRef<HTMLDivElement>(null);
  const runnerChassisRef = useRef<HTMLElement>(null);
  const { corp, runner, activePlayer, winner } = gameState;

  // Runner cards installed on Corp ice (trojans), and where each one sits, for the host tags
  const iceHostLabel = (card: CardInstance): string | undefined => {
    if (!card.hostedOnId) return undefined;
    const server = Object.values(corp.servers).find(s => s.ice.some(i => i.instanceId === card.hostedOnId));
    const index = server ? server.ice.findIndex(i => i.instanceId === card.hostedOnId) : -1;
    if (!server || index < 0) {
      // Hosted on one of the Runner's own cards (Gamdragon Pro on an icebreaker)
      const host = findCardAnywhere(gameState, card.hostedOnId);
      return host ? cardDef(host).title : undefined;
    }
    const ice = server.ice[index];
    const name = ice.isRezzed || canSeeCorpSecrets(viewer) ? cardDef(ice).title : 'unrezzed ice';
    // Several unrezzed ice in one server look alike, so say which one (ice 1 is innermost)
    return `${server.name} ice ${index + 1} · ${name}`;
  };

  const rigView = useMemo(
    () => (
      <RigView
        rig={runner.rig}
        onInspectCard={onInspectCard}
        hostLabel={iceHostLabel}
        breaks={breakerTypes}
        canSeeSecrets={canSeeRunnerSecrets(viewer)}
        aside={
          <>
            <CardView card={runner.identity} size="fit" notInstalled onInspect={onInspectCard} />
            <div className="flex items-start gap-1.5">
              <Pile
                label="Stack"
                count={runner.stack.length}
                side="runner"
                size="fit-sm"
                onClick={gameState.winner ? () => onOpenZone('stack') : undefined}
                testId="pile-stack"
              />
              <Pile
                label="Heap"
                count={runner.heap.length}
                side="runner"
                topCard={runner.heap[runner.heap.length - 1]}
                size="fit-sm"
                onClick={() => onOpenZone('heap')}
                testId="pile-heap"
              />
            </div>
          </>
        }
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState, viewer],
  );

  return (
    <div className="flex-none lg:max-h-[55%] min-h-0 flex flex-col min-w-0 relative">
      <SectorRimTrace side="runner" isActive={isShiftActive} tabRef={runnerTabRef} chassisRef={runnerChassisRef} />
      <div
        ref={runnerTabRef}
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-bold tracking-widest uppercase rounded-t-[2px] bg-pink-950/80 border border-pink-800/80 border-b-0 text-pink-400 self-start -mb-[1px] z-10 font-mono"
      >
        <span>// SECTOR 02: RUNNER RIG</span>
        {activePlayer === 'runner' && !winner && <span className="text-[9px] text-pink-300 font-semibold">[RIG_LINKED]</span>}
      </div>
      <section
        ref={runnerChassisRef}
        id="runner-board"
        className={`${activePlayer === 'runner' && !winner ? 'turn-active ' : ''}flex-1 min-h-0 flex flex-col gap-1.5 bg-gradient-to-b from-[#0d141e] to-[#080c13] border border-pink-900/60 rounded-[2px] rounded-tl-none hud-frame hud-runner p-2 shadow-2xl relative w-full min-w-0`}
      >
        {/* Runner Rig (Installed Programs, Hardware, Resources) */}
        <AutoFitArea className="flex-1 min-w-0 min-h-0 overflow-auto">
          {rigView}
        </AutoFitArea>

        <SideStrip side="runner" state={gameState} viewer={viewer} onInspect={onInspectCard} onOpenZone={onOpenZone} />
      </section>
    </div>
  );
}
