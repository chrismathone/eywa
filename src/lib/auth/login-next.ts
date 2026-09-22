/**
 * Accept only local destinations. A leading slash alone also accepts //host
 * and /\\host, which browsers interpret as external navigation.
 */
export function safeLoginNext(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://aywa.invalid");
    if (url.origin !== "https://aywa.invalid") return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("//") || /[\\\\\u0000-\u0020\u007f]/.test(pathname)) return null;
    // Avoid returning to login, including normalized /x/../login paths.
    if (/^\/login(?:\/|$)/i.test(pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
