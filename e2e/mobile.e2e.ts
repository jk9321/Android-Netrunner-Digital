import { expect, test } from '@playwright/test';

// End-to-end verification of the isolated mobile UI shell at phone portrait (390x844) and landscape (844x390) viewports.
test('mobile portrait shell: zero overflow on 1-remote board, peeking hand, tap-to-act server & run sheets', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('start-game').click();

  // Isolated mobile shell mounts on phone viewports
  await expect(page.getByTestId('mobile-game-shell')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('mobile-game-shell')).toHaveAttribute('data-layout', 'portrait');

  // Phase 3 Mulligan prompt opens inside MobilePromptSheet with Peek <-> Decide toggle
  const promptSheet = page.getByTestId('mobile-prompt-sheet');
  await expect(promptSheet).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('mobile-prompt-sheet-peek-btn').click();
  await expect(page.getByTestId('mobile-prompt-sheet-peek')).toBeVisible();
  await page.getByTestId('mobile-prompt-sheet-restore').click();
  await expect(promptSheet).toBeVisible();
  await page.getByRole('button', { name: 'Keep hand' }).click();

  // Wait for Runner's turn after Corp AI plays
  const endTurn = page.getByTestId('end-turn');
  await expect(endTurn).toBeVisible({ timeout: 60_000 });

  // Seed a 1-remote board (Archives + R&D + HQ + Remote 1 with 2 ice) to verify zero horizontal scroll
  await page.evaluate(() => {
    const key = 'netrunner.savedGame.v1';
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    const corp = saved.state.corp;
    // Keep only the 3 centrals plus exactly 1 remote so we assert the 4-column fit guarantee
    for (const id of Object.keys(corp.servers)) {
      if (corp.servers[id].isRemote) delete corp.servers[id];
    }
    const ice1 = corp.rd.pop();
    const ice2 = corp.rd.pop();
    const root = corp.rd.pop();
    if (ice1) Object.assign(ice1, { cardCode: '30072', isRezzed: true, faceUp: true });
    if (ice2) Object.assign(ice2, { cardCode: '30072', isRezzed: false, faceUp: false });
    corp.servers.remote1 = {
      id: 'remote1',
      name: 'Remote 1',
      isRemote: true,
      ice: [ice1, ice2].filter(Boolean),
      root: [root].filter(Boolean),
    };
    window.localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.getByTestId('mobile-corp-board')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('server-remote1')).toBeVisible();

  // Zero page horizontal overflow AND zero Corp server-strip horizontal overflow on a 4-server board
  const overflow = await page.evaluate(() => {
    const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const strip = document.querySelector('[data-testid="mobile-corp-board"] .overflow-x-auto') as HTMLElement | null;
    const stripOverflow = strip ? strip.scrollWidth > strip.clientWidth + 1 : true;
    return { docOverflow, stripOverflow };
  });
  expect(overflow).toEqual({ docOverflow: false, stripOverflow: false });

  // Left-docked slide-out menu opens and closes cleanly
  await page.getByTestId('mobile-menu-button').click();
  await expect(page.getByTestId('mobile-menu-drawer')).toBeVisible();
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(page.getByTestId('mobile-menu-drawer')).toHaveCount(0);

  // Peeking Hand Tray starts tucked, expands on card tap showing selected-card action bar, then tucks
  await expect(page.getByTestId('mobile-hand-toggle')).toContainText('Expand');
  await page.locator('[data-testid="hand-runner"] [data-hand-card]').first().click();
  await expect(page.getByTestId('mobile-selected-card-bar')).toBeVisible();
  await expect(page.getByTestId('mobile-hand-toggle')).toContainText('Tuck');
  await page.getByTestId('mobile-hand-toggle').click();
  await expect(page.getByTestId('mobile-hand-toggle')).toContainText('Expand');

  // Tapping R&D server opens MobileServerSheet -> Run R&D -> MobileRunSheet with Peek <-> Run
  await page.getByTestId('mobile-server-rd').click();
  await expect(page.getByTestId('mobile-server-sheet')).toBeVisible();
  await page.getByTestId('mobile-run-rd').click();
  await expect(page.getByTestId('mobile-run-sheet')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('mobile-run-sheet-peek-btn').click();
  await expect(page.getByTestId('mobile-run-sheet-peek')).toBeVisible();
  await page.getByTestId('mobile-run-sheet-restore').click();
  await expect(page.getByTestId('mobile-run-sheet')).toBeVisible();

  expect(errors).toEqual([]);
  await context.close();
});

test('mobile landscape phone renders side-by-side boards without page overflow', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('start-game').click();

  await expect(page.getByTestId('mobile-game-shell')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('mobile-game-shell')).toHaveAttribute('data-layout', 'landscape');
  const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(docOverflow).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});
