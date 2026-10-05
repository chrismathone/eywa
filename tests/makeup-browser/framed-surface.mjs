/** Physical same-origin frame: EmbedUrlKeeper intentionally strips embed from a top-level tab. */
export async function framedSurface(context, path) {
  const surface = await context.newPage();
  const host = "http://127.0.0.1:3045/__makeup_synthetic_frame_host__";
  // Only the empty test host is intercepted; every iframe page/action reaches the real app.
  await surface.route(host, route => route.fulfill({ contentType: "text/html", body:
    `<html><body><iframe title="합성 보강 검증" src="http://127.0.0.1:3045${path}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe></body></html>` }));
  await surface.goto(host, { waitUntil: "domcontentloaded", timeout: 30000 });
  await surface.locator("iframe").waitFor();
  const frame = surface.frames().find(candidate => candidate !== surface.mainFrame());
  if (!frame) throw new Error("Synthetic frame not attached");
  await frame.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await frame.locator("body").waitFor();
  // The journey operates on frame DOM/URL; screenshots, viewport and page errors belong to its surface.
  frame.setViewportSize = surface.setViewportSize.bind(surface);
  frame.screenshot = surface.screenshot.bind(surface);
  frame.keyboard = surface.keyboard;
  frame.reload = () => frame.goto(frame.url(), { waitUntil: "domcontentloaded" });
  return frame;
}
