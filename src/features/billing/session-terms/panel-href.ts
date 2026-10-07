/** Both panels belong to the sessions face; preserve window/language context, reset panel-specific filters. */
export function sessionPanelHref(params: Record<string, string | undefined>, period: string, panel: "confirm" | "verify"): string {
  const qs = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
  qs.set("tab", "sessions");
  qs.set("period", period);
  qs.delete("page");
  qs.delete("status");
  qs.delete("only");
  qs.delete("allocation");
  qs.delete("confirmation");
  if (panel === "verify") qs.set("panel", "verify"); else qs.delete("panel");
  return `/billing?${qs}`;
}

export function legacyVerificationHref(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
  qs.set("tab", "sessions");
  qs.set("panel", "verify");
  return `/billing?${qs}`;
}
