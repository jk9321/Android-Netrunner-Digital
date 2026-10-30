import React, { useEffect } from 'react';
import { CardInstance, GameAction, GameState, SideCode, cardDef, findCardAnywhere, getCardScript, getLegalActions } from '../../core';
import { Sparkles } from 'lucide-react';
import { ClickIcon, Credits, renderSymbols } from './CreditIcon';
import { cardPositionLabel } from '../cardLabels';
import { hoverPromptTarget } from '../promptHighlight';

interface AbilityBarProps {
  state: GameState;
  side: SideCode;
  onAction: (action: GameAction) => void;
}

/** The counters on a card in words, e.g. "3 virus, 1 power", or null when it has none. */
function countersLabel(card: CardInstance): string | null {
  const parts = Object.entries(card.tokens ?? {}).filter(([, n]) => n > 0).map(([kind, n]) => `${n} ${kind}`);
  if (card.advancementCounters > 0) parts.push(`${card.advancementCounters} adv`);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Buttons for every card ability the side can use right now (from getLegalActions).
 * Hovering one lights up the card it comes from, and copies of the same card
 * are numbered in board order (with their counters), so two Fermenters
 * can't be mixed up.
 */
export const AbilityBar: React.FC<AbilityBarProps> = ({ state, side, onAction }) => {
  const actions = getLegalActions(state, side).filter(a => a.type === 'USE_ABILITY');
  // The button goes away once the ability is used; don't leave its card lit
  useEffect(() => () => hoverPromptTarget(null), []);
  if (actions.length === 0) return null;
  // Which titles have more than one installed copy offering abilities, numbered in board order
  const copies = new Map<string, string[]>();
  for (const a of actions) {
    if (a.type !== 'USE_ABILITY') continue;
    const card = findCardAnywhere(state, a.cardInstanceId);
    if (!card) continue;
    const ids = copies.get(card.cardCode) ?? [];
    if (!ids.includes(card.instanceId)) ids.push(card.instanceId);
    copies.set(card.cardCode, ids);
  }
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
        const ids = copies.get(card.cardCode) ?? [];
        const counters = countersLabel(card);
        const copyTag = ids.length > 1 ? `#${ids.indexOf(card.instanceId) + 1}${counters ? `, ${counters}` : ''}` : null;
        const position = cardPositionLabel(state, card);
        const hoverLabel = [cardDef(card).title, copyTag, position].filter(Boolean).join(' · ');
        return (
          <button
            key={`${action.cardInstanceId}-${action.abilityIndex}`}
            onClick={() => {
              hoverPromptTarget(null);
              onAction(action);
            }}
            onMouseEnter={() => hoverPromptTarget({ id: card.instanceId, label: hoverLabel })}
            onMouseLeave={() => hoverPromptTarget(null)}
            className={`px-2 py-1 border text-[12px] text-left font-bold rounded-lg transition-all flex items-center gap-1.5 shadow ${accent}`}
            title={ability.label.replace(/\[click\]/g, 'click').replace(/\[credit\]/g, 'credit')}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            {cardDef(card).title}
            {copyTag && <span className="opacity-80 font-mono">{` (${copyTag})`}</span>}: {renderSymbols(ability.label)}
            {cost && <span className="opacity-70 inline-flex items-center">({cost})</span>}
          </button>
        );
      })}
    </div>
  );
};
