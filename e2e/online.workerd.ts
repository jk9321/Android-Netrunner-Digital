import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Two people, two browsers, one game on the real Workers runtime
 * (e2e/online.config.ts): the host creates a game, the guest joins by the
 * invite link, both keep their hands, each plays a turn, the Runner reloads
 * mid-turn and comes back to the same game, opens it in a second tab and
 * leaves the first, the host reloads, and the Corp concedes; then both see
 * the whole final table, the other's hand face up (chunk 2d).
 */

const offline = (page: Page) => page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());

/** Passes any paid-ability window the page is stopped at (the stops are AUTO). */
async function passWindows(page: Page) {
  for (let i = 0; i < 6; i++) {
    const pass = page.locator('[data-testid^="window-bar-"]').getByRole('button', { name: /^Pass/ });
    if (!(await pass.isVisible().catch(() => false))) return;
    await pass.click();
    await page.waitForTimeout(300);
  }
}

/** Discards down to hand size (the prompt is certain here: the side played no cards). */
async function discardDown(page: Page) {
  const discard = page.getByRole('button', { name: 'Discard selected' });
  await discard.waitFor({ timeout: 30_000 });
  const panel = page.getByTestId('prompt-panel');
  const cards = panel.locator('.overflow-x-auto > *');
  const need = Number((await panel.getByText(/Selected \d+ \/ \d+/).innerText()).match(/\/ (\d+)/)![1]);
  for (let i = 0; i < need; i++) await cards.nth(i).click();
  await discard.click();
}

test('host, join by link, a turn each, reload, concede', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  await hostCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const errors: string[] = [];
  for (const p of [host, guest]) {
    p.on('pageerror', err => errors.push(err.message));
    await offline(p);
  }

  // The host: Play online, Host a game, Corp, Casual (the starter decks), Create game
  await host.goto('/');
  await host.getByTestId('mode-online').click();
  await host.getByTestId('online-host').click();
  await host.getByTestId('host-side-corp').click();
  await host.getByTestId('host-format-casual').click();
  await host.getByTestId('create-game').click();
  await expect(host.getByTestId('waiting-room')).toBeVisible();
  await expect(host.getByTestId('waiting-for-opponent')).toContainText('Waiting for opponent');
  const link = await host.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/\/play\/[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}$/);
  // The token stays out of the address bar and the link
  expect(host.url()).not.toContain('token');

  // The guest opens the link: Join, with the game looked up
  await guest.goto(link);
  await expect(guest.getByTestId('lobby-info')).toBeVisible();
  await expect(guest.getByTestId('lobby-your-side')).toHaveText('Runner');
  await expect(guest.getByTestId('lobby-format')).toHaveText('Casual');
  await guest.getByTestId('join-game').click();

  // The game starts by itself on both screens; the address is back to /
  for (const p of [host, guest]) await expect(p.getByTestId('online-code')).toBeVisible({ timeout: 30_000 });
  await expect(guest).toHaveURL(/127\.0\.0\.1:8787\/$/);
  await host.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
  await guest.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });

  // The Corp's turn: three credits, end the turn
  const corpCredit = host.getByRole('button', { name: '+1 Credit' });
  for (let i = 0; i < 3; i++) {
    await expect(corpCredit).toBeEnabled({ timeout: 30_000 });
    await corpCredit.click();
  }
  await host.getByRole('button', { name: 'End Corp Turn' }).click();
  await discardDown(host);
  await passWindows(host);

  // The Runner's turn: two credits, reload, two more
  const runnerCredit = guest.getByRole('button', { name: '+1 Credit' });
  await expect(runnerCredit).toBeEnabled({ timeout: 30_000 });
  const credits = guest.getByTestId('runner-credits');
  const before = Number((await credits.innerText()).match(/\d+/)![0]);
  await runnerCredit.click();
  await expect(credits).toContainText(String(before + 1));
  await runnerCredit.click();
  await expect(credits).toContainText(String(before + 2));
  await guest.reload();
  await expect(guest.getByTestId('online-code')).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByTestId('runner-credits')).toContainText(String(before + 2));
  // The opponent saw the Runner leave and come back
  await expect(host.getByTestId('opponent-away')).toHaveCount(0, { timeout: 30_000 });
  for (let i = 0; i < 2; i++) {
    await expect(guest.getByRole('button', { name: '+1 Credit' })).toBeEnabled({ timeout: 30_000 });
    await guest.getByRole('button', { name: '+1 Credit' }).click();
  }
  await expect(guest.getByTestId('runner-credits')).toContainText(String(before + 4));
  await guest.getByRole('button', { name: 'End Runner Turn' }).click();
  // The Corp sees the Runner's credits
  await expect(host.getByTestId('runner-credits')).toContainText(String(before + 4), { timeout: 30_000 });

  // The Runner opens the game in a second tab: the first says so; leaving it keeps the seat for the second tab
  const guest2 = await guestCtx.newPage();
  guest2.on('pageerror', err => errors.push(err.message));
  await offline(guest2);
  await guest2.goto('/');
  await expect(guest2.getByTestId('online-code')).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByTestId('online-replaced')).toBeVisible({ timeout: 30_000 });
  await guest.getByTestId('back-to-start').click();
  await expect(guest.getByTestId('mode-online')).toBeVisible();
  await guest2.reload();
  await expect(guest2.getByTestId('online-code')).toBeVisible({ timeout: 30_000 });
  await expect(guest2.getByTestId('runner-credits')).toContainText(String(before + 4));
  // A reload mid-game connects without showing the host's invite
  await host.reload();
  await expect(host.getByTestId('online-code')).toBeVisible({ timeout: 30_000 });
  await expect(host.getByTestId('waiting-room')).toHaveCount(0);

  // Before the end each player sees the other's hand as card backs only
  const backs = (page: Page, side: 'corp' | 'runner') => page.getByTestId(`hand-${side}`).locator('img[alt="Card back"]');
  const handCards = (page: Page, side: 'corp' | 'runner') => page.getByTestId(`hand-${side}`).locator('[data-hand-card]');
  const grip = await handCards(host, 'runner').count();
  const hq = await handCards(guest2, 'corp').count();
  expect(grip).toBeGreaterThan(0);
  expect(hq).toBeGreaterThan(0);
  await expect(backs(host, 'runner')).toHaveCount(grip);
  await expect(backs(guest2, 'corp')).toHaveCount(hq);

  // The Corp concedes (with a confirm); both see the result
  await host.getByTestId('forfeit').click();
  await host.getByTestId('dialog-confirm').click();
  await expect(host.getByTestId('game-over')).toContainText('YOU LOSE', { timeout: 30_000 });
  await expect(guest2.getByTestId('game-over')).toContainText('YOU WIN', { timeout: 30_000 });
  // The final table (chunk 2d, rule 1.7.1): each player now sees the other's hand face up
  await expect(handCards(host, 'runner')).toHaveCount(grip, { timeout: 30_000 });
  await expect(backs(host, 'runner')).toHaveCount(0, { timeout: 30_000 });
  await expect(handCards(guest2, 'corp')).toHaveCount(hq, { timeout: 30_000 });
  await expect(backs(guest2, 'corp')).toHaveCount(0, { timeout: 30_000 });
  // The session is gone: a reload lands on the start screen
  await guest2.reload();
  await expect(guest2.getByTestId('mode-online')).toBeVisible();

  expect(errors).toEqual([]);
  await hostCtx.close();
  await guestCtx.close();
});
