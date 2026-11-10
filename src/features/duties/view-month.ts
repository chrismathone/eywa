import { schoolGradeLabel } from "@/lib/format/school-grade";
import { NEWCOMER_ITEM_LABEL, dutyState, type DutyItemView, type DutyState } from "./kinds";

/**
 * '이번 달' 보기 조립(순수) — 월 학부모 상담(학생마다 한 줄) · 신규생 정착 콜(학생 × 항목).
 * 상태 순서 = 기한 초과 → 아직 → 완료. 상담 줄은 누르면 원생상담 작성(그 학생 선택), 신규생 콜은 신규생 관리 탭.
 */
export type MonthRow = {
  id: string; kind: "counsel_monthly" | "newcomer_call" | string; title: string; sub: string; state: DutyState;
  /** 반별 묶음 이름(원장 2026-11-09 *"항상 반별로 분리할것"*) — 상담은 반 이름, 신규생 콜은 반이 없어 과목. */
  group: string;
  /** 완료일(KST YYYY-MM-DD) 또는 기한(YYYY-MM-DD). */
  dateLabel: string; href: string; dueAt: string; doneAt: string | null;
};
const RANK: Record<DutyState, number> = { late: 0, open: 1, done: 2, void: 3 };
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 상담 줄과 신규생 콜 줄은 **둘 다 원생상담 작성**(그 학생 선택)으로 — 어차피 상담이고, 신규생 콜은 그 화면에서 사람이 "어느 항목인지"를 확정한다(반자동 · 자동 매핑 없음, 결정 로그). */
export function monthHref(it: Pick<DutyItemView, "kind" | "studentId" | "classId">): string {
  if (it.kind === "exam_monthly") return "/grades";
  return it.studentId ? `/consultations/new?studentId=${encodeURIComponent(it.studentId)}` : "/consultations/new";
}

export function buildMonthRows(items: readonly DutyItemView[], now: number): { counsel: MonthRow[]; exam: MonthRow[]; newcomer: MonthRow[] } {
  const rows = items.map((it): MonthRow => {
    const state = dutyState(it.status, it.dueAt, now);
    // 기한은 '다음 날 0시'로 저장돼 있다 — 사람에게는 그 전날(말일 · 항목 날)로 보인다.
    const dueDay = kstDay(new Date(Date.parse(it.dueAt) - 1).toISOString());
    const dateLabel = state === "done" && it.doneAt ? `${md(kstDay(it.doneAt))} 완료` : state === "late" ? `${md(dueDay)} 기한 지남` : `${md(dueDay)}까지`;
    const base = { id: it.id, kind: it.kind, state, dateLabel, href: monthHref(it), dueAt: it.dueAt, doneAt: it.doneAt };
    // 이름 옆엔 **항상 학교학년**(원장 2026-11-10 *"수학이란걸 표시해줄 필요는 없고 이름 옆에 항상 학교학년"*) — 과목은 내 과목이라 적지 않는다.
    const who = schoolGradeLabel(it.school, it.grade);
    if (it.kind === "counsel_monthly" || it.kind === "exam_monthly") return { ...base, group: it.className ?? "반 없음", title: it.studentName ?? "학생", sub: who };
    return { ...base, group: it.subject ? (subjectLabel(it.subject) || "과목") : "과목 미정", title: it.studentName ?? "학생", sub: `${who} · ${NEWCOMER_ITEM_LABEL[it.cycle] ?? it.cycle}` };
  });
  const sort = (a: MonthRow, b: MonthRow) => RANK[a.state] - RANK[b.state] || a.dueAt.localeCompare(b.dueAt) || a.title.localeCompare(b.title, "ko");
  return { counsel: rows.filter((r) => r.kind === "counsel_monthly").sort(sort), exam: rows.filter((r) => r.kind === "exam_monthly").sort(sort), newcomer: rows.filter((r) => r.kind === "newcomer_call").sort(sort) };
}

/** 과목 키 → 짧은 이름. 학원 설정 라벨은 서버 컴포넌트 몫이라 여기선 표준 키만 알고, 모르는 키는 안 보인다(raw 키 노출 금지). */
function subjectLabel(key: string | null): string {
  if (!key) return "";
  return ({ math: "수학", english: "영어", korean: "국어", science: "과학" } as Record<string, string>)[key] ?? "";
}

export function foldRows(rows: readonly MonthRow[]): { total: number; done: number; late: number } {
  return { total: rows.length, done: rows.filter((r) => r.state === "done").length, late: rows.filter((r) => r.state === "late").length };
}

/** 묶음(반·과목)별로 가른 줄 — 늦은 묶음 → 아직 있는 묶음 → 다 한 묶음 순. */
export function groupMonthRows(rows: readonly MonthRow[]): { name: string; rows: MonthRow[]; total: number; done: number; late: number }[] {
  const groups = new Map<string, { name: string; rows: MonthRow[]; total: number; done: number; late: number }>();
  for (const r of rows) {
    const g = groups.get(r.group) ?? { name: r.group, rows: [], total: 0, done: 0, late: 0 };
    g.rows.push(r); g.total++;
    if (r.state === "done") g.done++; else if (r.state === "late") g.late++;
    groups.set(r.group, g);
  }
  return [...groups.values()].sort((a, b) => b.late - a.late || (b.total - b.done) - (a.total - a.done) || a.name.localeCompare(b.name, "ko"));
}
