import React, { useRef } from 'react';
import {
  boostCostOf,
  GameAction,
  GameState,
  breakerScript,
  breakerStrength,
  cardDef,
  encounteredIce,
  findCardAnywhere,
  getCardScript,
  iceScript,
  iceStrength,
  iceSubroutines,
  iceSubtypes,
  installedIcebreakers,
} from '../../core';
import { legalFor, useSeat } from '../seat';
import { Play } from 'lucide-react';
import { ClickIcon, Credits, SubroutineIcon } from './CreditIcon';
import { Keyword } from './Keyword';
import { IceTypeIcons, breakerTypes } from './IceTypeIcons';
import { StatTumbler } from './StatTumbler';

/** Crisp up-arrow icon for icebreaker strength boosts. */
function BoostIcon({ className = 'inline w-3 h-3 mr-1 -mt-0.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

/** Crisp severed-bar icon for breaking ice subroutines. */
function BreakIcon({ className = 'inline w-3 h-3 mr-1 -mt-0.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 12h5.5" />
      <path d="M15.5 12H21" />
      <path d="M9.5 18l5-12" />
    </svg>
  );
}

interface EncounterPanelProps {
  state: GameState;
  onAction: (action: GameAction) => void;
  /** Show the encounter without the Runner's buttons (the Corp is watching). */
  readOnly?: boolean;
  /** Stack breaker/ability labels above buttons to fit narrow sidebar widths cleanly. */
  compact?: boolean;
}

/** Every way to pick 1..max subroutines out of `count`, in the engine's order. */
function subroutineSlots(count: number, max: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, size: number, acc: number[]) => {
    if (acc.length === size) { out.push(acc); return; }
    for (let i = start; i < count; i++) pick(i + 1, size, [...acc, i]);
  };
  for (let size = 1; size <= Math.min(max, count); size++) pick(0, size, []);
  return out;
}

/** Ansel 2.0 loses 2 clicks to break up to 2 subroutines; other bioroids lose 1 click for 1. */
function clickBreakLabel(cb?: { clicks: number; max: number }): string {
  const { clicks, max } = cb ?? { clicks: 1, max: 1 };
  if (clicks === 1 && max === 1) return 'Bioroid: spend a click';
  return `Bioroid: spend ${clicks} clicks, break up to ${max}`;
}

/**
 * Break window for the ice being encountered: shows each subroutine and offers
 * the BREAK / BOOST / BIOROID_BREAK actions the engine reports as legal.
 */
export const EncounterPanel: React.FC<EncounterPanelProps> = ({ state, onAction, readOnly = false, compact = false }) => {
  const seat = useSeat();
  const encounter = state.activeRun?.encounter;
  const ice = encounteredIce(state);
  // Rows that have offered break buttons during this encounter keep every
  // button slot afterwards (greyed out once used), so nothing slides under the cursor.
  const shown = useRef<{ key: string; rows: Set<string> }>({ key: '', rows: new Set() });
  if (!encounter || !ice) return null;
  const encounterKey = `${state.turnNumber}:${ice.instanceId}:${state.activeRun?.icePassed ?? 0}`;
  if (shown.current.key !== encounterKey) shown.current = { key: encounterKey, rows: new Set() };
  const seen = (row: string, active: boolean) => {
    if (active) shown.current.rows.add(row);
    return shown.current.rows.has(row);
  };

  const subs = iceSubroutines(state, ice);
  const legal = readOnly ? [] : legalFor(seat, 'runner');
  const titleOf = (id: string) => {
    const card = state.runner.rig.programs.find(c => c.instanceId === id);
    return card ? cardDef(card).title : id;
  };

  const btn =
    'px-2.5 py-1 rounded-[2px] text-[12px] font-mono font-bold border border-b-2 active:translate-y-[1px] active:border-b-[1px] transition-all disabled:opacity-40 disabled:active:translate-y-0 disabled:active:border-b-2';
  const abilityActions = legal.filter(
    (a): a is Extract<GameAction, { type: 'USE_ABILITY' }> => a.type === 'USE_ABILITY',
  );
  const breakerIds = new Set(installedIcebreakers(state).map(b => b.instanceId));
  // A breaker's own abilities (Hantu: spend a virus counter for +2 strength)
  // sit in its row, next to its break buttons, rather than under "Card abilities".
  const abilityButton = (a: (typeof abilityActions)[number], k: number, compact: boolean) => {
    const card = findCardAnywhere(state, a.cardInstanceId);
    const ability = card && getCardScript(card.cardCode)?.abilities?.[a.abilityIndex];
    if (!card || !ability) return null;
    const effect = ability.label.split(':').slice(1).join(':').trim().replace(/\.$/, '');
    // A card with more than one ability usable here (Arruaceiras Crew) names each one, with its cost
    const shared = !compact && abilityActions.filter(o => o.cardInstanceId === a.cardInstanceId && !breakerIds.has(o.cardInstanceId)).length > 1;
    const cost = [ability.credits ? `${ability.credits} credits` : '', ability.trashSelf ? 'trash' : ''].filter(Boolean).join(', ');
    const text = !compact
      ? shared
        ? `${cardDef(card).title}: ${ability.label.replace(/\.$/, '')}${cost ? ` (${cost})` : ''}`
        : cardDef(card).title
      : ability.counters && effect
        ? `Spend ${ability.counters.count} ${ability.counters.type}: ${effect} (${card.tokens[ability.counters.type] ?? 0} left)`
        : ability.label.replace(/\.$/, '');
    return (
      <button key={`ab${k}`} onClick={() => onAction(a)} className={`${btn} bg-lime-950 border-lime-700 text-lime-200 hover:bg-lime-900`} title={ability.label}>
        <Play className="inline w-3 h-3 mr-1 -mt-0.5" />
        {text}
      </button>
    );
  };

  const breakerRows = installedIcebreakers(state).map(breaker => {
    const script = breakerScript(breaker);
    const actions = legal.filter(
      a => (a.type === 'BREAK_SUBROUTINE' || a.type === 'BOOST_BREAKER') && a.breakerInstanceId === breaker.instanceId,
    );
    const breakSlots =
      !readOnly && script && seen(breaker.instanceId, actions.some(a => a.type === 'BREAK_SUBROUTINE'))
        ? subroutineSlots(subs.length, script.breakMax)
        : null;
    const own = abilityActions.filter(a => a.cardInstanceId === breaker.instanceId);
    return { breaker, script, actions, breakSlots, own };
  });
  const bioroidActions = legal.filter(a => a.type === 'BIOROID_BREAK');
  const showBioroid = !readOnly && seen('bioroid', bioroidActions.length > 0);
  const otherAbilities = abilityActions.filter(a => !breakerIds.has(a.cardInstanceId));
  const usedBtn = `${btn} bg-slate-900 border-slate-700 text-slate-500 cursor-not-allowed`;
  const isBroken = (indices: number[]) => indices.every(i => encounter.broken[i]);
  const labelOf = (indices: number[]) => indices.map(i => i + 1).join('+');

  return (
    <div className="mt-3 border-t border-pink-900/50 pt-3 space-y-3" data-testid="encounter-panel">
      <div className="text-xs font-mono text-slate-300 flex flex-wrap items-center gap-x-1">
        <Keyword id="encounter">Encountering</Keyword>
        <IceTypeIcons types={iceSubtypes(ice, state)} side="ice" row className="text-[10px]" />
        <span className="text-pink-300 font-bold">{cardDef(ice).title}</span> —{' '}
        <Keyword id="strength">strength</Keyword>{' '}
        <span className="text-cyan-300 font-bold">{iceStrength(state, ice)}</span>
        {encounter.resolvingIndex !== null && <span className="text-amber-300"> • <Keyword id="subroutine">subroutines</Keyword> resolving</span>}
      </div>

      <ol className="space-y-1">
        {subs.map((sub, i) => (
          <li
            key={i}
            className={`text-xs font-mono px-2 py-1 rounded-[2px] border ${
              encounter.broken[i]
                ? 'border-emerald-800 bg-emerald-950/40 text-emerald-400 line-through'
                : 'border-slate-700 bg-black/40 text-slate-200'
            }`}
          >
            <SubroutineIcon className={`inline w-3 h-3 mr-1.5 -mt-0.5 shrink-0 ${encounter.broken[i] ? 'text-emerald-500/70' : 'text-cyan-400'}`} />
            {sub.label}
          </li>
        ))}
      </ol>

      {breakerRows.length > 0 && (
        <div className="space-y-2 sm:space-y-1.5">
          {breakerRows.map(({ breaker, script, actions, breakSlots, own }) => {
            const bStr = breakerStrength(state, breaker);
            const targetStrength = iceStrength(state, ice);
            const hasEnoughStrength = bStr >= targetStrength;
            return (
              // Buttons wrap within their own column on desktop, and stack cleanly under the breaker name on narrow screens or when sidebar-docked
              <div key={breaker.instanceId} className={`flex flex-col ${compact ? 'border-t border-slate-800/80 pt-1.5' : 'sm:flex-row sm:gap-1.5'} items-start gap-1`}>
                <span className={`text-[12px] font-mono text-slate-400 w-full ${compact ? '' : 'sm:w-40 sm:min-h-[28px]'} shrink-0 min-h-[24px] flex items-center gap-1.5 min-w-0`}>
                  {/* Same icons as on the ice above, so the Runner can check the breaker matches */}
                  <IceTypeIcons types={breakerTypes(breaker)} side="breaker" row className="text-[10px] shrink-0" />
                  <span className={`min-w-0 flex flex-1 ${compact ? 'items-baseline justify-between gap-2' : 'sm:flex-col items-baseline sm:items-start gap-2 sm:gap-0'} leading-tight`}>
                    <span className="truncate text-slate-200 font-semibold" title={cardDef(breaker).title}>
                      {cardDef(breaker).title}
                    </span>
                    <span
                      className={`text-[11px] font-bold transition-colors shrink-0 ${
                        hasEnoughStrength ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                      title={hasEnoughStrength ? `Meets ice strength (${targetStrength})` : `Below ice strength (${targetStrength})`}
                    >
                      str <StatTumbler value={bStr} />
                    </span>
                  </span>
                </span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 min-w-0">
              {own.map((a, k) => abilityButton(a, k, true))}
              {breakSlots ? (
                <>
                  {(() => {
                    const boost = actions.find(a => a.type === 'BOOST_BREAKER');
                    // No credit boost at all (Hantu boosts only by spending counters).
                    if (!Number.isFinite(boostCostOf(state, breaker))) return null;
                    return (
                      <button
                        onClick={() => boost && onAction(boost)}
                        disabled={!boost}
                        className={boost ? `${btn} bg-cyan-950 border-cyan-700 text-cyan-200 hover:bg-cyan-900` : usedBtn}
                      >
                        <BoostIcon />
                        +{script?.boostAmount(state, breaker) ?? 0} strength (<Credits amount={boostCostOf(state, breaker)} />)
                      </button>
                    );
                  })()}
                  {breakSlots.map(indices => {
                    const key = labelOf(indices);
                    const action = actions.find(
                      a => a.type === 'BREAK_SUBROUTINE' && labelOf(a.subroutineIndices) === key,
                    );
                    if (action) {
                      return (
                        <button
                          key={key}
                          onClick={() => onAction(action)}
                          className={`${btn} bg-pink-950 border-pink-700 text-pink-200 hover:bg-pink-900`}
                          title={`Break with ${titleOf(breaker.instanceId)}`}
                        >
                          <BreakIcon />
                          Break {key} (<Credits amount={script?.breakCost(state, breaker) ?? 0} />)
                        </button>
                      );
                    }
                    const broken = isBroken(indices);
                    return (
                      <button key={key} disabled className={usedBtn} title={broken ? 'Already broken' : 'Not available'}>
                        <BreakIcon />
                        {broken ? <span className="line-through">Broken {key}</span> : <>Break {key}</>}
                      </button>
                    );
                  })}
                </>
              ) : (
                <>
              {actions.length === 0 && own.length === 0 && <span className="text-[12px] font-mono text-slate-600">no legal use</span>}
              {actions.map((a, k) =>
                a.type === 'BOOST_BREAKER' ? (
                  <button
                    key={k}
                    onClick={() => onAction(a)}
                    className={`${btn} bg-cyan-950 border-cyan-700 text-cyan-200 hover:bg-cyan-900`}
                  >
                    <BoostIcon />
                    +{script?.boostAmount(state, breaker) ?? 0} strength (<Credits amount={boostCostOf(state, breaker)} />)
                  </button>
                ) : a.type === 'BREAK_SUBROUTINE' ? (
                  <button
                    key={k}
                    onClick={() => onAction(a)}
                    className={`${btn} bg-pink-950 border-pink-700 text-pink-200 hover:bg-pink-900`}
                    title={`Break with ${titleOf(a.breakerInstanceId)}`}
                  >
                    <BreakIcon />
                    Break {a.subroutineIndices.map(i => i + 1).join('+')} (<Credits amount={script?.breakCost(state, breaker) ?? 0} />)
                  </button>
                ) : null,
              )}
                </>
              )}
              </div>
            </div>
          );
          })}
        </div>
      )}

      {otherAbilities.length > 0 && (
        <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'border-t border-slate-800/80 pt-1.5' : ''}`}>
          <span className={`text-[12px] font-mono text-slate-400 w-full ${compact ? '' : 'sm:w-40'}`}>Card abilities</span>
          {otherAbilities.map((a, k) => abilityButton(a, k, false))}
        </div>
      )}

      {showBioroid && (() => {
        // N-Pot breaks for credits; bioroids break by losing clicks. Show the real cost.
        const creditBreak = iceScript(ice)?.runnerBreakCost;
        const label = (text: React.ReactNode) => creditBreak !== undefined
          ? <>{text} (<Credits amount={creditBreak} />)</>
          : <><ClickIcon className="inline w-3 h-3 mr-1 -mt-0.5" />{text}</>;
        return (
        <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'border-t border-slate-800/80 pt-1.5' : ''}`}>
          <span className={`text-[12px] font-mono text-slate-400 w-full ${compact ? '' : 'sm:w-40'}`}>
            {creditBreak !== undefined ? <>Pay <Credits amount={creditBreak} /> per subroutine</> : clickBreakLabel(iceScript(ice)?.clickBreak)}
          </span>
          {subs.map((_, i) => {
            const action = bioroidActions.find(a => a.type === 'BIOROID_BREAK' && !a.subroutineIndices && a.subroutineIndex === i);
            if (action) {
              return (
                <button
                  key={i}
                  onClick={() => onAction(action)}
                  className={`${btn} bg-amber-950 border-amber-700 text-amber-200 hover:bg-amber-900`}
                >
                  {label(<>Break {i + 1}</>)}
                </button>
              );
            }
            const broken = encounter.broken[i];
            return (
              <button key={i} disabled className={usedBtn} title={broken ? 'Already broken' : 'Not available'}>
                {label(broken ? <span className="line-through">Broken {i + 1}</span> : <>Break {i + 1}</>)}
              </button>
            );
          })}
          {bioroidActions.map((a, k) => a.type === 'BIOROID_BREAK' && a.subroutineIndices && (
            <button
              key={`multi-${k}`}
              onClick={() => onAction(a)}
              className={`${btn} bg-amber-950 border-amber-700 text-amber-200 hover:bg-amber-900`}
            >
              {label(<>Break {a.subroutineIndices.map(i => i + 1).join(' + ')}</>)}
            </button>
          ))}
        </div>
        );
      })()}
    </div>
  );
};
