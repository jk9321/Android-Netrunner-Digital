import React from 'react';
import { Ban } from 'lucide-react';
import { CardInstance, GameState, SideCode, cardDef, knownInHand } from '../../core';
import { canSeeCorpSecrets, canSeeRunnerSecrets, Viewer } from '../viewer';
import { AgendaDiamondIcon, BadPublicityIcon, ClickIcon, CoreDamageIcon, CreditIcon, MuIcon, TagIcon } from './CreditIcon';
import { Keyword } from './Keyword';
import { KnownInHandButton } from './KnownInHandButton';
import { labelKeyword } from '../glossary';
import { ZoneId } from './ZoneViewer';
import { StatTumbler } from './StatTumbler';
import { runCreditPools } from '../liveValues';

const MELIES_U = '36036';
const MELIES_SIDES = { hq: 'HQ', rd: 'R&D', archives: 'Archives' } as const;

const pillBase =
  'h-[26px] px-2 flex items-center gap-1.5 rounded-[2px] text-[12px] font-mono leading-none shadow ![clip-path:none] shrink-0 border';

const STYLE: Record<SideCode, { border: string; name: string; stat: string }> = {
  corp: {
    border: 'border-cyan-950',
    name: 'text-cyan-400',
    stat: 'bg-cyan-950/80 border-cyan-800 text-cyan-300',
  },
  runner: {
    border: 'border-pink-950',
    name: 'text-pink-400',
    stat: 'bg-pink-950/80 border-pink-800 text-pink-300',
  },
};

/** Compact visual card-back fan for the opponent's hidden hand inside their SideStrip. */
function OpponentHandBadge({
  side,
  count,
  limit,
  knownCount,
  onOpenKnown,
}: {
  side: SideCode;
  count: number;
  limit: number;
  knownCount: number;
  onOpenKnown: () => void;
}) {
  const isCorp = side === 'corp';
  const shown = Math.min(count, 8);
  const lowDanger = !isCorp && count <= 1;
  const overLimit = count > limit;
  const frameClass = lowDanger
    ? 'bg-red-950/70 border-red-600/90 text-red-200'
    : overLimit
      ? 'bg-amber-950/60 border-amber-600/80 text-amber-200'
      : isCorp
        ? 'bg-cyan-950/50 border-cyan-800/80 text-cyan-200'
        : 'bg-pink-950/50 border-pink-800/80 text-pink-200';
  const miniCardClass = isCorp
    ? 'bg-gradient-to-b from-cyan-700 to-cyan-950 border-cyan-400/80'
    : 'bg-gradient-to-b from-pink-600 to-pink-950 border-pink-400/80';

  return (
    <div className="inline-flex items-center gap-1 shrink-0">
      <div
        data-testid={`hand-${side}`}
        data-opponent-hand="true"
        className={`${pillBase} ${frameClass}`}
        title={`${isCorp ? 'Corp HQ Hand' : 'Runner Grip'}: ${count} / ${limit} cards`}
      >
        <Keyword id={isCorp ? 'hq' : 'grip'} className="font-bold uppercase text-[11px] opacity-90">
          {isCorp ? 'HQ' : 'Grip'}
        </Keyword>
        {count === 0 ? (
          <span
            className="inline-block w-[11px] h-[16px] rounded-[1.5px] border border-dashed border-current opacity-40"
            aria-hidden="true"
          />
        ) : (
          <span className="inline-flex items-center px-0.5" aria-hidden="true">
            {Array.from({ length: shown }, (_, i) => {
              const angle = (i - (shown - 1) / 2) * 3.5;
              return (
                <span
                  key={i}
                  data-hand-card
                  className={`inline-block w-[11px] h-[16px] rounded-[1.5px] border shadow-sm ${miniCardClass}`}
                  style={{
                    marginLeft: i > 0 ? '-4px' : undefined,
                    transform: `rotate(${angle.toFixed(1)}deg)`,
                  }}
                />
              );
            })}
            {count > shown && <span className="ml-1 text-[10px] font-bold opacity-80">+{count - shown}</span>}
          </span>
        )}
        <span className="font-bold">
          <Keyword id="hand-size">
            <StatTumbler value={count} />/{limit}
          </Keyword>
        </span>
      </div>
      {knownCount > 0 && <KnownInHandButton count={knownCount} onOpen={onOpenKnown} />}
    </div>
  );
}

/** One side's identity and counters (credits, clicks, scores, opponent hand), along the edge of its half of the table. */
export function SideStrip({
  side,
  edge = side === 'corp' ? 'top' : 'bottom',
  state,
  viewer,
  onInspect,
  onOpenZone,
}: {
  side: SideCode;
  /** Which edge of its board half the strip sits on, so the divider line separates it from the cards. */
  edge?: 'top' | 'bottom';
  state: GameState;
  viewer: Viewer;
  onInspect: (card: CardInstance) => void;
  onOpenZone: (zone: ZoneId) => void;
}) {
  const style = STYLE[side];
  const stripEdge = edge === 'top' ? `pb-1 border-b ${style.border}` : `pt-1 border-t ${style.border}`;
  const player = side === 'corp' ? state.corp : state.runner;
  const { corp, runner } = state;
  const pools = runCreditPools(state);
  const nonBpRunnerSources = pools.runner?.sources.filter(s => s.label !== 'bad publicity') ?? [];
  const nonBpBonus = nonBpRunnerSources.reduce((n, s) => n + s.amount, 0);
  const showOppHand = side === 'corp' ? !canSeeCorpSecrets(viewer) : !canSeeRunnerSecrets(viewer);
  const zoneButton = (id: ZoneId, label: string, count: number, icon: React.ReactNode) => (
    <button
      onClick={() => onOpenZone(id)}
      style={{ clipPath: 'none' }}
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
    <div className={`shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${stripEdge}`}>
      {/* Identity & Header */}
      <div className="flex items-center gap-2 min-w-0">
        <h2 className={`font-cyber font-bold text-xs tracking-wider shrink-0 ${style.name}`}>{side === 'corp' ? 'CORP' : 'RUNNER'}</h2>
        <button
          type="button"
          onClick={() => onInspect(player.identity)}
          className="text-xs text-slate-300 hover:text-white hover:underline decoration-slate-500 underline-offset-2 font-mono font-bold truncate max-w-[16rem] text-left transition-colors"
          title={`Inspect ${cardDef(player.identity).title}`}
        >
          {cardDef(player.identity).title}
        </button>
      </div>

      {/* Stats */}
      <div className="grow flex items-center justify-center gap-1.5 text-[12px] font-mono flex-wrap" data-testid={`${side}-stats`}>
        <div className={`${pillBase} ${style.stat}`} data-testid={`${side}-credits`}>
          <CreditIcon className="w-3.5 h-3.5 text-amber-400" />
          <span>
            <StatTumbler value={player.credits} className="font-bold" /> <Keyword id="credit">Credits</Keyword>
          </span>
          {side === 'runner' && (state.activeRun?.badPublicityCredits ?? 0) > 0 && (
            <span className="text-amber-300 inline-flex items-center gap-1" data-testid="bad-publicity-fund">
              +{state.activeRun!.badPublicityCredits} <BadPublicityIcon className="w-3.5 h-3.5 text-amber-400" /> <Keyword id="bad-publicity">bad publicity</Keyword>
            </span>
          )}
          {side === 'runner' && nonBpBonus > 0 && (
            <span
              className="text-emerald-300 inline-flex items-center gap-1"
              data-testid="run-bonus-credits"
              title={nonBpRunnerSources.map(s => `+${s.amount} ${s.label}`).join(', ')}
            >
              +{nonBpBonus} run ({pools.runner!.total} spendable)
            </span>
          )}
          {side === 'runner' && pools.runner?.poolLocked && (
            <span
              className="text-amber-300 inline-flex items-center gap-1"
              data-testid="run-pool-locked"
              title="Your credit pool cannot be spent during this run"
            >
              (pool locked · {pools.runner.total} spendable)
            </span>
          )}
          {side === 'corp' && pools.corpRez && (
            <span
              className="text-emerald-300 inline-flex items-center gap-1"
              data-testid="corp-rez-bonus"
              title={pools.corpRez.sources.map(s => `+${s.amount} ${s.label}`).join(', ')}
            >
              +{pools.corpRez.bonus} rez ({pools.corpRez.total} on server)
            </span>
          )}
        </div>
        <div className={`${pillBase} ${style.stat}`}>
          <ClickIcon className="w-3.5 h-3.5 text-red-400" />
          <span>
            <StatTumbler value={player.clicks} className="font-bold" /> / {player.maxClicks} <Keyword id="click">Clicks</Keyword>
          </span>
        </div>
        {side === 'corp' ? (
          <>
            {zoneButton('corp-score', 'Scored', corp.scoreArea.length, <AgendaDiamondIcon className="w-3.5 h-3.5 text-cyan-400" />)}
            <div
              className={`${pillBase} ${
                corp.badPublicity > 0 ? 'bg-amber-950 border-amber-800 text-amber-300' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
              data-testid="corp-bad-publicity"
            >
              <BadPublicityIcon className="w-[18px] h-[18px] text-amber-400 shrink-0" />
              <span>
                <StatTumbler value={corp.badPublicity} className="font-bold" /> <Keyword id="bad-publicity">Bad publicity</Keyword>
              </span>
            </div>
            {showOppHand && (
              <OpponentHandBadge
                side="corp"
                count={corp.hq.length}
                limit={corp.handSizeLimit}
                knownCount={knownInHand(state, 'corp').length}
                onOpenKnown={() => onOpenZone('known-hq')}
              />
            )}
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
              <span><Keyword id="mu">MU</Keyword>: <StatTumbler value={runner.memoryUnitsUsed} /> / {runner.memoryUnitsTotal}</span>
            </div>
            {zoneButton('runner-score', 'Stolen', runner.scoreArea.length, <AgendaDiamondIcon className="w-3.5 h-3.5 text-pink-400" />)}
            <div
              className={`${pillBase} ${
                runner.tags > 0 ? 'bg-red-950 border-red-700 text-red-300' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
              data-testid="runner-tags"
            >
              <TagIcon className="w-[18px] h-[18px] text-red-400 shrink-0" />
              <span>
                <StatTumbler value={runner.tags} className="font-bold" /> <Keyword id="tag">Tag{runner.tags === 1 ? '' : 's'}</Keyword>
              </span>
            </div>
            {runner.coreDamage > 0 && (
              <div className={`${pillBase} bg-red-950 border-red-800 text-red-300`}>
                <CoreDamageIcon className="w-[18px] h-[18px] text-red-400 shrink-0" />
                <span>
                  <StatTumbler value={runner.coreDamage} className="font-bold" /> <Keyword id="core-damage">Core damage</Keyword>
                </span>
              </div>
            )}
            {showOppHand && (
              <OpponentHandBadge
                side="runner"
                count={runner.grip.length}
                limit={runner.handSizeLimit}
                knownCount={knownInHand(state, 'runner').length}
                onOpenKnown={() => onOpenZone('known-grip')}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
