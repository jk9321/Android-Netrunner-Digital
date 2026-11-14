import { expect, test } from '@playwright/test';

// Starts a game against the computer, plays part of a turn, and checks a reload resumes it
test('play against the computer and resume after a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  // Card art and fonts come from other sites; the test doesn't need them
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('start-game').click();

  // The computer keeps or mulligans its hand, then the Runner decides
  await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });

  // The computer's Corp turn, then four clicks for credits
  const gainCredit = page.getByRole('button', { name: '+1 Credit' });
  await expect(gainCredit).toBeEnabled({ timeout: 60_000 });
  const credits = page.getByTestId('runner-credits');
  const before = Number((await credits.innerText()).match(/\d+/)![0]);
  for (let i = 0; i < 4; i++) await gainCredit.click();
  await expect(credits).toContainText(String(before + 4));
  await expect(page.getByText('Runner Actions (0 Clicks):')).toBeVisible();

  // Large cards grow the board cards, and the choice survives the reload below
  const cardWidth = () => page.locator('.card-fit').first().evaluate(el => el.getBoundingClientRect().width);
  const normalWidth = await cardWidth();
  await page.getByTestId('card-size').getByRole('button', { name: 'Large' }).click();
  // Auto fit glides to the new size, so wait for the transition to land
  await expect.poll(cardWidth).toBeGreaterThan(normalWidth);

  // A reload picks up the same game, mid-turn
  await page.reload();
  await expect(page.getByTestId('runner-credits')).toContainText(String(before + 4));
  await expect(page.getByTestId('card-size').getByRole('button', { name: 'Large' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'End Runner Turn' }).click();
  // The stops toggle switches between auto-skip and full control of paid ability windows
  const toggle = page.getByTestId('stops-toggle');
  await expect(toggle).toHaveAttribute('aria-label', 'Stops: auto');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'Stops: full');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'Stops: none');

  expect(errors).toEqual([]);
});

// The start screen asks how to play first, then shows only what that choice needs (chunk 2c)
test('the start screen shows the settings and decks each way of playing needs', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.goto('/');
  const columns = page.getByTestId('deck-columns');
  await page.getByTestId('mode-computer').click();
  await page.getByTestId('opponent-ai-corp').click();
  await expect(columns.locator('h2')).toHaveText(["COMPUTER'S CORP DECK", 'YOUR RUNNER DECK']);
  await expect(page.getByTestId('difficulty-normal')).toHaveCount(0);
  await expect(page.getByTestId('difficulty-hard')).toHaveCount(0);
  await page.getByTestId('mode-hotseat').click();
  await expect(columns.locator('h2')).toHaveText(['CORP DECK', 'RUNNER DECK']);
  await expect(page.getByTestId('difficulty-normal')).toHaveCount(0);
  await page.getByTestId('mode-online').click();
  await page.getByTestId('online-host').click();
  await page.getByTestId('host-side-runner').click();
  await expect(columns.locator('h2')).toHaveText(['YOUR RUNNER DECK']);
  await expect(page.getByTestId('create-game')).toBeVisible();
  await page.getByTestId('online-join').click();
  await expect(columns.locator('h2')).toHaveCount(0);
  await expect(page.getByTestId('join-code')).toBeVisible();
  // An invite link opens Join with the code filled in (the preview server has no game server: the lookup fails)
  await page.goto('/play/K7QM-2X');
  await expect(page.getByTestId('join-code')).toHaveValue('K7QM-2X');
  await expect(page.getByTestId('online-error')).toBeVisible();
  // Leaving Join puts the address back to /
  await page.getByTestId('mode-computer').click();
  await expect(page).toHaveURL(/\/$/);
});

