import { useSyncExternalStore } from 'react';
import { readStorage, writeStorage } from './storage';

/**
 * How the person's payments are made (Jeff 2026-11-26). 'auto': the engine's usual order, and the
 * hosted-credits buttons (CreditHoldBar) keep a card's credits for last. 'manual': when a cost could
 * come from more than one place (the pool and a card's credits, rules 1.10.3c), the payment panel
 * opens, filled in with what auto would pay, so one tap confirms and +/- moves credits. A payment
 * only the pool can make stays instant either way. Saved in localStorage; the computer always pays
 * on its own.
 */
export type PaymentMode = 'auto' | 'manual';

const STORAGE_KEY = 'netrunner.paymentMode';
const listeners = new Set<() => void>();
let mode: PaymentMode = readStorage(STORAGE_KEY) === 'manual' ? 'manual' : 'auto';

export function paymentMode(): PaymentMode {
  return mode;
}

export function setPaymentMode(next: PaymentMode): void {
  if (next === mode) return;
  mode = next;
  writeStorage(STORAGE_KEY, next);
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The current mode, re-rendering when it changes. */
export function usePaymentMode(): PaymentMode {
  return useSyncExternalStore(subscribe, paymentMode, paymentMode);
}

export const PAYMENT_MODE_LABELS: Record<PaymentMode, { short: string; title: string }> = {
  auto: {
    short: 'Auto',
    title: 'Auto: credits on your cards are spent first, then your pool. The hosted-credit buttons can save a card\'s credits for last.',
  },
  manual: {
    short: 'Manual',
    title: 'Manual: when a cost could be paid from your pool or from credits on your cards, a panel lets you choose how much comes from each.',
  },
};
