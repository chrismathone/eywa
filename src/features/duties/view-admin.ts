import { CONTRIBUTION_TIERS } from "@/features/student-contribution/model/relative-score";
import type { DutyNote } from "./notes";
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
export type DutyAdminScope = { subjects: string[] | null; labels: Record<string, string>; /** '담당' 권한이면 본인 의무만(null = 전원). */ ownerId: string | null; /** 관리 기록(확인 · 사유 · 면제)을 남길 수 있나 — 전체 권한만. 서버 액션이 같은 판정을 한 번 더 한다. */ canNote?: boolean };
/** 열린 채 기한이 지난 의무 한 건. inherited = 평가 시작(live_from) 전 기한 — 집계·판정에 안 들고 '이관된 미확인'으로 따로 묶는다. */
/** note = 가장 최근 관리 기록(확인 · 사유 — s2_0052). 면제한 의무는 지연에서 빠져 여기 오지 않는다. */
export type LateItem = DutyItemView & { ownerId: string | null; inherited: boolean; note?: DutyNote | null };
/** syncedAt = 장부를 마지막으로 맞춘 시각(없으면 null) — 화면의 '기준 시각'. */
export type DutyAdminData = { ownerKind: RollupOwnerKind[]; classes: RollupClass[]; late: LateItem[]; owners: OwnerInfo; classInfo: ClassInfo; syncedAt: string | null; /** 담당 반 수 · 학생 수(없으면 반 수만 트리에서 센다). */ ownerLoad?: OwnerLoadRow[]; /** 관리자 역할(원장 · 관리자)인 담당자 — 맡은 반이 없으면 선생님 목록·등수에서 뺀다. */ managerIds?: string[]; /** 평가 개시 시각(없으면 null) — 고른 기간이 통째로 그 전이면 화면이 '참고 기록'이라고 밝힌다. */ liveFrom?: string | null; /** 볼 수 있는 첫 날(없으면 제한 없음) — 이보다 앞선 기간으로는 가지 않는다. */ viewFrom?: string | null };

/**
 * 기간 열쇠 — `d:YYYY-MM-DD`(하루) · `w:YYYY-MM-DD`(그 주의 월요일) · `m:YYYY-MM`(달). 원장 2026-11-11 *"달력 추가해서 날짜 이동 가능하게"* —
 * 오늘 · 이번 주 · 이번 달 · 지난 달은 빠른 단추일 뿐이고, 어느 날 · 어느 주 · 어느 달이든 볼 수 있다(앞날은 없다).
 */
export type AdminPeriod = string;
export type PeriodUnit = "day" | "week" | "month";
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
const shiftDay = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shiftMonth = (ym: string, n: number) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const lastDayOf = (ym: string) => shiftDay(`${shiftMonth(ym, 1)}-01`, -1);
export const periodKey = (unit: PeriodUnit, anchor: string): AdminPeriod => (unit === "month" ? `m:${anchor.slice(0, 7)}` : unit === "week" ? `w:${weekDaysOf(anchor)[0]}` : `d:${anchor}`);
/** 열쇠 → 단위와 기준일(주 = 월요일 · 달 = 1일). 모양이 아니면 null. */
export function periodParts(period: AdminPeriod): { unit: PeriodUnit; anchor: string } | null {
  const body = period.slice(2);
  if (period.startsWith("d:") && YMD.test(body)) return { unit: "day", anchor: body };
  if (period.startsWith("w:") && YMD.test(body)) return { unit: "week", anchor: weekDaysOf(body)[0]! };
  if (period.startsWith("m:") && /^\d{4}-(0[1-9]|1[0-2])$/.test(body)) return { unit: "month", anchor: `${body}-01` };
  return null;
}
export const periodUnit = (period: AdminPeriod): PeriodUnit => periodParts(period)?.unit ?? "month";
/** 빠른 단추 — 오늘 · 이번 주 · 이번 달 · 지난 달. */
export function periodPresets(today: string): { key: AdminPeriod; label: string }[] {
  return [{ key: periodKey("day", today), label: "오늘" }, { key: periodKey("week", today), label: "이번 주" }, { key: periodKey("month", today), label: "이번 달" }, { key: `m:${shiftMonth(today.slice(0, 7), -1)}`, label: "지난 달" }];
}
/** 주소의 값 → 기간 열쇠(믿지 않는다). 모양이 아니거나 앞날이면 이번 달. 옛 값(today · week · month · prevMonth)도 받는다. */
export function parseAdminPeriod(raw: unknown, today: string): AdminPeriod {
  const legacy: Record<string, number> = { today: 0, week: 1, month: 2, prevMonth: 3 };
  if (typeof raw === "string" && raw in legacy) return periodPresets(today)[legacy[raw]!]!.key;
  const parts = typeof raw === "string" ? periodParts(raw) : null;
  if (!parts || parts.anchor > today) return periodKey("month", today);
  return periodKey(parts.unit, parts.anchor);
}
/** 앞 · 뒤 기간(하루 · 한 주 · 한 달). */
export function shiftPeriod(period: AdminPeriod, dir: -1 | 1): AdminPeriod {
  const parts = periodParts(period);
  if (!parts) return period;
  return parts.unit === "month" ? `m:${shiftMonth(parts.anchor.slice(0, 7), dir)}` : periodKey(parts.unit, shiftDay(parts.anchor, parts.unit === "week" ? dir * 7 : dir));
}
/** 기간 → 회차 창(KST 날짜)과 화면에 적을 이름. 끝은 오늘을 넘지 않는다(이번 주 · 이번 달은 오늘까지). */
export function adminRange(period: AdminPeriod, today: string, viewFrom: string | null = null): { from: string; to: string; label: string } {
  const parts = periodParts(period) ?? { unit: "month" as const, anchor: `${today.slice(0, 7)}-01` };
  const cap = (ymd: string) => (ymd > today ? today : ymd);
  if (parts.unit === "day") return { from: parts.anchor, to: parts.anchor, label: md(parts.anchor) };
  // 볼 수 있는 첫 날이 그 주 안에 있으면 이름도 그날부터 적는다(세는 범위와 같게).
  if (parts.unit === "week") { const to = cap(shiftDay(parts.anchor, 6)); const from = viewFrom && parts.anchor < viewFrom && viewFrom <= to ? viewFrom : parts.anchor; return { from: parts.anchor, to, label: `${md(from)} ~ ${md(to)}` }; }
  const ym = parts.anchor.slice(0, 7);
  return { from: parts.anchor, to: cap(lastDayOf(ym)), label: `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월` };
}
/** 셀 주기 — 하루 · 한 주는 **일간만**(강사 홈 '오늘 내 업무'와 같은 셈) · 달 단위는 전부(월간·건별 포함). */
export function periodsOf(period: AdminPeriod): string[] | null {
  return periodUnit(period) === "month" ? null : ["daily"];
}

/** 결석으로 의무에서 빠진 것(학생 × 반 × 종류의 건수) — 칸이 비었을 때 '—' 대신 '결석'이라고 적는다(왜 없는지 보이게 · 집계에는 안 든다). */
export type AbsentRow = { studentId: string; classId: string | null; kind: string; count: number };

/** 매트릭스 열 = 종류 전부(순서 = DUTY_KINDS). 짧은 머리글. */
export const MATRIX_COLUMNS: { kind: string; label: string }[] = [
  { kind: "attendance", label: "출결" }, { kind: "report_send", label: "보고서 발송" }, { kind: "report_write", label: "보고서 작성" },
  { kind: "counsel_monthly", label: "학생 상담" }, { kind: "exam_monthly", label: "월말평가" }, { kind: "newcomer_call", label: "신규생 관리" },
];
/** pct = **기한 준수율**(기한이 온 것 중 제때 끝낸 비율). 기한이 온 것이 없으면 null(평가 대기). */
export type Cell = Counts & { pct: number | null };
export type CellTone = "none" | "wait" | "good" | "warn" | "bad";
export const ZERO: Counts = { total: 0, done: 0, due: 0, ontime: 0, lateDone: 0, late: 0, expired: 0, over7: 0 };
export const pctOf = (c: Counts): number | null => (c.due ? Math.round((c.ontime / c.due) * 100) : null);
/** 반올림 전 기한 준수율 — **등급 · 등수는 이 값으로** 매긴다(95.5%가 96으로 올라가 1등급이 되거나 99.7%가 100%와 공동 1위가 되지 않게). 화면에 적는 %만 반올림한다. */
export const exactPct = (c: Counts): number | null => (c.due ? (c.ontime / c.due) * 100 : null);
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
/** 표본이 이보다 적으면 등급을 매기지 않는다(1~2건으로 낮은 등급을 붙이지 않는다). */
export const MIN_JUDGE = 3;
/**
 * 등급 = **로열티와 같은 9등급**(원장 2026-11-10 *"미흡 양호 주의 3단계로 하지말고, % 기준으로 로열티와 동일한 등급제로 … 전체%를 기준으로"*).
 * 경계는 로열티의 누적 비율(4 · 11 · 23 · 40 · 60 · 77 · 89 · 96 · 100)을 그대로 쓴다 — 기한 준수율이 100%에서 모자란 폭으로 가른다:
 * 96%+ 1등급 · 89%+ 2등급 · 77%+ 3등급 · 60%+ 4등급 · 40%+ 5등급 · 23%+ 6등급 · 11%+ 7등급 · 4%+ 8등급 · 그 밑 9등급. 상대 순위가 아니라 그 사람의 % 하나로 정한다.
 */
export type DutyTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export function dutyTier(pct: number): DutyTier {
  const i = CONTRIBUTION_TIERS.findIndex((t) => 100 - pct <= t.ceiling);
  return ((i < 0 ? CONTRIBUTION_TIERS.length - 1 : i) + 1) as DutyTier;
}
/** 등급의 색 묶음 — 1~2등급 초록 · 3~4등급 주황 · 5등급 이하 빨강(칸 색 · 점 · 배지가 같은 묶음). */
export const tierTone = (tier: DutyTier): "good" | "warn" | "bad" => (tier <= 2 ? "good" : tier <= 4 ? "warn" : "bad");
/** 칸 색 = 판정(`judge`)과 같은 결 — 의무 없음 회색 · 기한 온 것이 3건 미만이면 중립(평가 대기) · 그 밖은 등급의 색 묶음. */
export function cellTone(c: Cell): CellTone {
  if (!c.total) return "none";
  if (c.pct === null || c.due < MIN_JUDGE) return "wait";
  return tierTone(dutyTier(exactPct(c) ?? c.pct));
}
/**
 * 칸 표시(원장 2026-11-11 *"남음이 있는데 100%는 말도 안됨"* · *"전체는 %로"* · *"완료된 건은 초록색으로, 미흡이 하나라도 있는건은 붉은색으로"*):
 *   · 잘 끝낸 것 = 기한 안에 끝낸 것(기한 전에 미리 끝낸 것 포함). 늦게 끝낸 것 · 아직 안 한 것 · 미이행은 모자란 것이다.
 *   · '전체' 칸의 % = 잘 끝낸 것 ÷ **전체**(남은 것도 분모에 든다 — 남은 것이 있으면 100%가 아니다).
 *   · 색은 둘 — 전부 잘 끝냈으면 초록, 하나라도 모자라면 빨강.
 * 등급(`judge`)은 종전대로 기한이 온 것만으로 매긴다(아직 기한이 안 온 일로 등급을 깎지 않는다).
 */
export const wellDoneOf = (c: Counts): number => c.ontime + earlyDoneOf(c);
export const overallPct = (c: Counts): number | null => (c.total ? Math.floor((wellDoneOf(c) / c.total) * 100) : null);
export const allWellDone = (c: Counts): boolean => c.total > 0 && wellDoneOf(c) === c.total;

/** 칸 설명(마우스 오버) — 숫자의 뜻을 글로. */
export function cellTitle(c: Counts): string {
  const parts = [c.due ? `기한 지난 업무 ${c.due}건 중 기한 내 완료 ${c.ontime}건` : "기한 지난 업무 없음"];
  if (c.late) parts.push(`기한 초과 ${c.late}`);
  if (c.lateDone) parts.push(`기한 후 완료 ${c.lateDone}`);
  if (c.expired) parts.push(`미처리 확정 ${c.expired}`);
  const up = upcomingOf(c); if (up) parts.push(`남음 ${up}`);
  const early = earlyDoneOf(c); if (early) parts.push(`미리 완료 ${early}`);
  return parts.join(" · ");
}
/** 과목 거르기 — undefined = 전 과목 · null = 과목 없는 것만('과목 미정') · 글자 = 그 과목. */
export type SubjectFilter = string | null | undefined;
const inSubject = (subject: string | null, filter: SubjectFilter) => filter === undefined || subject === filter;

export type MatrixRow = { ownerId: string; name: string; /** 이름 옆 글(과목 · 반 수 · 학생 수). */ meta?: string; cells: Record<string, Cell>; all: Cell };
/** 담당자 × 과목의 담당 반 수 · 학생 수(s2_0053 — 고른 기간의 장부에서 겹침 없이). */
export type OwnerLoadRow = { ownerId: string | null; subject: string | null; classes: number; students: number };
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
