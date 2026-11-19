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

/** The deal the run panel test plays (any seed works; a fixed one keeps the run the same on every CI run). */
const SEED = 20261119;

/** Do two bounding boxes overlap? */
function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Desktop runs dock into the sidebar without blocking the board; popping out opens a centred floating panel whose dragged spot does not persist
test('the run panel docks by default, toggles log, and reopens centred when popped out after dragging', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  // A fixed deal against the computer Corp (the default starter decks), so the board when the first run ends is
  // the same every time; a random deal made the second run flaky (CI run 44567895606)
  await page.goto(`/?seed=${SEED}&ai=corp`);
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  const gainCredit = page.getByRole('button', { name: '+1 Credit' });
  await expect(gainCredit).toBeEnabled({ timeout: 60_000 });

  const runArchives = page.getByTestId('server-archives').getByRole('button', { name: 'Run', exact: true });
  await runArchives.click();
  const overlay = page.getByTestId('run-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId('run-overlay-popout')).toBeVisible();
  expect(await fullyInView(page, 'run-overlay')).toBe(true);

  const overlayBox = (await overlay.boundingBox())!;
  const archivesBox = (await page.getByTestId('server-archives').boundingBox())!;
  expect(boxesOverlap(overlayBox, archivesBox)).toBe(false);
  await expect(page.getByText('SYS.TRACE // STACKHEAP')).toBeVisible();

  // Pop out into floating mode: opens centred, can be dragged off bottom
  await page.getByTestId('run-overlay-popout').click();
  await expect(page.getByTestId('run-overlay-dock')).toBeVisible();
  expect(await centred(page, 'run-overlay')).toBe(true);
  await dragOffBottom(page, 'run-overlay');
  expect(await fullyInView(page, 'run-overlay')).toBe(false); // dragging off screen is still allowed

  // Minimize and restore: back in the centre
  await page.getByTestId('run-overlay-minimize').click();
  await page.getByTestId('run-overlay-restore').click();
  expect(await centred(page, 'run-overlay')).toBe(true);

  // Can re-dock back into sidebar and pop out again cleanly
  await page.getByTestId('run-overlay-dock').click();
  await expect(page.getByTestId('run-overlay-popout')).toBeVisible();
  await page.getByTestId('run-overlay-popout').click();
  expect(await centred(page, 'run-overlay')).toBe(true);

  // Drag it off again and finish the run; the next run opens cleanly docked in the sidebar
  await dragOffBottom(page, 'run-overlay');
  // Wait for the panel's state, not a fixed number of clicks: how many steps the run takes depends on the deal
  // and on how fast the computer decides. Click whichever step button is showing until the panel closes.
  const step = overlay.getByRole('button', { name: /Approach|Move Inward|Continue Run|Pass|Let Subroutines Fire|Keep Going/ });
  await expect
    .poll(
      async () => {
        if (!(await overlay.isVisible())) return 'closed';
        // An access in Archives can ask the Runner something (which card next, pay to trash), and a step click
        // while that is pending opens an "Action blocked" dialog: close it and take the first answer (not a trash)
        const blocked = page.getByRole('alertdialog').getByRole('button', { name: 'OK' });
        if (await blocked.count()) await blocked.first().click({ timeout: 2_000 }).catch(() => {});
        const answer = page.getByTestId('prompt-panel').getByRole('button', { name: /^(?!Minimize|Inspect|Trash|Pop out|Dock)/ });
        if (await answer.count()) await answer.first().dispatchEvent('click', undefined, { timeout: 2_000 }).catch(() => {});
        // The button is off screen with the panel, so click it without scrolling
        if (await step.count()) await step.first().dispatchEvent('click', undefined, { timeout: 2_000 }).catch(() => {});
        return 'open';
      },
      { timeout: 60_000, intervals: [300] },
    )
    .toBe('closed');
  await page.keyboard.press('Escape'); // close an access panel if one opened
  // The run is over only when the Runner can take an action again (the computer may still be answering it)
  await expect(gainCredit).toBeEnabled({ timeout: 30_000 });
  await expect(runArchives).toBeEnabled();
  await runArchives.click();
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId('run-overlay-popout')).toBeVisible();
  expect(await fullyInView(page, 'run-overlay')).toBe(true);
});
