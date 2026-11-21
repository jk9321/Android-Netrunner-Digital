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

  // Phase 3 Mulligan prompt opens inside MobilePromptSheet with drag-down grip AND Peek <-> Decide toggle
  const promptSheet = page.getByTestId('mobile-prompt-sheet');
  await expect(promptSheet).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(220);
  const grip = page.getByTestId('mobile-prompt-sheet-grip');
  const gripBox = await grip.boundingBox();
  expect(gripBox).not.toBeNull();
  // Drag the grip bar downward to trigger Peek Mode
  await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2 + 90, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('mobile-prompt-sheet-peek')).toBeVisible();
  // Tapping the peek pill restores the sheet
  await page.getByTestId('mobile-prompt-sheet-peek').click();
  await expect(promptSheet).toBeVisible();
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
    const strip = document.querySelector('[data-testid="mobile-corp-servers"]') as HTMLElement | null;
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

test('mobile Corp mirrored board: tall ice stack scrolls cleanly and new off-screen remote lights edge highlight', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-runner').click();
  await page.getByTestId('start-game').click();

  await expect(page.getByTestId('mobile-prompt-sheet')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Keep hand' }).click();
  await expect(page.getByTestId('end-turn')).toBeVisible({ timeout: 30_000 });

  // Seed 8 pieces of ice on HQ plus 1 existing remote (Remote 1) and an installable asset in HQ
  await page.evaluate(() => {
    const key = 'netrunner.savedGame.v1';
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    const corp = saved.state.corp;
    for (const id of Object.keys(corp.servers)) {
      if (corp.servers[id].isRemote) delete corp.servers[id];
    }
    const hqIce = [];
    for (let i = 0; i < 8; i++) {
      const c = corp.rd.pop();
      if (c) {
        Object.assign(c, { cardCode: '30072', isRezzed: true, faceUp: true });
        hqIce.push(c);
      }
    }
    corp.servers.hq.ice = hqIce;
    const r1Card = corp.rd.pop();
    if (r1Card) Object.assign(r1Card, { cardCode: '30070', isRezzed: false, faceUp: false });
    corp.remoteCounter = 1;
    corp.servers['remote-1'] = {
      id: 'remote-1',
      name: 'Remote Server 1',
      isRemote: true,
      ice: [],
      root: r1Card ? [r1Card] : [],
    };
    // Ensure HQ has an installable asset so Corp can create Remote Server 2 off-screen
    if (corp.hq[0]) Object.assign(corp.hq[0], { cardCode: '30070' });
    corp.clicks = 3;
    window.localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.getByTestId('mobile-corp-board')).toBeVisible({ timeout: 30_000 });

  // Tall mirrored ice stack must NOT overflow above scrollTop=0; outermost ice is visible at top and column scrolls cleanly
  const hqScrollInfo = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="mobile-server-scroll-hq"]') as HTMLElement | null;
    const strips = scroller ? Array.from(scroller.querySelectorAll('[data-testid^="mobile-ice-"]')) : [];
    if (!scroller || strips.length === 0) return null;
    const box = scroller.getBoundingClientRect();
    const first = strips[0].getBoundingClientRect();
    const canScroll = scroller.scrollHeight > scroller.clientHeight + 2;
    scroller.scrollTop = scroller.scrollHeight;
    const scrolled = scroller.scrollTop > 0;
    const lastAfterScroll = strips[strips.length - 1].getBoundingClientRect();
    return {
      count: strips.length,
      canScroll,
      scrolled,
      outermostVisibleAtTop: first.top >= box.top - 1,
      innermostVisibleAtBottom: lastAfterScroll.bottom <= box.bottom + 2,
    };
  });
  expect(hqScrollInfo).toEqual({
    count: 8,
    canScroll: true,
    scrolled: true,
    outermostVisibleAtTop: true,
    innermostVisibleAtBottom: true,
  });

  // Creating a new remote off-screen (Remote Server 2 = 5th column on 390px screen) lights the right edge alert bar
  await page.locator('[data-testid="hand-corp"] [data-hand-card]').first().click();
  await page.getByTestId('mobile-play-selected').click();
  await expect(page.getByTestId('mobile-corp-install-sheet')).toBeVisible();
  await page.getByRole('button', { name: /New remote/i }).click();

  await expect(page.getByTestId('server-remote-2')).toBeAttached();
  const rightEdge = page.getByTestId('mobile-corp-servers-edge-end');
  await expect(rightEdge).toBeVisible();
  await expect(rightEdge).toHaveAttribute('data-alert', 'true');

  // Scrolling the server strip right to view Remote 2 clears the right-edge alert and reveals the left-edge passive cue
  await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="mobile-corp-servers"]') as HTMLElement | null;
    if (strip) {
      strip.scrollLeft = strip.scrollWidth;
      strip.dispatchEvent(new Event('scroll'));
    }
  });
  await expect(rightEdge).toHaveCount(0);
  await expect(page.getByTestId('mobile-corp-servers-edge-start')).toBeVisible();

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
