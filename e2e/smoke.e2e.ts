import { expect, test } from '@playwright/test';

// Starts a game against the computer, plays part of a turn, and checks a reload resumes it
test('play against the computer and resume after a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  // Card art and fonts come from other sites; the test doesn't need them
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());

  await page.goto('/');
  await page.getByTestId('opponent-ai-corp').click();
  await page.getByTestId('difficulty-normal').click();
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

  // A reload picks up the same game, mid-turn
  await page.reload();
  await expect(page.getByTestId('runner-credits')).toContainText(String(before + 4));
  await page.getByRole('button', { name: 'End Runner Turn' }).click();
  await expect(page.getByTestId('ai-status')).toBeVisible();

  expect(errors).toEqual([]);
});
