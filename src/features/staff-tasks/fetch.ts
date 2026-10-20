import type { StaffTaskEvent, StaffTaskFilter, StaffTaskItem, StaffTaskList } from "./kinds";

/** 할 일 창이 부르는 GET 라우트(클라 전용 · 누를 때만). 실패는 한글 문구를 담아 throw. */
export type TaskScope = { scope: "mine" } | { scope: "all"; assigneeId?: string | null };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "할 일을 불러오지 못했습니다");
  return body;
}

export function fetchTaskList(scope: TaskScope, filter: StaffTaskFilter, page: number): Promise<StaffTaskList> {
  const qs = new URLSearchParams({ scope: scope.scope, filter, page: String(page) });
  if (scope.scope === "all" && scope.assigneeId) qs.set("assignee", scope.assigneeId);
  return getJson<StaffTaskList>(`/api/staff-tasks?${qs.toString()}`);
}

export function fetchTaskDetail(id: string): Promise<{ item: StaffTaskItem; events: StaffTaskEvent[] }> {
  return getJson(`/api/staff-tasks/${encodeURIComponent(id)}`);
}
