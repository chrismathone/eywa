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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(here, "concepts.html")).href);
  for (let number = 1; number <= 6; number++) {
    await page.getByRole("button", { name: new RegExp(`^${number} `) }).click();
    await page.screenshot({ path: join(output, `${number}.png`), fullPage: true });
  }
} finally {
  await browser.close();
}
