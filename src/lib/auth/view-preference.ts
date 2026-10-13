/** Shared with the recovery route, which must not depend on permission or database queries. */
export const VIEW_MODE_COOKIE = "eywa-view";
export const VIEW_AS_COOKIE = "eywa-view-as";
export const VIEW_RESET_PATH = "/view-reset";

/** A denied home cannot be its own redirect destination. Clear the view before trying the actor's home. */
export function accessFallbackPath(pathname: string, home: string): string {
  const path = (value: string) => value.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return path(pathname) === path(home) ? VIEW_RESET_PATH : home;
}
