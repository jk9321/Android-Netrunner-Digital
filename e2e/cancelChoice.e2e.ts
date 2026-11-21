import { expect, test } from '@playwright/test';

// Red Team's "run which central server?" comes before anything resolves, so it can be cancelled
// without spending the click; once a server is picked the run starts as usual
test('cancel an ability whose first step is choosing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
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
    await expect(page.getByTestId('prompt-panel-popout')).toBeVisible();
    await expect(page.getByText('SYS.TRACE // STACKHEAP')).toBeVisible();
  };
  await useRedTeam();
  // Board prompts can pop out to float and re-dock back into the sidebar
  await page.getByTestId('prompt-panel-popout').click();
  await expect(page.getByTestId('prompt-panel-dock')).toBeVisible();
  await page.getByTestId('prompt-panel-dock').click();
  await expect(page.getByTestId('prompt-panel-popout')).toBeVisible();

  await page.getByTestId('prompt-cancel').click();
  await expect(page.getByTestId('prompt-panel')).toHaveCount(0);
  await expect(page.getByText('Runner Actions (4 Clicks):')).toBeVisible();

  await useRedTeam();
  // Clicking the targetable server column directly on the board answers the prompt too
  await expect(page.getByTestId('server-archives')).toHaveAttribute('data-server-target', 'true');
  await page.getByTestId('server-archives').click({ position: { x: 40, y: 120 } });
  await expect(page.getByText('3 / 4 Clicks')).toBeVisible();
  await expect(page.getByTestId('run-overlay')).toContainText('RUN // ARCHIVES');
  expect(errors).toEqual([]);
});

/** The deal the board-click install test plays; its first installable card goes straight onto a central. */
const INSTALL_SEED = 20261120;

test('board clicks install a selected Corp card directly onto a server column', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  // A fixed deal against the computer Runner (the default starter decks). With a random deal the first card could be
  // an asset or agenda going into a remote that already held a card, and the click at (40, 120) then landed on that
  // card's own Inspect button, which keeps the click to itself (CI run 44685258464)
  await page.goto(`/?seed=${INSTALL_SEED}&ai=runner`);
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByText('Corp Actions (3 Clicks):')).toBeVisible({ timeout: 30_000 });

  // Select an ice or upgrade/asset/agenda in HQ directly from the flat hand dock
  const pickInstallableInHq = async (requireBoardServer = false): Promise<boolean> => {
    const cards = page.getByTestId('hand-corp').locator('[data-hand-card]');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click();
      if (await page.getByTestId('install-options').count()) {
        if (!requireBoardServer || (await page.locator('#corp-board [data-server-target="true"]').count()) > 0) {
          await page.mouse.move(10, 10);
          return true;
        }
      }
    }
    await page.mouse.move(10, 10);
    return false;
  };

  expect(await pickInstallableInHq()).toBe(true);

  const installBtn = page.getByTestId('install-options').locator('button[data-testid^="install-"]').first();
  const btnId = (await installBtn.getAttribute('data-testid'))!;
  // Create a remote if the first installable card only goes into a new remote, then pick a card targeting an existing server
  if (btnId === 'install-new' && (await page.locator('#corp-board [data-server-target="true"]').count()) === 0) {
    await installBtn.click();
    await expect(page.getByText('Corp Actions (2 Clicks):')).toBeVisible();
    expect(await pickInstallableInHq(true)).toBe(true);
  }

  const targetServer = page.locator('#corp-board [data-server-target="true"]').first();
  await expect(targetServer).toBeVisible();
  const serverTestId = (await targetServer.getAttribute('data-testid'))!;
  // Click inside the central/remote server column (even over its anchor/pile) to install directly
  await targetServer.click({ position: { x: 40, y: 120 } });
  await expect(page.getByTestId('install-options')).toHaveCount(0);
  await expect(page.getByTestId(serverTestId)).not.toHaveAttribute('data-server-target', 'true');
  expect(errors).toEqual([]);
});
