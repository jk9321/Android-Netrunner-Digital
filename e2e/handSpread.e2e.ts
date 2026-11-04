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

// The spread stays inside its own board section, so it never covers the zoom view or the log
test('a spread hand stays within its board', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByTestId('runner-credits')).toBeVisible({ timeout: 60_000 });

  const box = (await page.getByTestId('hand-runner').locator('[data-hand-card]').first().boundingBox())!;
  await page.mouse.move(box.x + 20, box.y - 80);
  await page.mouse.move(box.x + 20, box.y + 30, { steps: 5 });
  const spread = page.getByTestId('hand-runner-spread');
  await expect(spread).toBeVisible();
  await page.waitForTimeout(500);
  const board = (await page.locator('#runner-board').boundingBox())!;
  const rects = await spread.locator('> *').evaluateAll(els => els.map(el => el.getBoundingClientRect().right));
  expect(Math.max(...rects)).toBeLessThanOrEqual(board.x + board.width);
});

// Cards sliding under the pointer don't flick the zoom panel; it settles on the card the pointer ends on
test('the zoom panel waits for the spread to finish', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.goto('/');
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByTestId('runner-credits')).toBeVisible({ timeout: 60_000 });

  const box = (await page.getByTestId('hand-runner').locator('[data-hand-card]').nth(2).boundingBox())!;
  await page.mouse.move(box.x + 10, box.y - 80);
  await page.mouse.move(box.x + 10, box.y + 30, { steps: 3 });
  // Right after the hand opens nothing is previewed yet
  await expect(page.getByTestId('hand-runner-spread')).toBeVisible();
  await expect(page.getByTestId('zoom-panel')).toHaveCount(0);
  await expect(page.getByTestId('zoom-panel')).toHaveCount(1, { timeout: 2000 });
});
