import { DEFAULT_STUDENT_FILTERS, studentFilters, type StudentFilters } from "./student-filters";
import { changePeriod, type ChangePeriod } from "./list-controls";

export type ContributionListState = StudentFilters & { sort: "total" | "recent"; direction: "asc" | "desc"; period: ChangePeriod; page: number; pageSize: number };
export const DEFAULT_LIST_STATE: ContributionListState = { ...DEFAULT_STUDENT_FILTERS, sort: "total", direction: "desc", period: 12, page: 1, pageSize: 10 };

export function readListState(query: string): ContributionListState {
  const params = new URLSearchParams(query), page = Number(params.get("page"));
  return { ...studentFilters(Object.fromEntries(params)), search: (params.get("q") ?? "").slice(0, 100),
    sort: params.get("sort") === "recent" ? "recent" : "total",
    direction: params.get("direction") === "asc" ? "asc" : "desc", period: changePeriod(params.get("period")),
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
    pageSize: [10, 20, 50].includes(Number(params.get("size"))) ? Number(params.get("size")) : 10 };
}

/** Only list controls are carried back; arbitrary URLs and unrelated query parameters are excluded. */
export function listStateQuery(state: ContributionListState) {
  const params = new URLSearchParams();
  if (state.search) params.set("q", state.search.slice(0, 100));
  if (state.status !== "enrolled") params.set("status", state.status);
  if (state.grade) params.set("grade", state.grade);
  if (state.subject) params.set("subject", state.subject);
  if (state.sort !== "total") params.set("sort", state.sort);
  if (state.direction === "asc") params.set("direction", state.direction);
  if (state.period !== 12) params.set("period", String(state.period));
  if (state.page > 1) params.set("page", String(state.page));
  if (state.pageSize !== 10) params.set("size", String(state.pageSize));
  return params.toString();
}

export function contributionListHref(query: string | null) {
  const safe = listStateQuery(readListState(query ?? ""));
  return `/student-contribution${safe ? `?${safe}` : ""}`;
}

export function contributionStudentHref(id: string, state: ContributionListState) {
  const query = listStateQuery(state);
  return `/student-contribution/${encodeURIComponent(id)}${query ? `?list=${encodeURIComponent(query)}` : ""}`;
}
