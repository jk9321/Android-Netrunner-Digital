import { expect, test } from '@playwright/test';

// Manual payment (rules 1.10.3c): with Urban Art Vernissage's credits able to pay an install, the panel opens filled
// in with Auto's split; moving the credits to the pool keeps the card's credits
test('manual payment panel: pre-filled, +/- moves credits, Pay sends the split', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 60_000 });

  // Urban Art Vernissage (2 credits for installs) in the rig, Cleavers (install cost 3) in the grip, 5 in the pool, Manual on
  await page.evaluate(() => {
    const key = 'netrunner.savedGame.v1';
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    const runner = saved.state.runner;
    const card = runner.grip.pop();
    Object.assign(card, { cardCode: '34029', tokens: { credit: 2 }, isRezzed: true, faceUp: true });
    runner.rig.resources.push(card);
    for (const c of runner.grip) c.cardCode = '30006';
    runner.credits = 5;
    window.localStorage.setItem(key, JSON.stringify(saved));
    window.localStorage.setItem('netrunner.paymentMode', 'manual');
  });
  await page.reload();
  await expect(page.getByText('Runner Actions (4 Clicks):')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('payment-mode-runner').first()).toContainText('Manual');

  await page.getByTestId('hand-runner').locator('[data-hand-card]').first().click();
  await page.getByRole('button', { name: /Install Card/ }).click();
  const panel = page.getByTestId('payment-panel');
  await expect(panel).toBeVisible();
  await page.screenshot({ path: 'test-results/manual-payment-panel.png' });
  // Auto's split: the card's 2, then 1 from the pool
  await expect(page.getByTestId('payment-amount-pool')).toHaveText('1');
  const cardRow = panel.locator('li').nth(1);
  await expect(cardRow).toContainText('Urban Art');
  const card = cardRow.locator('[data-testid^="payment-amount-"]');
  await expect(card).toHaveText('2');
  // Two less from the card: they go back to the pool
  await cardRow.locator('[data-testid^="payment-less-"]').click();
  await cardRow.locator('[data-testid^="payment-less-"]').click();
  await expect(page.getByTestId('payment-amount-pool')).toHaveText('3');
  await expect(card).toHaveText('0');
  await page.getByTestId('payment-confirm').click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText('3 / 4 Clicks')).toBeVisible();
  // The pool paid all 3; Urban Art kept its 2
  const after = await page.evaluate(() => JSON.parse(window.localStorage.getItem('netrunner.savedGame.v1')!).state.runner);
  expect(after.credits).toBe(2);
  expect(after.rig.resources.find((c: { cardCode: string }) => c.cardCode === '34029').tokens.credit).toBe(2);

  // Cancel sends nothing
  await page.getByTestId('hand-runner').locator('[data-hand-card]').first().click();
  await page.getByRole('button', { name: /Install Card/ }).click();
  await expect(panel).toBeVisible();
  await page.getByTestId('payment-cancel').click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText('3 / 4 Clicks')).toBeVisible();
  expect(errors).toEqual([]);
});
