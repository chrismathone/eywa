/**
 * 등록상담 목록 URL 조립 — 서버(KanbanFilters)와 클라(MonthPicker)가 **같은 함수**를 쓴다.
 * ⚠️ 일반 모듈이어야 한다: "use client" 모듈의 상수를 서버가 import하면 런타임 undefined가 되고
 * 타입체크는 통과해 침묵 버그가 된다(gotcha #81).
 */
export type EnrollmentQuery = {
  month: string | null;
  consultant: string | null;
  outcome: string | null;
  q: string | null;
  view: "kanban" | "table";
};

export function buildEnrollmentQuery(p: EnrollmentQuery): string {
  const params = new URLSearchParams();
  if (p.month) params.set("month", p.month);
  if (p.consultant) params.set("consultant", p.consultant);
  if (p.outcome) params.set("outcome", p.outcome);
  if (p.q) params.set("q", p.q);
  if (p.view === "table") params.set("view", "table");
  // 🔴 page는 일부러 안 넣는다 — 월·필터를 바꾸면 1페이지로 돌아가야 한다(페이지네이션 표준).
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function enrollmentHref(p: EnrollmentQuery): string {
  return `/enrollment${buildEnrollmentQuery(p)}`;
}

export function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${y}년 ${Number(m)}월`;
}

export function shiftMonth(key: string | null, delta: number, todayKey: string): string {
  const base = key ?? todayKey;
  const y = Number(base.slice(0, 4));
  const m = Number(base.slice(5, 7)) - 1 + delta;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}`;
}
