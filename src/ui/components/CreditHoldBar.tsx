import React, { useSyncExternalStore } from 'react';
import { CardInstance, GameAction, GameState, SideCode, cardDef, getCardScript } from '../../core';
import { Credits } from './CreditIcon';
import { useSeat } from '../seat';
import { PAYMENT_MODE_LABELS, setPaymentMode, usePaymentMode } from '../paymentMode';
import { readStorage, writeStorage } from '../storage';

/** Saved once the player dismisses the first-time tip; it never shows again (issue #76). */
export const HOLD_TIP_KEY = 'netrunner.creditHoldTipSeen';

// One shared flag so every bar on screen (Corp and Runner, desktop and mobile) hides together
const tipListeners = new Set<() => void>();
let tipSeenMemo: boolean | null = null;
function tipSeen(): boolean {
  if (tipSeenMemo === null) tipSeenMemo = readStorage(HOLD_TIP_KEY) === '1';
  return tipSeenMemo;
}
function dismissTip() {
  tipSeenMemo = true;
  writeStorage(HOLD_TIP_KEY, '1');
  tipListeners.forEach(l => l());
}
function subscribeTip(listener: () => void) {
  tipListeners.add(listener);
  return () => { tipListeners.delete(listener); };
}
/** Test hook: forget the in-memory flag so the next read goes back to storage. */
export function resetHoldTipForTests() {
  tipSeenMemo = null;
}

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
  const seen = useSyncExternalStore(subscribeTip, tipSeen, tipSeen);
  // A held (uncommitted) choice is open: a toggle would commit it and lose its Cancel
  if (cards.length === 0 || seat.cancel) return null;
  const manual = mode === 'manual';
  const example = cardDef(cards[0]).title;
  return (
    <div className="flex flex-col gap-1.5" data-testid={`credit-hold-bar-${side}`}>
    {!seen && (
      <div
        role="note"
        className="flex items-start gap-2 text-[12px] leading-snug rounded-[2px] border border-amber-500/70 bg-amber-950/60 text-amber-100 px-2 py-1.5"
        data-testid="credit-hold-tip"
      >
        <span>
          <b>Tip:</b> payments spend hosted credits (like {example}) before your credit pool.
          To keep a card&apos;s credits for something else, click its button below: your pool pays first and that card only covers the rest. Or set Pay to Manual to choose where each payment comes from.
        </span>
        <button
          onClick={dismissTip}
          className="shrink-0 px-2 py-0.5 font-bold rounded-[2px] border border-amber-500/80 text-amber-100 hover:bg-amber-900/60"
        >
          Got it
        </button>
      </div>
    )}
    <div className="flex items-center gap-1.5 flex-wrap">
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
    </div>
  );
};
