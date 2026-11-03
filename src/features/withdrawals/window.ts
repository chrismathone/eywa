/**
 * 기간 안 퇴원생 + 퇴원생의 프로그램 — 순수 규칙(Vitest). 운영실 '퇴원생' 카드·팝업과 퇴원관리
 * `range=month`·`program=` 필터가 같은 판정을 쓴다.
 *
 * 🔑 퇴원생 목록의 프로그램 = **마지막으로 끝난 수강 반**의 프로그램.
 *    운영실 퇴원·수업종료 KPI는 과목별 행으로 펼친 뒤 각 과목의 프로그램을 센다.
 * 🔴 '시스템 정리(날짜 미상)'는 기간 판정에서 뺀다 — 퇴원일이 실제 시점이 아니라 장부 날짜라 그 달에
 *    세면 사실이 아니다([system-bulk.ts]와 월별 추이가 이미 쓰는 규칙).
 */
import { monthRange } from "@/lib/date-kst";
import { programOf, type Program, type ProgramSubject } from "@/features/students/enrollment/program";

/**
 * '이번 달' 퇴원 창 — 그 달 1일 ~ **min(말일, 오늘)**(KST, 양끝 포함).
 * 🔴 오늘 이후로 적힌 퇴원(예정)은 아직 퇴원이 아니다 — 운영실 카드·추이 패널·퇴원관리 `range=month`가 이 한 함수를 쓴다.
 * 지난 달이면 말일까지, 미래 달이면 빈 창(from > to)이다.
 */
export function withdrawalMonthWindow(month: string, today: string): { from: string; to: string } {
  const { from, to } = monthRange(month);
  return { from, to: to < today ? to : today };
}

/** 운영실 '퇴원&수업종료' 카드가 지난달에서 이번 달로 넘어가는 날 — 이 날까지는 지난달을 보여 준다. */
export const EXIT_REPORT_SWITCH_DAY = 10;

/**
 * 운영실 '퇴원&수업종료' 카드가 보여 줄 달(YYYY-MM) — 원장 2026-11-03 *"이번달 10일까지는 '이전달 퇴원'을 보여줄것. 이번달 11일 ~ 다음달
 * 10일까지 이번달 퇴원을 보여줄것"*. 1~10일은 지난달(1월이면 지난해 12월), 11일부터는 이번 달. 창은 `withdrawalMonthWindow`(지난달이면 말일까지).
 */
export function exitReportMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (Number(today.slice(8, 10)) > EXIT_REPORT_SWITCH_DAY) return today.slice(0, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** 시간표 칸의 퇴원 표시 창과 퇴원관리 '최근 30일' 필터의 길이 — 한 값(원장 2026-09-28 *"같은 배선을 따야"*). 인원 **숫자**는 이 창이 아니라 `withdrawalMonthWindow`(이번 달)다. */
export const RECENT_EXIT_DAYS = 30;

/**
 * **최근 이탈 창** — 기준일 N일 전 ~ 기준일(KST, 양끝 포함). 🔴 시간표 칸(`getWeeklyScheduleWithStudents`의
 * 퇴원 표시 하한 — 상단 인원 숫자는 2026-09-28 삭제)와 퇴원관리 롤링 기간(최근 30·90일·1년)이 **이 한 함수**를 쓴다 — 따로 적으면 한쪽만 예정일을 세거나
 * 하루 경계가 갈려 같은 학생을 두 화면이 다르게 센다(최다은 10/1 퇴원 예정: 시간표 8 · 퇴원관리 9, 2026-09-28).
 * 🔴 끝은 **기준일**이다 — 오늘 이후로 적힌 퇴원은 아직 퇴원이 아니다(`withdrawalMonthWindow`와 같은 규칙).
 */
export function recentExitWindow(ref: string, days: number = RECENT_EXIT_DAYS): { from: string; to: string } {
  const from = new Date(Date.parse(`${ref}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  return { from, to: ref };
}

export type EndedEnrollment = { id: string; end_date: string | null; start_date?: string | null };

function compareEnded(a: EndedEnrollment, b: EndedEnrollment): number {
  return (
    (a.end_date ?? "").localeCompare(b.end_date ?? "") ||
    (a.start_date ?? "").localeCompare(b.start_date ?? "") ||
    a.id.localeCompare(b.id)
  );
}

/**
 * 마지막으로 끝난 수강 한 줄 — 종료일 늦은 순 → 시작일 늦은 순 → id(결정적 tie-break).
 * ⚠️ DB 정렬(`order end_date desc`)에 기대지 않는다 — 같은 종료일 두 줄의 순서가 조회마다 달라지면
 *    퇴원관리와 운영실이 같은 학생을 다른 프로그램으로 센다.
 */
export function pickLastEnded<T extends EndedEnrollment>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!row.end_date) continue;
    if (!best || compareEnded(row, best) > 0) best = row;
  }
  return best;
}

/** 학생별 마지막 종료 수강. */
export function lastEndedByStudent<T extends EndedEnrollment & { student_id: string }>(
  rows: readonly T[],
): Map<string, T> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.student_id) ?? [];
    list.push(row);
    grouped.set(row.student_id, list);
  }
  const out = new Map<string, T>();
  for (const [studentId, list] of grouped) {
    const last = pickLastEnded(list);
    if (last) out.set(studentId, last);
  }
  return out;
}

/** 이 퇴원이 [from, to](양끝 포함, YYYY-MM-DD) 안인가 — 시스템 정리·날짜 없음은 제외. */
export function inWithdrawalWindow(
  row: { withdrawnAt: string | null; systemBulk: boolean },
  from: string,
  to: string,
): boolean {
  if (row.systemBulk || !row.withdrawnAt) return false;
  const day = row.withdrawnAt.slice(0, 10);
  return day >= from && day <= to;
}

/** 주어진 수강 반의 프로그램(programOf 단일 규칙). */
export function withdrawalProgram(
  row: { lastClassSubject: string | null; lastClassEnglishTrack?: string | null },
  subjects: readonly ProgramSubject[],
): Program | null {
  return programOf({ subject: row.lastClassSubject, englishTrack: row.lastClassEnglishTrack ?? null }, subjects);
}

export type WithdrawalProgramCounts = Record<Program, number> & { other: number; total: number };

/** 퇴원 무렵으로 볼 폭 — 과목마다 마지막 수업일이 며칠씩 어긋나도 같은 퇴원으로 묶는다. */
export const WITHDRAW_SUBJECT_SPAN_DAYS = 14;

/** 퇴원생의 과목 — 마지막 종료일에서 14일 안에 끝난 수강의 과목 전부(중복 제거, 정렬). */
export function withdrawalSubjects(ended: readonly { endDate: string | null; subject: string | null }[]): string[] {
  let last: string | null = null;
  for (const e of ended) if (e.endDate && (!last || e.endDate > last)) last = e.endDate;
  if (!last) return [];
  const floor = spanFloor(last);
  const out = new Set<string>();
  for (const e of ended) if (e.subject && e.endDate && e.endDate.slice(0, 10) >= floor) out.add(e.subject);
  return [...out].sort();
}

function spanFloor(lastEnd: string): string {
  return new Date(Date.parse(`${lastEnd.slice(0, 10)}T00:00:00Z`) - WITHDRAW_SUBJECT_SPAN_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** 이탈 줄의 반 하나 — 시간표 X 겹침이 그때 담임과 '퇴원 0'을 가리는 재료. */
export type EndedClassRef = { enrollmentId: string; classId: string; startDate: string | null; endDate: string | null; isTransferred: boolean };

/**
 * 한 과목에서 마지막 종료와 **함께**(14일 안) 끝난 수강 — 종료 늦은 순(첫째 = `pickLastEnded`).
 * 요일을 나눠 두 반을 다니다 떠나면 두 반 모두 떠난 반이다(한 반만 보면 다른 반 담임이 '퇴원 0'에 선다 — 적대 리뷰 2026-10-14).
 * 반이동으로 닫힌 수강은 뺀다(옮겨 갔을 뿐 그 반을 떠난 이탈이 아니다) — 마지막 줄 자신은 그대로 둔다.
 */
export function endedTogether<T extends EndedEnrollment & { is_transferred?: boolean | null }>(rows: readonly T[]): T[] {
  const last = pickLastEnded(rows);
  if (!last?.end_date) return [];
  const floor = spanFloor(last.end_date);
  return rows
    .filter((r) => r === last || (!!r.end_date && r.end_date.slice(0, 10) >= floor && r.is_transferred !== true))
    .sort((a, b) => compareEnded(b, a));
}

/** 프로그램별 행 수 — 합(eie+injaewon+math+other) = total. */
export function countWithdrawalPrograms(rows: readonly { program: Program | null }[]): WithdrawalProgramCounts {
  const out: WithdrawalProgramCounts = { eie: 0, injaewon: 0, math: 0, other: 0, total: rows.length };
  for (const row of rows) {
    if (row.program) out[row.program] += 1;
    else out.other += 1;
  }
  return out;
}
