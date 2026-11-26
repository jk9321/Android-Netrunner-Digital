/**
 * Issue #76: a player missed the hosted-credit buttons and thought the game always spent Touchstone first.
 * The first time the hold bar shows, a tip explains it; once dismissed it never shows again (saved in localStorage).
 * Rules 1.10.3c (the player chooses how to divide a payment among allowed locations) is what the bar implements.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalTable } from '../src/ui/table';
import { SeatContext } from '../src/ui/seat';
import { CreditHoldBar, HOLD_TIP_KEY, resetHoldTipForTests } from '../src/ui/components/CreditHoldBar';
import { newGame, runnerInstall, startRunnerTurn } from './helpers';

const AZIMAT = '35029'; // 2 recurring credits

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  resetHoldTipForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetHoldTipForTests();
});

function render(withPayingCard: boolean) {
  const base = newGame(12345);
  startRunnerTurn(base);
  const state = withPayingCard ? runnerInstall(base, AZIMAT)[0] : base;
  const seat = new LocalTable(state, null, { confirm: async () => true, alert: () => {} }).seatFor('runner');
  return renderToStaticMarkup(
    <SeatContext.Provider value={seat}>
      <CreditHoldBar state={seat.state} side="runner" onAction={() => {}} />
    </SeatContext.Provider>,
  );
}

describe('first-time hosted credits tip (#76)', () => {
  it('shows with the hold bar until dismissed', () => {
    const html = render(true);
    expect(html).toContain('data-testid="credit-hold-tip"');
    expect(html).toContain('Got it');
    expect(html).toContain('data-testid="credit-hold-bar-runner"');
  });

  it('stays hidden once the dismissal is saved', () => {
    store.set(HOLD_TIP_KEY, '1');
    const html = render(true);
    expect(html).not.toContain('credit-hold-tip');
    expect(html).toContain('data-testid="credit-hold-bar-runner"');
  });

  it('does not show without a card whose credits can be saved', () => {
    expect(render(false)).toBe('');
  });
});
