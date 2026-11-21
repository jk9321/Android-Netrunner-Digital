import { expect, test, type Page } from '@playwright/test';

/** Seeds a large Runner grip on the Runner's turn so the docked hand compresses beside the action bar and spreads on hover. */
async function seedLargeGrip(page: Page, count = 15) {
  await page.evaluate(target => {
    const key = 'netrunner.savedGame.v1';
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    const runner = saved.state.runner;
    while (runner.grip.length < target && runner.stack.length > 0) {
      runner.grip.push(runner.stack.pop());
    }
    window.localStorage.setItem(key, JSON.stringify(saved));
  }, count);
  await page.reload();
  await expect(page.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 30_000 });
}

// A normal-sized hand sits flat with no overlap; a cramped large hand compresses to stay clear of actions and spreads on hover
test('own hand stays flat when cards fit, spreads on hover when cramped, and closes when the pointer leaves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 60_000 });

  // Normal 5-card hand fits flat beside the action bar: no spread portal opens on hover
  const flatBox = (await page.getByTestId('hand-runner').locator('[data-hand-card]').first().boundingBox())!;
  await page.mouse.move(flatBox.x + flatBox.width / 2, flatBox.y + flatBox.height / 2);
  await page.waitForTimeout(250);
  await expect(page.getByTestId('hand-runner-spread')).toHaveCount(0);

  // The computer's hand has no spread
  const corp = (await page.getByTestId('hand-corp').locator('[data-hand-card]').first().boundingBox())!;
  await page.mouse.move(corp.x + corp.width / 2, corp.y + corp.height / 2);
  await page.waitForTimeout(250);
  await expect(page.getByTestId('hand-corp-spread')).toHaveCount(0);

  // Seed a 15-card hand that outgrows the space beside the action bar and must compress
  await page.mouse.move(5, 5);
  await seedLargeGrip(page, 15);

  const hand = page.getByTestId('hand-runner');
  const cards = hand.locator('[data-hand-card]');
  const width = async () => {
    const boxes = await cards.evaluateAll(els => els.map(el => el.getBoundingClientRect()));
    return boxes[boxes.length - 1].right - boxes[0].left;
  };
  const tight = await width();
  expect(await cards.count()).toBe(15);

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
  expect(errors).toEqual([]);
});

// The spread stays inside its own board section, so it never covers the sidebar controls or log
test('a spread hand stays within its board', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 60_000 });
  await seedLargeGrip(page, 15);

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

// Cards sliding under the pointer don't flick the hover popout; it settles on the card the pointer ends on
test('the hover popout waits for the spread to finish', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  // Dispatch clicks directly so the pointer doesn't rest over a newly drawn card before the hover check
  await page.getByTestId('start-game').dispatchEvent('click');
  await page.getByRole('button', { name: 'Keep hand' }).dispatchEvent('click', undefined, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 60_000 });
  await page.mouse.move(5, 5);
  await seedLargeGrip(page, 15);
  await expect(page.getByTestId('card-popout')).toHaveCount(0);

  // Time the spread and the hover popout in the page itself, so a slow CI runner can't
  // let the hold run out between two Playwright checks
  await page.evaluate(() => {
    const w = window as unknown as { enterAt?: number; popoutAt?: number };
    // The hand starts spreading, and holds previews, on this mouseenter
    document.querySelector('[data-testid="hand-runner"]')!.addEventListener('mouseenter', () => {
      w.enterAt ??= performance.now();
    });
    new MutationObserver(() => {
      if (w.popoutAt === undefined && document.querySelector('[data-testid="card-popout"]')) w.popoutAt = performance.now();
    }).observe(document.body, { childList: true, subtree: true });
  });
  const box = (await page.getByTestId('hand-runner').locator('[data-hand-card]').nth(2).boundingBox())!;
  await page.mouse.move(box.x + 10, box.y - 80);
  await page.mouse.move(box.x + 10, box.y + 30, { steps: 3 });
  await expect(page.getByTestId('hand-runner-spread')).toBeVisible();
  // A small move once the cards have slid, as a hand would make, so the browser re-reads what is hovered
  await page.waitForTimeout(400);
  await page.mouse.move(box.x + 12, box.y + 32);
  await expect(page.getByTestId('card-popout')).toHaveCount(1, { timeout: 5000 });
  // Nothing was previewed while the hand was still spreading (the hold is 260 ms from the hand's mouseenter)
  const { enterAt, popoutAt } = await page.evaluate(() => {
    const w = window as unknown as { enterAt: number; popoutAt: number };
    return { enterAt: w.enterAt, popoutAt: w.popoutAt };
  });
  expect(popoutAt - enterAt).toBeGreaterThanOrEqual(250);
});

// Picking a card from the spread hand keeps it open instead of closing and re-opening it
test('clicking a card in the spread hand keeps the spread', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 60_000 });
  await page.mouse.move(5, 5);
  await seedLargeGrip(page, 15);

  const box = (await page.getByTestId('hand-runner').locator('[data-hand-card]').first().boundingBox())!;
  await page.mouse.move(box.x + 20, box.y - 80);
  await page.mouse.move(box.x + 20, box.y + 30, { steps: 4 });
  const spread = page.getByTestId('hand-runner-spread');
  await expect(spread).toBeVisible();
  await page.waitForTimeout(500);
  const before = await spread.locator('> *').last().evaluate(el => el.getBoundingClientRect().right);
  await spread.locator('> *').nth(1).click();
  await page.waitForTimeout(100);
  await expect(spread).toBeVisible();
  expect(await spread.locator('> *').last().evaluate(el => el.getBoundingClientRect().right)).toBeCloseTo(before, 0);
});
