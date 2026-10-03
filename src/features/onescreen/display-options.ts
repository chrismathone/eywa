export type ReportSort = "class" | "name";
export type DisplayOptions = { sort: ReportSort; hidePrevious: boolean };
export const DEFAULT_DISPLAY_OPTIONS: DisplayOptions = { sort: "class", hidePrevious: false };

export function readDisplayOptions(raw: unknown): DisplayOptions {
  const prefs = raw && typeof raw === "object" ? (raw as Record<string, unknown>).onescreen : null;
  const value = prefs && typeof prefs === "object" ? prefs as Record<string, unknown> : {};
  return { sort: value.sort === "name" ? "name" : "class", hidePrevious: value.hidePrevious === true };
}
