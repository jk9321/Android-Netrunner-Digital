import { expect, test, type Page } from '@playwright/test';

// The end-of-turn discard picks cards straight from the hand on the table, as well as from the prompt's own copies
test('board clicks pick hand cards for the end-of-turn discard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 60_000 });

  // Leave the Runner one click and seven cards in the grip (hand size 5), then resume the saved game
  await page.evaluate(() => {
    const key = 'netrunner.savedGame.v1';
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    const runner = saved.state.runner;
    while (runner.grip.length < 7) runner.grip.push(runner.stack.pop());
    runner.clicks = 1;
    window.localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.getByText('Runner Actions (1 Clicks):')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '+1 Credit' }).click();
  await page.getByRole('button', { name: 'End Runner Turn' }).click();
  const panel = page.getByTestId('prompt-panel');
  await expect(panel).toContainText(/discard/i, { timeout: 30_000 });

  const targets = page.locator('[data-testid="hand-runner"] [data-board-target="true"]');
  await expect(targets).toHaveCount(7);
  await targets.nth(0).click();
  await expect(panel).toContainText('Selected 1');
  await targets.nth(1).click();
  await expect(panel).toContainText('Selected 2');
  // Clicking a picked card again unpicks it
  await targets.nth(1).click();
  await expect(panel).toContainText('Selected 1');
  expect(errors).toEqual([]);
});

async function passHandoff(page: Page) {
  const ready = page.getByTestId('handoff-ready');
  if (await ready.isVisible()) {
    await ready.click();
    await page.waitForTimeout(300);
  }
}

// In the Corp's rez window during a run, clicking the approached ice on the table rezzes it, like the run panel's Rez button
test('board clicks rez the approached ice in the Corp rez window', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('mode-hotseat').click();
  await page.getByTestId('start-game').click();
  const keep = page.getByRole('button', { name: 'Keep hand' });
  const corpActions = page.getByText(/Corp Actions \(\d Clicks\):/);
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(700);
    await passHandoff(page);
    if (await keep.isVisible()) await keep.click();
    else if (await corpActions.isVisible()) break;
  }
  await expect(corpActions).toBeVisible();

  // Unrezzed Palisade on HQ, money to rez it, and the Corp's clicks spent, then resume the saved game
  await page.evaluate(() => {
    const key = 'netrunner.savedGame.v1';
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    const corp = saved.state.corp;
    corp.credits = 30;
    corp.clicks = 0;
    while (corp.hq.length > 4) corp.archives.faceDown.push(corp.hq.pop());
    const ice = corp.rd.pop();
    Object.assign(ice, { cardCode: '30072', isRezzed: false, faceUp: false });
    corp.servers.hq.ice.push(ice);
    window.localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForTimeout(1000);
  await passHandoff(page);
  await page.getByRole('button', { name: /End Corp Turn/ }).click();

  const runnerActions = page.getByText(/Runner Actions \(\d Clicks\):/);
  for (let i = 0; i < 8 && !(await runnerActions.isVisible()); i++) {
    await page.waitForTimeout(700);
    await passHandoff(page);
  }
  // Pass and play: the Runner's table can show under the hand-off cover before it is passed
  await passHandoff(page);
  await page.getByTestId('server-hq').getByRole('button', { name: 'Run' }).click();
  const rezButton = page.locator('[data-testid^="rez-"]').first();
  for (let i = 0; i < 12 && !(await rezButton.isVisible()); i++) {
    await page.waitForTimeout(700);
    await passHandoff(page);
    const approach = page.getByRole('button', { name: /^(Approach|Continue Run)$/ });
    if (await approach.isVisible()) await approach.click();
  }
  await expect(rezButton).toBeVisible();
  await passHandoff(page);

  const target = page.locator('#corp-board [data-board-target="true"]');
  await expect(target).toHaveCount(1);
  // Click the card's corner, away from its own Rez button in the middle
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width - 12, box.y + 12);
  await expect(rezButton).toHaveCount(0);
  await expect(page.getByText('Corp spent 3')).toBeVisible();
  await expect(target).toHaveCount(0);
  expect(errors).toEqual([]);
});
