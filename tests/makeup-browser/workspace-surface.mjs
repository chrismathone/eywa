import { expect } from "@playwright/test";

/** Mutating journeys use the actual workspace and its iframe bridge. */
export async function workspaceSurface(context, path) {
  const surface = await context.newPage();
  const url = new URL(path, "http://127.0.0.1:3045");
  url.searchParams.delete("embed");
  await surface.goto(url.href, { waitUntil: "domcontentloaded" });
  const coach = surface.getByRole("dialog", { name: "워크스페이스 안내" });
  await expect(coach).toBeVisible({ timeout: 30000 });
  await coach.getByRole("button", { name: "시작하기", exact: true }).click();
  await expect.poll(() => surface.frames().some(frame => {
    try { const current = new URL(frame.url()); return current.pathname === url.pathname && current.searchParams.get("embed") === "1"; }
    catch { return false; }
  }), { timeout: 45000 }).toBe(true);
  const frame = surface.frames().find(candidate => {
    try { const current = new URL(candidate.url()); return current.pathname === url.pathname && current.searchParams.get("embed") === "1"; }
    catch { return false; }
  });
  if (!frame) throw new Error("Workspace route frame missing");
  await frame.waitForLoadState("domcontentloaded", { timeout: 45000 });
  frame.setViewportSize = surface.setViewportSize.bind(surface);
  frame.screenshot = surface.screenshot.bind(surface);
  frame.keyboard = surface.keyboard;
  frame.reload = () => frame.goto(frame.url(), { waitUntil: "domcontentloaded" });
  return frame;
}

/** Read-only embed-width probe, separate from the actual workspace command journey. */
export async function mobileEmbed(context, path, file, framedSurface) {
  const frame = await framedSurface(context, path);
  await frame.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => frame.evaluate(() => innerWidth)).toBe(390);
  if (!(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) throw new Error("390px embed overflows");
  await frame.screenshot({ path: file, fullPage: true });
  await frame.page().close();
}
