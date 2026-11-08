import { expect, test } from '@playwright/test';

// Auto fit shrinks board cards (down to a floor) so a cramped board needs no scrolling, and the toggle turns it off
test('auto fit shrinks cards to avoid scrolling and can be switched off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.setViewportSize({ width: 1366, height: 768 });

  await page.goto('/');
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByTestId('runner-credits')).toBeVisible({ timeout: 60_000 });

  const size = page.getByTestId('card-size');
  await size.getByRole('button', { name: 'Large' }).click();
  const cardWidth = () => page.locator('[data-testid=auto-fit-area] .card-fit').first().evaluate(el => el.getBoundingClientRect().width);
  const overflowing = () =>
    page.locator('[data-testid=auto-fit-area]').evaluateAll(els => els.some(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1));

  const auto = page.getByTestId('auto-fit');
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(overflowing).toBe(true); // too cramped without auto fit
  const unfit = await cardWidth();

  await auto.click();
  // The shrink glides: sizes between the start and the end are seen on the way
  const seen = new Set<number>();
  for (let i = 0; i < 20; i++) {
    seen.add(Math.round(await cardWidth()));
    await page.waitForTimeout(30);
  }
  expect(seen.size).toBeGreaterThan(2);
  await expect.poll(cardWidth).toBeLessThan(unfit);
  // Scrolling is gone, unless the deal built a board too big even at the floor (half the
  // normal width), when auto fit stops there and lets it scroll (CI 2026-11-08 hit such a deal)
  const floor = unfit * 0.5;
  await expect
    .poll(async () => !(await overflowing()) || Math.abs((await cardWidth()) - floor) <= 1)
    .toBe(true);
  expect(await cardWidth()).toBeGreaterThanOrEqual(floor - 1); // never below the floor

  expect(errors).toEqual([]);
});
