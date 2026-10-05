const LIST_KEYS = ["tab", "flag", "subject_key", "owner_id", "student_id", "q", "page"] as const;

export function makeupListFilter(input: Record<string, unknown>): Record<string, string> {
  const filter: Record<string, string> = {};
  for (const key of LIST_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.length <= 100) filter[key] = value;
  }
  return filter;
}

export function makeupListHref(filter: Record<string, string>, patch: Record<string, string> = {}): string {
  const query = new URLSearchParams(makeupListFilter({ ...filter, ...patch })).toString();
  return query ? `/makeups?${query}` : "/makeups";
}

/** A back value contains filters only; it is never used as a destination URL. */
export function makeupListBack(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000 || /[\r\n]/.test(value)
    || /^[/?#]|^[a-z][a-z0-9+.-]*:/i.test(value)) return "/makeups";
  return makeupListHref(Object.fromEntries(new URLSearchParams(value)));
}

export function makeupCaseHref(id: string, filter: Record<string, string>): string {
  const back = new URLSearchParams(makeupListFilter(filter)).toString();
  return back ? `/makeups/${id}?${new URLSearchParams({ back })}` : `/makeups/${id}`;
}

export function makeupRecordBack(value: unknown): string | null {
  return typeof value === "string" && /^\/makeups\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
