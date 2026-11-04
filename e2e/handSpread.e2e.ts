import { expect, test } from '@playwright/test';

// Your hand overlaps to save room and spreads out under the pointer; the computer's hand stays tight
test('own hand spreads on hover and closes when the pointer leaves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByTestId('runner-credits')).toBeVisible({ timeout: 60_000 });

  const hand = page.getByTestId('hand-runner');
  const cards = hand.locator('[data-hand-card]');
  const width = async () => {
    const boxes = await cards.evaluateAll(els => els.map(el => el.getBoundingClientRect()));
    return boxes[boxes.length - 1].right - boxes[0].left;
  };
  const tight = await width();
  const count = await cards.count();
  expect(count).toBeGreaterThan(3);

  const box = (await cards.first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const spread = page.getByTestId('hand-runner-spread');
  await expect(spread).toBeVisible();
  await expect.poll(async () => {
    const boxes = await spread.locator('> *').evaluateAll(els => els.map(el => el.getBoundingClientRect()));
    return boxes[boxes.length - 1].right - boxes[0].left;
  }).toBeGreaterThan(tight * 1.15);

  await page.mouse.move(box.x + box.width / 2, box.y - 150, { steps: 5 });
  await page.mouse.move(5, 5, { steps: 5 });
  await expect(spread).toHaveCount(0);

  // The computer's hand has no spread
  const corp = (await page.getByTestId('hand-corp').locator('[data-hand-card]').first().boundingBox())!;
  await page.mouse.move(corp.x + corp.width / 2, corp.y + corp.height / 2);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('hand-corp-spread')).toHaveCount(0);
  expect(errors).toEqual([]);
});
