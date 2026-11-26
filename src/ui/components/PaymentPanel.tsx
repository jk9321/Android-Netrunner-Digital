import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Check, X } from 'lucide-react';
import { GameAction, PaymentPlan, PaymentQuote, PaymentSource, cardDef, findCardAnywhere } from '../../core';
import type { Seat } from '../seatLegality';
import { seatPaymentChoice } from '../seatLegality';
import { paymentMode, setPaymentMode } from '../paymentMode';
import { Credits } from './CreditIcon';

/** An action waiting on the person's split of its payment. */
interface Pending {
  action: GameAction;
  quote: PaymentQuote;
  seat: Seat;
}

/**
 * Manual payment (paymentMode.ts): the person's actions go through here. When a cost could come
 * from more than one place (rules 1.10.3c), the action waits for the panel instead of being sent;
 * confirming sends it with the person's split. Everything else goes straight through. The panel
 * closes by itself if the game moves on while it is open (its action may no longer be possible).
 */
export function usePaymentPanel(seat: Seat, act: (action: GameAction) => Promise<void> | void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const actRef = useRef(act);
  actRef.current = act;

  useEffect(() => {
    if (pending && pending.seat !== seat) setPending(null);
  }, [seat, pending]);

  const handle = async (action: GameAction): Promise<void> => {
    if (paymentMode() === 'manual') {
      const quote = seatPaymentChoice(seat, action);
      if (quote) {
        setPending({ action, quote, seat });
        return;
      }
    }
    await actRef.current(action);
  };

  const panel = pending ? (
    <PaymentPanel
      key={pending.quote.amount + ':' + pending.action.type}
      quote={pending.quote}
      seat={pending.seat}
      onCancel={() => setPending(null)}
      onPay={plan => {
        setPending(null);
        void actRef.current(plan ? { ...pending.action, payment: plan } : pending.action);
      }}
    />
  ) : null;

  return { handleAction: handle, panel };
}

const POOL_FIRST = ['pool', 'run', 'badPublicity'];

function label(seat: Seat, source: PaymentSource): string {
  if (source.key === 'pool') return 'Credit pool';
  if (source.key === 'run') return 'Run credits';
  if (source.key === 'badPublicity') return 'Bad publicity credits';
  const card = source.cardInstanceId ? findCardAnywhere(seat.state, source.cardInstanceId) : undefined;
  return card ? cardDef(card).title : 'Hosted credits';
}

/** The split as the engine takes it. */
export function planOf(sources: PaymentSource[], split: number[]): PaymentPlan {
  const at = (key: string) => split[sources.findIndex(s => s.key === key)] ?? 0;
  const run = at('run');
  const badPublicity = at('badPublicity');
  return {
    pool: at('pool'),
    ...(run > 0 && { run }),
    ...(badPublicity > 0 && { badPublicity }),
    cards: sources.flatMap((s, i) => (s.cardInstanceId ? [{ cardInstanceId: s.cardInstanceId, credits: split[i] }] : [])),
  };
}

/**
 * One credit moved onto (+) or off (-) a source, keeping the total at the cost: it comes from (or
 * goes back to) the pool first, then the other sources in order. Null if nothing can move.
 */
export function moveCredit(sources: PaymentSource[], split: number[], index: number, delta: 1 | -1): number[] | null {
  const target = split[index] + delta;
  if (target < 0 || target > sources[index].max) return null;
  const order = [...sources.keys()].filter(i => i !== index).sort((a, b) => rank(sources[a]) - rank(sources[b]));
  const other = order.find(i => (delta === 1 ? split[i] > 0 : split[i] < sources[i].max));
  if (other === undefined) return null;
  const next = [...split];
  next[index] = target;
  next[other] -= delta;
  return next;
}

const rank = (s: PaymentSource) => {
  const i = POOL_FIRST.indexOf(s.key);
  return i === -1 ? POOL_FIRST.length : i;
};

/** Where this payment's credits come from: filled in with what Auto would pay, one tap to confirm. */
const PaymentPanel: React.FC<{
  quote: PaymentQuote;
  seat: Seat;
  onCancel: () => void;
  onPay: (plan: PaymentPlan | null) => void;
}> = ({ quote, seat, onCancel, onPay }) => {
  const { sources, amount } = quote;
  const auto = sources.map(s => s.auto);
  const [split, setSplit] = useState<number[]>(auto);
  const payRef = useRef<HTMLButtonElement>(null);
  const isAuto = split.every((n, i) => n === auto[i]);
  const corp = quote.side === 'corp';

  useEffect(() => {
    payRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 flex items-end sm:items-center justify-center p-3"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      data-testid="payment-panel"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-panel-title"
        className={`w-full max-w-sm bg-[#090d15] border rounded-[2px] shadow-2xl font-mono ${corp ? 'border-cyan-500/70' : 'border-pink-500/70'}`}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800 bg-[#0d1420]">
          <h2 id="payment-panel-title" className={`font-cyber font-bold text-xs tracking-wider uppercase ${corp ? 'text-cyan-300' : 'text-pink-300'}`}>
            Pay <Credits amount={amount} />
          </h2>
          <span className="text-[11px] text-slate-400">Choose where the credits come from</span>
        </div>
        <ul className="p-2 space-y-1.5">
          {sources.map((s, i) => {
            const less = moveCredit(sources, split, i, -1);
            const more = moveCredit(sources, split, i, 1);
            return (
              <li key={s.key} className="flex items-center gap-2 bg-[#05080e] border border-slate-800 rounded-[2px] px-2 py-1.5" data-testid={`payment-source-${s.key}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-100 font-bold truncate">{label(seat, s)}</div>
                  <div className="text-[11px] text-slate-400">
                    has <Credits amount={s.max} />
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`One less from ${label(seat, s)}`}
                  disabled={!less}
                  onClick={() => less && setSplit(less)}
                  className="w-9 h-9 flex items-center justify-center rounded-[2px] border border-slate-600 text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid={`payment-less-${s.key}`}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-10 text-center text-base font-bold text-amber-300" data-testid={`payment-amount-${s.key}`}>
                  {split[i]}
                </span>
                <button
                  type="button"
                  aria-label={`One more from ${label(seat, s)}`}
                  disabled={!more}
                  onClick={() => more && setSplit(more)}
                  className="w-9 h-9 flex items-center justify-center rounded-[2px] border border-slate-600 text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid={`payment-more-${s.key}`}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="px-3 pb-1 text-[11px] text-slate-400">
          {isAuto ? 'This is what Auto would pay.' : 'Your own split.'}{' '}
          {!isAuto && (
            <button type="button" className="underline hover:text-slate-200" onClick={() => setSplit(auto)} data-testid="payment-reset">
              Back to Auto's
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-800">
          <button
            type="button"
            className="text-[11px] text-slate-400 underline hover:text-slate-200"
            title="Switch payments back to Auto (Menu > Payments). This payment uses Auto's split."
            onClick={() => {
              setPaymentMode('auto');
              onPay(null);
            }}
            data-testid="payment-always-auto"
          >
            Always pay automatically
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-bold rounded-[2px] border border-slate-600 text-slate-300 hover:border-slate-400 inline-flex items-center gap-1"
              data-testid="payment-cancel"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              ref={payRef}
              type="button"
              onClick={() => onPay(planOf(sources, split))}
              className="px-3 py-1.5 text-xs font-bold rounded-[2px] border border-amber-400 text-amber-200 bg-amber-950/50 hover:bg-amber-900/50 inline-flex items-center gap-1"
              data-testid="payment-confirm"
            >
              <Check className="w-3.5 h-3.5" /> Pay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
