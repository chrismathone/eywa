import { test, expect } from '@playwright/test';

// Keep raw-engine reproductions beside the fixes. Expected failure is NOT feature validation.
for (const raw of [false, true]) {
test(`P0-G01: ${raw ? 'raw baseline' : 'adapter'} name box selects the requested range`, async ({ page }) => {
  await page.goto(raw ? '/?compare=1&native=1' : '/?compare=1'); await page.getByRole('tab', { name: 'Univer', exact: true }).click();
  await page.waitForFunction(() => !!window.univerProbe);
  const box = page.locator('.univer-host [data-u-comp="defined-name"] input');
  // Retry only for readiness: the name box mounts slightly after univerProbe under load. Each attempt keeps the 1.2s check.
  await expect(async () => { await box.fill('A2:C3'); await box.press('Enter'); await expect(box).toHaveValue('A2:C3', { timeout: 1200 }); }).toPass({ timeout: 15_000 });
});
test(`P0-G02: ${raw ? 'raw baseline' : 'adapter'} Ctrl+Home has the Google Sheets PC meaning`, async ({ page }) => {
  test.fail(raw, 'Raw candidate key mapping mismatch; application adapter covers this case.');
  await page.goto(raw ? '/?compare=1&native=1' : '/?compare=1'); await page.getByRole('tab', { name: 'Univer', exact: true }).click();
  await page.waitForFunction(() => !!window.univerProbe);
  await page.evaluate(() => window.univerProbe!.select('C5'));
  await page.locator('.univer-host canvas').last().focus(); await page.keyboard.press('Control+Home');
  await expect(page.locator('.univer-host [data-u-comp="defined-name"] input')).toHaveValue('A1', { timeout: 1200 });
});
}
