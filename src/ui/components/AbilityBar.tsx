import React from 'react';
import { GameAction, GameState, SideCode, cardDef, findCardAnywhere, getCardScript, getLegalActions } from '../../core';
import { Sparkles } from 'lucide-react';
import { ClickIcon, Credits, renderSymbols } from './CreditIcon';

interface AbilityBarProps {
  state: GameState;
  side: SideCode;
  onAction: (action: GameAction) => void;
}

/** Buttons for every card ability the side can use right now (from getLegalActions). */
export const AbilityBar: React.FC<AbilityBarProps> = ({ state, side, onAction }) => {
  const actions = getLegalActions(state, side).filter(a => a.type === 'USE_ABILITY');
  if (actions.length === 0) return null;
  const accent =
    side === 'corp'
      ? 'bg-cyan-950 hover:bg-cyan-900 border-cyan-700 text-cyan-200'
      : 'bg-pink-950 hover:bg-pink-900 border-pink-700 text-pink-200';

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid={`ability-bar-${side}`}>
      <span className={`text-xs font-bold font-mono uppercase mr-1 ${side === 'corp' ? 'text-cyan-400' : 'text-pink-400'}`}>
        Card abilities:
      </span>
      {actions.map(action => {
        if (action.type !== 'USE_ABILITY') return null;
        const card = findCardAnywhere(state, action.cardInstanceId);
        const ability = card && getCardScript(card.cardCode)?.abilities?.[action.abilityIndex];
        if (!card || !ability) return null;
        // Printed like the card: one click symbol per click spent
        const clickCost = ability.clicks
          ? <span className="inline-flex items-center whitespace-nowrap">{Array.from({ length: ability.clicks }, (_, i) => <ClickIcon key={i} />)}</span>
          : null;
        const cost = clickCost || ability.credits ? (
          <>
            {clickCost}
            {clickCost && ability.credits ? ' + ' : ''}
            {ability.credits ? <Credits amount={ability.credits} /> : null}
          </>
        ) : null;
        return (
          <button
            key={`${action.cardInstanceId}-${action.abilityIndex}`}
            onClick={() => onAction(action)}
            className={`px-2 py-1 border text-[11px] text-left font-bold rounded-lg transition-all flex items-center gap-1.5 shadow ${accent}`}
            title={ability.label.replace(/\[click\]/g, 'click').replace(/\[credit\]/g, 'credit')}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            {cardDef(card).title}: {renderSymbols(ability.label)}
            {cost && <span className="opacity-70 inline-flex items-center">({cost})</span>}
          </button>
        );
      })}
    </div>
  );
};
