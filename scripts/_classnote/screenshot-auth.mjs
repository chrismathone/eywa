/** The internal credential is sent only to the report's own origin, never to image/CDN
 * requests or a redirect destination. route.fetch(maxRedirects:0) avoids Playwright's
 * header overrides following an HTTP redirect to a different origin. */
export async function protectScreenshotHeaders(context,base,secret){
  if(!secret)return;
  const origin=new URL(base).origin;
  await context.route("**/*",async route=>{
    const request=route.request(),headers={...request.headers()};delete headers["x-eywa-internal"];
    const url=new URL(request.url());
    if(request.isNavigationRequest()&&url.origin===origin&&url.pathname.startsWith("/r/")){
      const response=await route.fetch({headers:{...headers,"x-eywa-internal":secret},maxRedirects:0});
      await route.fulfill({response});
    }else await route.continue({headers});
  });
}
