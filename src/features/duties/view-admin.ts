import { schoolGradeLabel } from "@/lib/format/school-grade";
import { DUTY_KIND_KEYS, dutyKindLabel, type DutyItemView, type DutyPeriod } from "./kinds";
import { weekDaysOf } from "./view";

/**
 * 업무 완성도 **관리자 화면**(과목 관리자 · 원장)의 순수 조립 — DB 집계(s2_0049 rollup 3종)를 선생님 × 종류 매트릭스 · 반별 줄 ·
 * 학생별 줄 · '오늘 확인할 것'으로 접는다. 숫자는 장부(duty_items) 그대로 — 강사 홈 '내 업무'와 같은 행을 센다.
 * 과목 관리자는 담당 과목 키만 받는다(서버가 `p_subjects`로 거른다) · 원장은 전 과목 + 과목 칩(여기서 subject 열로 거른다).
 */
/**
 * 한 묶음의 셈(s2_0050) — total·done = 진척(장부 전체) · due = 기한이 온 것 · ontime = 그중 제때 끝낸 것 · lateDone = 늦게 끝낸 것 ·
 * late = **지금 지연**(열린 채 기한 지남 — 아직 손쓸 수 있는 것) · expired = 미이행 확정(일간 7일 뒤) · over7 = 7일 넘게 열린 지연.
 * due = ontime + lateDone + late + expired. 기한 전 의무는 total에만 든다.
 */
export type Counts = { total: number; done: number; due: number; ontime: number; lateDone: number; late: number; expired: number; over7: number };
export type RollupOwnerKind = Counts & { ownerId: string | null; subject: string | null; kind: string; period: DutyPeriod };
export type RollupClass = Counts & { classId: string | null; ownerId: string | null; subject: string | null };
export type RollupStudent = Counts & { studentId: string | null; classId: string | null; kind: string; lastDue: string | null };
export type OwnerInfo = Record<string, string>;
export type ClassInfo = Record<string, { name: string; subject: string | null; teacherId: string | null }>;
export type StudentInfo = Record<string, { name: string; school: string | null; grade: string | null }>;
/** 과목 범위 — null = 전 과목(원장). 배열 = 그 과목 키만(과목 관리자 — 비어 있으면 아무것도 안 보인다). labels = 키 → 학원 설정 라벨(raw 키 노출 금지). */
export type DutyAdminScope = { subjects: string[] | null; labels: Record<string, string>; /** '담당' 권한이면 본인 의무만(null = 전원). */ ownerId: string | null };
/** 열린 채 기한이 지난 의무 한 건. inherited = 평가 시작(live_from) 전 기한 — 집계·판정에 안 들고 '이관된 미확인'으로 따로 묶는다. */
export type LateItem = DutyItemView & { ownerId: string | null; inherited: boolean };
/** syncedAt = 장부를 마지막으로 맞춘 시각(없으면 null) — 화면의 '기준 시각'. */
export type DutyAdminData = { ownerKind: RollupOwnerKind[]; classes: RollupClass[]; late: LateItem[]; owners: OwnerInfo; classInfo: ClassInfo; syncedAt: string | null };

export type AdminPeriod = "today" | "week" | "month" | "prevMonth";
export const ADMIN_PERIODS: { key: AdminPeriod; label: string }[] = [
  { key: "today", label: "오늘" }, { key: "week", label: "이번 주" }, { key: "month", label: "이번 달" }, { key: "prevMonth", label: "지난 달" },
];
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
/** 기간 → 회차 창(KST 날짜). 월간 의무는 달로 맞으므로 '이번 달'은 1일~오늘이면 된다. */
export function adminRange(period: AdminPeriod, today: string): { from: string; to: string; label: string } {
  if (period === "today") return { from: today, to: today, label: md(today) };
  if (period === "week") { const from = weekDaysOf(today)[0]!; return { from, to: today, label: `${md(from)} ~ ${md(today)}` }; }
  if (period === "month") { const from = `${today.slice(0, 7)}-01`; return { from, to: today, label: `${md(from)} ~ ${md(today)}` }; }
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const from = `${py}-${String(pm).padStart(2, "0")}-01`; const to = `${py}-${String(pm).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to, label: `${py}년 ${pm}월` };
}
/** 셀 주기 — 오늘·이번 주는 **일간만**(강사 홈 '오늘 내 업무'와 같은 셈) · 달 단위는 전부(월간·건별 포함). */
export function periodsOf(period: AdminPeriod): string[] | null {
  return period === "today" || period === "week" ? ["daily"] : null;
}
export function parseAdminPeriod(raw: unknown): AdminPeriod {
  return raw === "today" || raw === "week" || raw === "prevMonth" ? raw : "month";
}

/** 매트릭스 열 = 종류 전부(순서 = DUTY_KINDS). 짧은 머리글. */
export const MATRIX_COLUMNS: { kind: string; label: string }[] = [
  { kind: "attendance", label: "출결" }, { kind: "report_write", label: "보고서" }, { kind: "report_send", label: "발송" },
  { kind: "counsel_monthly", label: "월 상담" }, { kind: "exam_monthly", label: "월말평가" }, { kind: "newcomer_call", label: "신규생 정착" },
];
/** pct = **기한 준수율**(기한이 온 것 중 제때 끝낸 비율). 기한이 온 것이 없으면 null(평가 대기). */
export type Cell = Counts & { pct: number | null };
export type CellTone = "none" | "wait" | "good" | "warn" | "bad";
export const ZERO: Counts = { total: 0, done: 0, due: 0, ontime: 0, lateDone: 0, late: 0, expired: 0, over7: 0 };
export const pctOf = (c: Counts): number | null => (c.due ? Math.round((c.ontime / c.due) * 100) : null);
export const EMPTY: Cell = { ...ZERO, pct: null };
export const add = (a: Counts, b: Counts): Counts => ({ total: a.total + b.total, done: a.done + b.done, due: a.due + b.due, ontime: a.ontime + b.ontime,
  lateDone: a.lateDone + b.lateDone, late: a.late + b.late, expired: a.expired + b.expired, over7: a.over7 + b.over7 });
export const cellOf = (c: Counts): Cell => ({ total: c.total, done: c.done, due: c.due, ontime: c.ontime, lateDone: c.lateDone, late: c.late, expired: c.expired, over7: c.over7, pct: pctOf(c) });
/** 기한 전이라 아직 남은 것(예정) — 판정에 안 든다. */
export const upcomingOf = (c: Counts): number => Math.max(c.total - c.done - c.late - c.expired, 0);
/** 기한이 오기 전에 미리 끝낸 것 — 진행에는 들지만 기한이 올 때까지 판정에 안 든다. */
export const earlyDoneOf = (c: Counts): number => Math.max(c.done - c.ontime - c.lateDone, 0);
/** 기한이 온 것이 없을 때 칸에 적는 진행(완료/전체) — '예정 0'처럼 끝낸 일을 안 한 것으로 보이게 하지 않는다(리뷰 2026-11-10). */
export const progressText = (c: Counts): string => `${c.done}/${c.total}`;
/** 표본이 이보다 적으면 등급을 매기지 않는다(1~2건으로 '미흡'을 붙이지 않는다). */
export const MIN_JUDGE = 3;
/** 칸 색 = 판정(`judge`)과 같은 결 — 의무 없음 회색 · 기한 온 것이 3건 미만이면 중립(평가 대기) · 90%+ 초록 · 70~89 주황 · 70 미만 빨강. */
export function cellTone(c: Cell): CellTone {
  if (!c.total) return "none";
  if (c.pct === null || c.due < MIN_JUDGE) return "wait";
  return c.pct >= 90 ? "good" : c.pct >= 70 ? "warn" : "bad";
}
/** 칸 설명(마우스 오버) — 숫자의 뜻을 글로. */
export function cellTitle(c: Counts): string {
  const parts = [c.due ? `기한이 온 ${c.due}건 중 제때 ${c.ontime}건` : "기한이 온 의무 없음"];
  if (c.late) parts.push(`지연 ${c.late}`);
  if (c.lateDone) parts.push(`늦게 끝냄 ${c.lateDone}`);
  if (c.expired) parts.push(`미이행 확정 ${c.expired}`);
  const up = upcomingOf(c); if (up) parts.push(`기한 전 ${up}`);
  const early = earlyDoneOf(c); if (early) parts.push(`미리 끝냄 ${early}`);
  return parts.join(" · ");
}
/** 과목 거르기 — undefined = 전 과목 · null = 과목 없는 것만('과목 미정') · 글자 = 그 과목. */
export type SubjectFilter = string | null | undefined;
const inSubject = (subject: string | null, filter: SubjectFilter) => filter === undefined || subject === filter;

export type MatrixRow = { ownerId: string; name: string; cells: Record<string, Cell>; all: Cell };
/** 보이는 줄의 합(전체 줄) — '지연만'으로 거른 뒤에도 그 줄들의 합이다. */
export function foldMatrixRows(rows: readonly MatrixRow[]): MatrixRow | null {
  if (!rows.length) return null;
  const total: MatrixRow = { ownerId: "", name: "전체", cells: {}, all: EMPTY };
  for (const row of rows) {
    for (const k of DUTY_KIND_KEYS) if (row.cells[k]) total.cells[k] = cellOf(add(total.cells[k] ?? EMPTY, row.cells[k]!));
    total.all = cellOf(add(total.all, row.all));
  }
  return total;
}

export type AttentionRow = { key: string; studentId: string | null; classId: string | null; title: string; sub: string; ownerId: string | null; teacher: string; className: string; count: number; summary: string; days: number; oldest: string; students: number };
/**
 * '지금 지연' = 열린 채 기한이 지난 의무를 **담당자 × 반 × 학생**(반 알림장은 담당자 × 반)으로 묶는다 — 오래된 것 → 건수 많은 것 순.
 * 🔴 학생만으로 묶지 않는다: 한 학생을 수학·영어 두 선생님이 맡으면 한 사람 몫으로 합쳐져 엉뚱한 사람에게 지시하게 된다(리뷰 2026-11-10).
 */
export function buildAttention(items: readonly LateItem[], owners: OwnerInfo, subject: SubjectFilter, nowMs: number): AttentionRow[] {
  const by = new Map<string, AttentionRow & { kinds: Map<string, number> }>();
  for (const it of items) {
    if (!inSubject(it.subject, subject)) continue;
    const key = `${it.ownerId ?? ""}|${it.classId ?? ""}|${it.studentId ?? ""}`;
    const row = by.get(key) ?? { key, studentId: it.studentId, classId: it.classId, title: it.studentName ?? it.className ?? "학생", sub: it.studentId ? schoolGradeLabel(it.school, it.grade) : "반 알림장",
      ownerId: it.ownerId, teacher: it.ownerId ? owners[it.ownerId] ?? "" : "", className: it.className ?? "", count: 0, summary: "", days: 0, oldest: it.dueAt, students: it.studentId ? 1 : 0, kinds: new Map() };
    row.count++; row.kinds.set(it.kind, (row.kinds.get(it.kind) ?? 0) + 1);
    if (it.dueAt < row.oldest) row.oldest = it.dueAt;
    by.set(key, row);
  }
  return [...by.values()].map(({ kinds, ...row }) => ({ ...row, days: lateDays(row.oldest, nowMs), summary: [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${dutyKindLabel(k)} ${n}`).join(" · ") }))
    .sort((a, b) => a.oldest.localeCompare(b.oldest) || b.count - a.count);
}
/** 기한에서 지난 날 수(내림). */
export const lateDays = (dueIso: string, nowMs: number): number => Math.max(Math.floor((nowMs - Date.parse(dueIso)) / 86_400_000), 0);
/** 지연 표식 — 실제 지난 날 수로(단계 값은 '누구에게 전달됐다'는 뜻이 아니다). */
export const lateLabel = (days: number): string => (days >= 7 ? "7일 이상" : days >= 3 ? "3일 이상" : days >= 1 ? `${days}일` : "1일 미만");
/** 서로 다른 학생 수(같은 학생이 여러 줄에 있어도 한 명). */
export const distinctStudents = (items: readonly { studentId: string | null }[]): number => new Set(items.flatMap((i) => (i.studentId ? [i.studentId] : []))).size;

/** 종류별 지금 지연 수 요약("수업보고서 작성 12 · 출결 입력 3") — 지연 칸 아래 한 줄. */
export function lateByKind(rows: readonly RollupOwnerKind[], subject: SubjectFilter): string {
  const m = new Map<string, number>();
  for (const r of rows) if (inSubject(r.subject, subject) && r.late) m.set(r.kind, (m.get(r.kind) ?? 0) + r.late);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${dutyKindLabel(k)} ${n}`).join(" · ");
}
