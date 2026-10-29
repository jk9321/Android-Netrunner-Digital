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
  getLegalActions,
  iceScript,
  iceStrength,
  iceSubtypes,
  installedIcebreakers,
} from '../../core';
import { Scissors, TrendingUp, Clock, Sparkles } from 'lucide-react';
import { Credits } from './CreditIcon';
import { Keyword } from './Keyword';
import { IceTypeIcons, breakerTypes } from './IceTypeIcons';

interface EncounterPanelProps {
  state: GameState;
  onAction: (action: GameAction) => void;
  /** Show the encounter without the Runner's buttons (the Corp is watching). */
  readOnly?: boolean;
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

/**
 * Break window for the ice being encountered: shows each subroutine and offers
 * the BREAK / BOOST / BIOROID_BREAK actions the engine reports as legal.
 */
export const EncounterPanel: React.FC<EncounterPanelProps> = ({ state, onAction, readOnly = false }) => {
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

  const subs = iceScript(ice)?.subroutines ?? [];
  const legal = readOnly ? [] : getLegalActions(state, 'runner');
  const titleOf = (id: string) => {
    const card = state.runner.rig.programs.find(c => c.instanceId === id);
    return card ? cardDef(card).title : id;
  };

  const btn =
    'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition-colors disabled:opacity-40';
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
    const text = !compact
      ? cardDef(card).title
      : ability.counters && effect
        ? `Spend ${ability.counters.count} ${ability.counters.type}: ${effect} (${card.tokens[ability.counters.type] ?? 0} left)`
        : ability.label.replace(/\.$/, '');
    return (
      <button key={`ab${k}`} onClick={() => onAction(a)} className={`${btn} bg-lime-950 border-lime-700 text-lime-200 hover:bg-lime-900`} title={ability.label}>
        <Sparkles className="inline w-3 h-3 mr-1" />
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
        <IceTypeIcons types={iceSubtypes(ice, state)} side="ice" row className="text-[9px]" />
        <span className="text-pink-300 font-bold">{cardDef(ice).title}</span> —{' '}
        <Keyword id="strength">strength</Keyword>{' '}
        <span className="text-cyan-300 font-bold">{iceStrength(state, ice)}</span>
        {encounter.resolvingIndex !== null && <span className="text-amber-300"> • <Keyword id="subroutine">subroutines</Keyword> resolving</span>}
      </div>

      <ol className="space-y-1">
        {subs.map((sub, i) => (
          <li
            key={i}
            className={`text-xs font-mono px-2 py-1 rounded-md border ${
              encounter.broken[i]
                ? 'border-emerald-800 bg-emerald-950/40 text-emerald-400 line-through'
                : 'border-slate-700 bg-black/40 text-slate-200'
            }`}
          >
            ↳ {sub.label}
          </li>
        ))}
      </ol>

      {breakerRows.length > 0 && (
        <div className="space-y-1.5">
          {breakerRows.map(({ breaker, script, actions, breakSlots, own }) => (
            <div key={breaker.instanceId} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-mono text-slate-400 w-48 flex items-center gap-1.5 min-w-0">
                {/* Same icons as on the ice above, so the Runner can check the breaker matches */}
                <IceTypeIcons types={breakerTypes(breaker)} side="breaker" row className="text-[9px] shrink-0" />
                <span className="truncate">{cardDef(breaker).title} (str {breakerStrength(state, breaker)})</span>
              </span>
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
                        <TrendingUp className="inline w-3 h-3 mr-1" />
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
                          <Scissors className="inline w-3 h-3 mr-1" />
                          Break {key} (<Credits amount={script?.breakCost(state, breaker) ?? 0} />)
                        </button>
                      );
                    }
                    const broken = isBroken(indices);
                    return (
                      <button key={key} disabled className={usedBtn} title={broken ? 'Already broken' : 'Not available'}>
                        <Scissors className="inline w-3 h-3 mr-1" />
                        {broken ? <span className="line-through">Broken {key}</span> : <>Break {key}</>}
                      </button>
                    );
                  })}
                </>
              ) : (
                <>
              {actions.length === 0 && own.length === 0 && <span className="text-[11px] font-mono text-slate-600">no legal use</span>}
              {actions.map((a, k) =>
                a.type === 'BOOST_BREAKER' ? (
                  <button
                    key={k}
                    onClick={() => onAction(a)}
                    className={`${btn} bg-cyan-950 border-cyan-700 text-cyan-200 hover:bg-cyan-900`}
                  >
                    <TrendingUp className="inline w-3 h-3 mr-1" />
                    +{script?.boostAmount(state, breaker) ?? 0} strength (<Credits amount={boostCostOf(state, breaker)} />)
                  </button>
                ) : a.type === 'BREAK_SUBROUTINE' ? (
                  <button
                    key={k}
                    onClick={() => onAction(a)}
                    className={`${btn} bg-pink-950 border-pink-700 text-pink-200 hover:bg-pink-900`}
                    title={`Break with ${titleOf(a.breakerInstanceId)}`}
                  >
                    <Scissors className="inline w-3 h-3 mr-1" />
                    Break {a.subroutineIndices.map(i => i + 1).join('+')} (<Credits amount={script?.breakCost(state, breaker) ?? 0} />)
                  </button>
                ) : null,
              )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {otherAbilities.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-mono text-slate-400 w-40">Card abilities</span>
          {otherAbilities.map((a, k) => abilityButton(a, k, false))}
        </div>
      )}

      {showBioroid && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-mono text-slate-400 w-40">
            {iceScript(ice)?.runnerBreakCost ? <>Pay <Credits amount={iceScript(ice)!.runnerBreakCost!} /> per subroutine</> : 'Bioroid: spend a click'}
          </span>
          {subs.map((_, i) => {
            const action = bioroidActions.find(a => a.type === 'BIOROID_BREAK' && a.subroutineIndex === i);
            if (action) {
              return (
                <button
                  key={i}
                  onClick={() => onAction(action)}
                  className={`${btn} bg-amber-950 border-amber-700 text-amber-200 hover:bg-amber-900`}
                >
                  <Clock className="inline w-3 h-3 mr-1" />
                  Break {i + 1}
                </button>
              );
            }
            const broken = encounter.broken[i];
            return (
              <button key={i} disabled className={usedBtn} title={broken ? 'Already broken' : 'Not available'}>
                <Clock className="inline w-3 h-3 mr-1" />
                {broken ? <span className="line-through">Broken {i + 1}</span> : <>Break {i + 1}</>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
