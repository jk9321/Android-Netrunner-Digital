import React from 'react';
import { Archive, Award, Ban, Clock, Eye, Layers, Tag, Trash2 } from 'lucide-react';
import { CardInstance, GameState, SideCode, cardDef } from '../../core';
import { CreditIcon, MuIcon } from './CreditIcon';
import { Keyword } from './Keyword';
import { labelKeyword } from '../glossary';
import { ZoneId } from './ZoneViewer';

const STYLE: Record<SideCode, { strip: string; dot: string; name: string; viewId: string; stat: string }> = {
  corp: {
    strip: 'pb-1 border-b border-cyan-950',
    dot: 'bg-cyan-400 shadow-[0_0_10px_#00f0ff]',
    name: 'text-cyan-400',
    viewId: 'text-cyan-400 hover:text-cyan-200 border border-cyan-800/80 bg-cyan-950/40',
    stat: 'bg-cyan-950/80 border border-cyan-800 text-cyan-300',
  },
  runner: {
    strip: 'pt-1 border-t border-pink-950',
    dot: 'bg-pink-400 shadow-[0_0_10px_#ff0055]',
    name: 'text-pink-400',
    viewId: 'text-pink-400 hover:text-pink-200 border border-pink-800/80 bg-pink-950/40',
    stat: 'bg-pink-950/80 border border-pink-800 text-pink-300',
  },
};

/** One side's identity and counters (credits, clicks, piles), along the edge of its half of the table. */
export function SideStrip({
  side,
  state,
  onInspect,
  onOpenZone,
}: {
  side: SideCode;
  state: GameState;
  onInspect: (card: CardInstance) => void;
  onOpenZone: (zone: ZoneId) => void;
}) {
  const style = STYLE[side];
  const player = side === 'corp' ? state.corp : state.runner;
  const { corp, runner } = state;
  const zoneButton = (id: ZoneId, label: string, count: number, icon: React.ReactNode) => (
    <button
      onClick={() => onOpenZone(id)}
      data-testid={`zone-${id}`}
      className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-600 px-2 py-0.5 rounded-lg text-slate-300 shadow transition-colors"
      title={`Browse ${label}`}
    >
      {icon}
      <span>
        <Keyword id={labelKeyword(label)}>{label}</Keyword>: {count}
      </span>
    </button>
  );
  const plain = 'flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg text-slate-400 shadow';

  return (
    <div className={`shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${style.strip}`}>
      {/* Identity & Header */}
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full ${style.dot}`} />
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className={`font-cyber font-bold text-xs tracking-wider ${style.name}`}>{side === 'corp' ? 'CORP' : 'RUNNER'}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-300 font-mono font-bold truncate max-w-[18rem]" title={cardDef(player.identity).title}>
              {cardDef(player.identity).title}
            </span>
            <button
              onClick={() => onInspect(player.identity)}
              className={`text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors ${style.viewId}`}
              title={`Inspect ${side === 'corp' ? 'Corp' : 'Runner'} Identity card`}
            >
              <Eye className="w-2.5 h-2.5" /> View ID
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-1.5 text-[12px] font-mono flex-wrap">
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg shadow ${style.stat}`} data-testid={`${side}-credits`}>
          <CreditIcon className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-bold">{player.credits}</span> <Keyword id="credit">Credits</Keyword>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg shadow ${style.stat}`}>
          <Clock className="w-3.5 h-3.5 text-red-400" />
          <span className="font-bold">{player.clicks}</span> / {player.maxClicks} <Keyword id="click">Clicks</Keyword>
        </div>
        {side === 'corp' ? (
          <>
            <div className={plain}>
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span><Keyword id="rd">R&D</Keyword>: {corp.rd.length}</span>
            </div>
            {zoneButton(
              'archives',
              'Archives',
              corp.archives.faceUp.length + corp.archives.faceDown.length,
              <Archive className="w-3.5 h-3.5 text-slate-500" />,
            )}
            {zoneButton('corp-score', 'Scored', corp.scoreArea.length, <Award className="w-3.5 h-3.5 text-cyan-400" />)}
            {state.removedFromGame.length > 0 &&
              zoneButton('removed', 'Removed', state.removedFromGame.length, <Ban className="w-3.5 h-3.5 text-slate-500" />)}
          </>
        ) : (
          <>
            <div className={plain}>
              <MuIcon className="w-3.5 h-3.5 text-cyan-400" />
              <span><Keyword id="mu">MU</Keyword>: {runner.memoryUnitsUsed} / {runner.memoryUnitsTotal}</span>
            </div>
            <div className={plain}>
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span><Keyword id="stack">Stack</Keyword>: {runner.stack.length}</span>
            </div>
            {zoneButton('heap', 'Heap', runner.heap.length, <Trash2 className="w-3.5 h-3.5 text-slate-500" />)}
            {zoneButton('runner-score', 'Stolen', runner.scoreArea.length, <Award className="w-3.5 h-3.5 text-pink-400" />)}
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg shadow border ${
                runner.tags > 0 ? 'bg-red-950 border-red-700 text-red-300' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
              data-testid="runner-tags"
            >
              <Tag className="w-3.5 h-3.5" />
              <span className="font-bold">{runner.tags}</span> <Keyword id="tag">Tag{runner.tags === 1 ? '' : 's'}</Keyword>
            </div>
            {runner.coreDamage > 0 && (
              <div className="flex items-center gap-1.5 bg-red-950 border border-red-800 px-2 py-0.5 rounded-lg text-red-300 shadow">
                <span className="font-bold">{runner.coreDamage}</span> <Keyword id="core-damage">Core damage</Keyword>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
