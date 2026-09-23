import { chromium } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "previews");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32"
    ? { executablePath: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" }
    : {}),
});
try {
  for (const viewport of [{ width: 1440, height: 900, name: "unified" }, { width: 390, height: 844, name: "unified-mobile" }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(join(here, "index.html")).href);
    await page.screenshot({ path: join(output, `${viewport.name}.png`), fullPage: true });
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (hasOverflow) throw new Error(`${viewport.name}: horizontal page overflow`);
    if (viewport.name === "unified") {
      if (await page.locator(".screen-section").count() !== 6) throw new Error("six sections expected");
      await page.locator('.segmented button[data-type="monthly"]').click();
      if (await page.locator("#record-count").textContent() !== "3개 기록") throw new Error("monthly filter failed");
      await page.locator("#show-missing").uncheck();
      if (await page.locator("#record-count").textContent() !== "2개 기록") throw new Error("missing toggle failed");
      await page.locator("#student-picker").selectOption("lee");
      if (await page.locator("#student-name").textContent() !== "이하은의 성적 흐름") throw new Error("student selection failed");
      await page.locator('.class-row[data-class="b"]').click();
      if (await page.locator("#class-average").textContent() !== "73점") throw new Error("class selection failed");
      await page.locator('.heat[data-cohort^="침산중 2학년"]').click();
      if (await page.locator("#cohort-average").textContent() !== "70점") throw new Error("cohort selection failed");
    }
    if (errors.length) throw new Error(errors.join("\n"));
    await page.close();
  }
} finally {
  await browser.close();
}
