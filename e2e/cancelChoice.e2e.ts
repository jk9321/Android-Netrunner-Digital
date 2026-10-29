import { expect, test } from '@playwright/test';

// Red Team's "run which central server?" comes before anything resolves, so it can be cancelled
// without spending the click; once a server is picked the run starts as usual
test('cancel an ability whose first step is choosing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 60_000 });

  // Put a Red Team with its 12 credits in the Runner's rig of the saved game, then resume it
  await page.evaluate(() => {
    const key = 'netrunner.savedGame.v1';
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    const runner = saved.state.runner;
    const card = runner.grip.pop();
    Object.assign(card, { cardCode: '30018', tokens: { credit: 12 }, isRezzed: true, faceUp: true });
    runner.rig.resources.push(card);
    window.localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.getByText('Runner Actions (4 Clicks):')).toBeVisible({ timeout: 30_000 });

  const useRedTeam = async () => {
    await page.getByTestId('ability-bar-runner').getByRole('button', { name: /Red Team/ }).click();
    await expect(page.getByTestId('prompt-panel')).toContainText('Red Team: run which central server?');
  };
  await useRedTeam();
  await page.getByTestId('prompt-cancel').click();
  await expect(page.getByTestId('prompt-panel')).toHaveCount(0);
  await expect(page.getByText('Runner Actions (4 Clicks):')).toBeVisible();

  await useRedTeam();
  await page.getByTestId('prompt-panel').getByRole('button', { name: 'Archives' }).click();
  await expect(page.getByText('Runner Actions (3 Clicks):')).toBeVisible();
  expect(errors).toEqual([]);
});
