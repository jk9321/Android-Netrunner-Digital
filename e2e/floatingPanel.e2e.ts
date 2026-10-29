import { Page, expect, test } from '@playwright/test';

/** Is the whole element inside the window? */
async function fullyInView(page: Page, testId: string): Promise<boolean> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  const view = page.viewportSize()!;
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height;
}

/** Is the element centred in the window (within a few pixels)? */
async function centred(page: Page, testId: string): Promise<boolean> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  const view = page.viewportSize()!;
  return Math.abs(box.x + box.width / 2 - view.width / 2) < 4 && Math.abs(box.y + box.height / 2 - view.height / 2) < 4;
}

/** Drags a floating panel by its header until only the header is left on screen. */
async function dragOffBottom(page: Page, testId: string) {
  const handle = (await page.getByTestId(`${testId}-handle`).boundingBox())!;
  await page.mouse.move(handle.x + 40, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, page.viewportSize()!.height - 5, { steps: 5 });
  await page.mouse.up();
}

// A dragged panel doesn't stay where it was dragged: restoring it or opening the next one puts it back in the centre
test('the run panel reopens centred after being dragged', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.goto('/');
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 60_000 });

  const runArchives = page.getByTestId('server-archives').getByRole('button', { name: 'Run', exact: true });
  await runArchives.click();
  await expect(page.getByTestId('run-overlay')).toBeVisible();
  expect(await centred(page, 'run-overlay')).toBe(true);
  await dragOffBottom(page, 'run-overlay');
  expect(await fullyInView(page, 'run-overlay')).toBe(false); // dragging off screen is still allowed

  // Minimize and restore: back in the centre
  await page.getByTestId('run-overlay-minimize').click();
  await page.getByTestId('run-overlay-restore').click();
  expect(await centred(page, 'run-overlay')).toBe(true);

  // Drag it off again and finish the run; the next run's panel opens in the centre
  await dragOffBottom(page, 'run-overlay');
  const overlay = page.getByTestId('run-overlay');
  for (let i = 0; i < 10 && (await overlay.isVisible()); i++) {
    // The button is off screen with the panel, so click it without scrolling
    await overlay.getByRole('button', { name: /Continue Run|Pass|Let Subroutines Fire|Keep Going/ }).dispatchEvent('click');
    await page.waitForTimeout(800); // the computer may rez in between
  }
  await expect(overlay).toBeHidden({ timeout: 10_000 });
  await page.keyboard.press('Escape'); // close an access panel if one opened
  await runArchives.click();
  await expect(overlay).toBeVisible();
  expect(await centred(page, 'run-overlay')).toBe(true);
  expect(await fullyInView(page, 'run-overlay')).toBe(true);
});
