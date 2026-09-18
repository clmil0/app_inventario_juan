const { test, expect } = require('@playwright/test');
test('debug console', async ({ page }) => {
  page.on('console', msg => {
    if (msg.type() === 'error')
      console.log('CONSOLE ERROR:', msg.text());
  });
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(2000);
});
