import { NEWCOMER_ITEM_LABEL, dutyState, type DutyItemView, type DutyState } from "./kinds";

/**
 * '이번 달' 보기 조립(순수) — 월 학부모 상담(학생마다 한 줄) · 신규생 정착 콜(학생 × 항목).
 * 상태 순서 = 기한 초과 → 아직 → 완료. 상담 줄은 누르면 원생상담 작성(그 학생 선택), 신규생 콜은 신규생 관리 탭.
 */
export type MonthRow = {
  id: string; kind: "counsel_monthly" | "newcomer_call" | string; title: string; sub: string; state: DutyState;
  /** 완료일(KST YYYY-MM-DD) 또는 기한(YYYY-MM-DD). */
  dateLabel: string; href: string; dueAt: string; doneAt: string | null;
};
const RANK: Record<DutyState, number> = { late: 0, open: 1, done: 2, void: 3 };
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

export function monthHref(it: Pick<DutyItemView, "kind" | "studentId">): string {
  if (it.kind === "counsel_monthly") return it.studentId ? `/consultations/new?studentId=${encodeURIComponent(it.studentId)}` : "/consultations/new";
  return "/newcomers";
}

export function buildMonthRows(items: readonly DutyItemView[], now: number): { counsel: MonthRow[]; newcomer: MonthRow[] } {
  const rows = items.map((it): MonthRow => {
    const state = dutyState(it.status, it.dueAt, now);
    // 기한은 '다음 날 0시'로 저장돼 있다 — 사람에게는 그 전날(말일 · 항목 날)로 보인다.
    const dueDay = kstDay(new Date(Date.parse(it.dueAt) - 1).toISOString());
    const dateLabel = state === "done" && it.doneAt ? `${md(kstDay(it.doneAt))} 완료` : state === "late" ? `${md(dueDay)} 기한 지남` : `${md(dueDay)}까지`;
    const base = { id: it.id, kind: it.kind, state, dateLabel, href: monthHref(it), dueAt: it.dueAt, doneAt: it.doneAt };
    if (it.kind === "counsel_monthly") return { ...base, title: it.studentName ?? "학생", sub: [it.className, subjectLabel(it.subject)].filter(Boolean).join(" · ") };
    return { ...base, title: it.studentName ?? "학생", sub: `${NEWCOMER_ITEM_LABEL[it.cycle] ?? it.cycle}${it.subject ? ` · ${subjectLabel(it.subject)}` : ""}` };
  });
  const sort = (a: MonthRow, b: MonthRow) => RANK[a.state] - RANK[b.state] || a.dueAt.localeCompare(b.dueAt) || a.title.localeCompare(b.title, "ko");
  return { counsel: rows.filter((r) => r.kind === "counsel_monthly").sort(sort), newcomer: rows.filter((r) => r.kind === "newcomer_call").sort(sort) };
}

/** 과목 키 → 짧은 이름. 학원 설정 라벨은 서버 컴포넌트 몫이라 여기선 표준 키만 알고, 모르는 키는 안 보인다(raw 키 노출 금지). */
function subjectLabel(key: string | null): string {
  if (!key) return "";
  return ({ math: "수학", english: "영어", korean: "국어", science: "과학" } as Record<string, string>)[key] ?? "";
}

export function foldRows(rows: readonly MonthRow[]): { total: number; done: number; late: number } {
  return { total: rows.length, done: rows.filter((r) => r.state === "done").length, late: rows.filter((r) => r.state === "late").length };
}
