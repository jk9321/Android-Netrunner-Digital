import React from 'react';
import { CardInstance, GameAction, GameState, SideCode, cardDef, getCardScript } from '../../core';
import { Credits } from './CreditIcon';
import { useSeat } from '../seat';
import { PAYMENT_MODE_LABELS, setPaymentMode, usePaymentMode } from '../paymentMode';

interface CreditHoldBarProps {
  state: GameState;
  side: SideCode;
  onAction: (action: GameAction) => void;
}

/** Cards whose hosted credits payments can draw on (recurring, "spend during runs", restricted credits). */
export function payingCards(state: GameState, side: SideCode) {
  const installed: CardInstance[] =
    side === 'runner'
      ? [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources]
      : Object.values(state.corp.servers).flatMap(s => [...s.root, ...s.ice]).filter(c => c.isRezzed);
  return installed.filter(c => {
    const s = getCardScript(c.cardCode);
    return (c.tokens?.credit ?? 0) > 0 && !!(s?.recurringCredits || s?.paysDuringRuns || s?.paysFor);
  });
}

/**
 * Rules 1.10.3c: when hosted credits may pay, the player chooses how to divide the payment.
 * By default payments take hosted credits first; a toggle here keeps one card's credits for
 * last, so the credit pool pays first and that card only covers what the pool can't.
 */
export const CreditHoldBar: React.FC<CreditHoldBarProps> = ({ state, side, onAction }) => {
  const seat = useSeat();
  const mode = usePaymentMode();
  const cards = payingCards(state, side);
  // A held (uncommitted) choice is open: a toggle would commit it and lose its Cancel
  if (cards.length === 0 || seat.cancel) return null;
  const manual = mode === 'manual';
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid={`credit-hold-bar-${side}`}>
      <span className={`text-xs font-bold font-mono uppercase mr-1 ${side === 'corp' ? 'text-cyan-400' : 'text-pink-400'}`}>Hosted credits:</span>
      <button
        type="button"
        onClick={() => setPaymentMode(manual ? 'auto' : 'manual')}
        className={`px-2 py-1 text-[12px] font-bold rounded-[2px] border ${manual ? 'border-amber-500/80 text-amber-200 bg-amber-950/50' : 'border-slate-600 text-slate-300 bg-slate-900/60'}`}
        title={`${PAYMENT_MODE_LABELS[mode].title} Click to switch to ${manual ? 'Auto' : 'Manual'}.`}
        aria-pressed={manual}
        data-testid={`payment-mode-${side}`}
      >
        Pay: {PAYMENT_MODE_LABELS[mode].short}
      </button>
      {/* Manual: the payment panel asks at each payment, so there is nothing to save for last here */}
      {!manual && cards.map(card => {
        const held = !!card.holdCredits;
        return (
          <button
            key={card.instanceId}
            onClick={() => onAction({ type: 'SET_CREDIT_HOLD', player: side, cardInstanceId: card.instanceId, hold: !held })}
            className={`px-2 py-1 text-[12px] font-bold rounded-[2px] border inline-flex items-center gap-1.5 ${
              held ? 'border-amber-500/80 text-amber-200 bg-amber-950/50' : 'border-slate-600 text-slate-200 bg-slate-900/60'
            }`}
            title={held ? 'Payments use your credit pool first and these credits only if needed. Click to spend them first again.' : 'Payments spend these credits first. Click to save them: your pool pays first.'}
            aria-pressed={held}
          >
            {cardDef(card).title} <Credits amount={card.tokens?.credit ?? 0} />: {held ? 'saved, pool first' : 'spent first'}
          </button>
        );
      })}
    </div>
  );
};
