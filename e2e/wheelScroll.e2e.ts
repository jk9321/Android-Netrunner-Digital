import { expect, test } from '@playwright/test';

// The wheel scrolls a sideways bar sideways, but leaves bars that can also scroll up and down alone
test('mouse wheel scrolls horizontal bars', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, route => route.abort());
  await page.goto('/');
  await page.evaluate(() => {
    const bar = document.createElement('div');
    bar.id = 'wheel-bar';
    bar.style.cssText = 'position:fixed;left:50px;top:50px;width:200px;height:60px;overflow-x:auto;overflow-y:hidden;background:#222;z-index:99999';
    bar.innerHTML = '<div style="width:1000px;height:40px"></div>';
    document.body.appendChild(bar);
  });
  await page.mouse.move(100, 80);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => page.locator('#wheel-bar').evaluate(el => el.scrollLeft)).toBeGreaterThan(50);
  await page.mouse.wheel(0, -120);
  await expect.poll(() => page.locator('#wheel-bar').evaluate(el => el.scrollLeft)).toBeLessThan(50);
});
