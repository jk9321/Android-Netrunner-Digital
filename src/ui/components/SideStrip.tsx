import React from 'react';
import { Archive, Award, Ban, Eye, Layers, Trash2 } from 'lucide-react';
import { CardInstance, GameState, SideCode, cardDef } from '../../core';
import { BadPublicityIcon, ClickIcon, CoreDamageIcon, CreditIcon, MuIcon, TagIcon } from './CreditIcon';
import { Keyword } from './Keyword';
import { labelKeyword } from '../glossary';
import { ZoneId } from './ZoneViewer';

const MELIES_U = '36036';
const MELIES_SIDES = { hq: 'HQ', rd: 'R&D', archives: 'Archives' } as const;

const pillBase =
  'h-[26px] px-2 flex items-center gap-1.5 rounded-[5px] text-[12px] font-mono leading-none shadow [clip-path:none] shrink-0 border';

const STYLE: Record<SideCode, { strip: string; dot: string; name: string; viewId: string; stat: string }> = {
  corp: {
    strip: 'pb-1 border-b border-cyan-950',
    dot: 'bg-cyan-400 shadow-[0_0_10px_#00f0ff]',
    name: 'text-cyan-400',
    viewId: 'text-cyan-400 hover:text-cyan-200 border border-cyan-800/80 bg-cyan-950/40 rounded [clip-path:none]',
    stat: 'bg-cyan-950/80 border-cyan-800 text-cyan-300',
  },
  runner: {
    strip: 'pt-1 border-t border-pink-950',
    dot: 'bg-pink-400 shadow-[0_0_10px_#ff0055]',
    name: 'text-pink-400',
    viewId: 'text-pink-400 hover:text-pink-200 border border-pink-800/80 bg-pink-950/40 rounded [clip-path:none]',
    stat: 'bg-pink-950/80 border-pink-800 text-pink-300',
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
      className={`${pillBase} bg-slate-900 hover:bg-slate-800 border-slate-800 hover:border-slate-600 text-slate-300 transition-colors`}
      title={`Browse ${label}`}
    >
      {icon}
      <span>
        <Keyword id={labelKeyword(label)}>{label}</Keyword>: {count}
      </span>
    </button>
  );
  const plain = `${pillBase} bg-slate-900 border-slate-800 text-slate-400`;

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
        <div className={`${pillBase} ${style.stat}`} data-testid={`${side}-credits`}>
          <CreditIcon className="w-3.5 h-3.5 text-amber-400" />
          <span>
            <span className="font-bold">{player.credits}</span> <Keyword id="credit">Credits</Keyword>
          </span>
          {side === 'runner' && (state.activeRun?.badPublicityCredits ?? 0) > 0 && (
            <span className="text-amber-300 inline-flex items-center gap-1" data-testid="bad-publicity-fund">
              +{state.activeRun!.badPublicityCredits} <BadPublicityIcon className="w-3.5 h-3.5 text-amber-400" /> <Keyword id="bad-publicity">bad publicity</Keyword>
            </span>
          )}
        </div>
        <div className={`${pillBase} ${style.stat}`}>
          <ClickIcon className="w-3.5 h-3.5 text-red-400" />
          <span>
            <span className="font-bold">{player.clicks}</span> / {player.maxClicks} <Keyword id="click">Clicks</Keyword>
          </span>
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
            <div
              className={`${pillBase} ${
                corp.badPublicity > 0 ? 'bg-amber-950 border-amber-800 text-amber-300' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
              data-testid="corp-bad-publicity"
            >
              <BadPublicityIcon className="w-[18px] h-[18px] text-amber-400 shrink-0" />
              <span>
                <span className="font-bold">{corp.badPublicity}</span> <Keyword id="bad-publicity">Bad publicity</Keyword>
              </span>
            </div>
            {corp.identity.cardCode === MELIES_U && (
              <div className={plain} data-testid="melies-side" title="Méliès U: the side is set secretly and shown once the identity flips">
                <span>Méliès U: {corp.identity.flipped && corp.meliesServer ? `${MELIES_SIDES[corp.meliesServer]} side` : 'side secret'}</span>
              </div>
            )}
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
              className={`${pillBase} ${
                runner.tags > 0 ? 'bg-red-950 border-red-700 text-red-300' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
              data-testid="runner-tags"
            >
              <TagIcon className="w-[18px] h-[18px] text-red-400 shrink-0" />
              <span>
                <span className="font-bold">{runner.tags}</span> <Keyword id="tag">Tag{runner.tags === 1 ? '' : 's'}</Keyword>
              </span>
            </div>
            {runner.coreDamage > 0 && (
              <div className={`${pillBase} bg-red-950 border-red-800 text-red-300`}>
                <CoreDamageIcon className="w-[18px] h-[18px] text-red-400 shrink-0" />
                <span>
                  <span className="font-bold">{runner.coreDamage}</span> <Keyword id="core-damage">Core damage</Keyword>
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
