import { expect, test } from '@playwright/test';

// The Runner's stats bar must stay centred, not hug the left edge when it wraps under the identity
for (const width of [1920, 1366, 1100]) {
  test(`runner stats bar is centred at ${width}px`, async ({ page }) => {
    await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByTestId('opponent-ai-corp').click();
    await page.getByTestId('difficulty-normal').click();
    await page.getByTestId('start-game').click();
    await page.getByRole('button', { name: 'Keep hand' }).click({ timeout: 30_000 });
    await expect(page.getByTestId('runner-credits')).toBeVisible({ timeout: 60_000 });

    const gaps = await page.getByTestId('runner-stats').evaluate(el => {
      const box = el.getBoundingClientRect();
      const pills = [...el.children].map(c => c.getBoundingClientRect());
      const first = pills.filter(p => Math.abs(p.top - pills[0].top) < 4); // first row of pills
      return { left: Math.min(...first.map(p => p.left)) - box.left, right: box.right - Math.max(...first.map(p => p.right)) };
    });
    expect(Math.abs(gaps.left - gaps.right)).toBeLessThan(4);
  });
}
