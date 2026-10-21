import { WITHDRAW_SUBJECT_SPAN_DAYS } from "@/features/withdrawals/window";
import type { TrendEnrollment, TrendEnrollments, TrendStudent } from "./enrolled-trend";

/*
 * 장부 정리 학생의 청구 판정(원장 2026-10-20 '청구 기록으로 맞추기') — 퇴원일이 장부 날짜라 청구 기록이 있는 달부터는 청구로 센다.
 * 판정 본체는 `enrolled-trend.ts`의 `countedOn`(재원생 추이 한 벌)이 부른다. 순수 함수(Vitest).
 */

/**
 * 장부 정리 학생을 날짜 d에 청구로 세면 그 달 청구가 살아 있는지, 청구로 세지 않는 날이면 null(퇴원일 규칙).
 * 청구로 세는 날 = 청구가 지점을 덮기 시작한 달(`loadCleanupBilling`)부터 **오늘 전**까지 — 오늘 점은 운영실 '재원생' 카드와 같은 퇴원일 규칙이다(오늘 점 = 카드).
 * 퇴원일보다 늦은 달이라도 그달 청구가 살아 있으면 센다(07-03에 수강이 일괄로 끝났지만 7월 수업료를 낸 학생).
 * 청구 재료에 **없는** 학생(재료를 만든 뒤 정리된 학생 — 청구 캐시가 원본보다 한 주기 늦다)은 모른다 → null(퇴원일 규칙).
 */
export function billedOn(s: TrendStudent, en: TrendEnrollments, d: string): boolean | null {
  const b = en.billing;
  if (!b || d >= b.today || d.slice(0, 7) < b.from) return null;
  const months = b.months.get(s.id);
  return months ? months.includes(d.slice(0, 7)) : null;
}

/**
 * 청구가 살아 있는 달 — 청구(`invoices`) 줄에서 수업료만, **취소(void)·환불(refunded)은 뺀다**(원장 2026-10-20 *"청구가 취소된 것이
 * 있을 수도 있으니까 체크"* — 실측 침산 장부 정리 학생의 7월 청구 16건 중 10건 취소 · 1건 환불). 미납·부분 납부는 청구가 살아 있어 센다.
 */
export function billedTuitionMonths(rows: readonly { period: string | null; status: string | null; category: string | null }[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.period || !/^\d{4}-\d{2}$/.test(r.period)) continue;
    if ((r.category ?? "tuition") !== "tuition") continue;
    if (r.status === "void" || r.status === "refunded") continue;
    out.add(r.period);
  }
  return [...out].sort();
}

/**
 * 장부 정리 학생이 청구로 세어진 날 **시작한 수강이 하나도 걸려 있지 않으면**(수강은 끝났는데 그달 청구가 살아 있다) 퇴원 무렵 함께 끝난
 * 수강 — 그날까지 끝난 수강 중 마지막 종료일에서 14일 안(`WITHDRAW_SUBJECT_SPAN_DAYS` · 퇴원관리·KPI의 퇴원 과목 `withdrawalSubjects`와
 * 같은 폭, 적대 리뷰 2026-10-20). 청구로 세어진 날이 아니면 null(종전 판정 그대로) · 끝난 수강이 그날까지 없으면 빈 목록('모름').
 */
function exitWindowRows(s: TrendStudent, rows: readonly TrendEnrollment[], en: TrendEnrollments, d: string): TrendEnrollment[] | null {
  if (s.status !== "withdrawn" || !s.cleanup || billedOn(s, en, d) !== true) return null;
  const ended = rows.filter((e) => !!e.end && e.end.slice(0, 10) <= d);
  const last = ended.reduce<string | null>((m, e) => (!m || e.end! > m ? e.end! : m), null);
  if (!last) return [];
  const floor = new Date(Date.parse(`${last.slice(0, 10)}T00:00:00Z`) - WITHDRAW_SUBJECT_SPAN_DAYS * 86_400_000).toISOString().slice(0, 10);
  return ended.filter((e) => e.end!.slice(0, 10) >= floor);
}

/**
 * 위 수강을 **반으로** 셀 때(강좌수 추이 `course-trend.ts`) — 반이동으로 닫힌 줄은 뺀다(옮겨 갔을 뿐 · 옮겨 간 반이 같은 폭 안에 따로 있다 ·
 * 시간표 X `endedTogether`와 같은 규칙, 적대 리뷰 2026-10-20: X→Y 반이동 뒤 Y로 끝난 학생이 두 강좌로 셌다). 마지막으로 끝난 줄은 그대로.
 */
export function billedExitRows(s: TrendStudent, rows: readonly TrendEnrollment[], en: TrendEnrollments, d: string): TrendEnrollment[] | null {
  const exit = exitWindowRows(s, rows, en, d);
  if (!exit) return null;
  // 반이동이 아닌 줄이 있으면 반이동 줄은 모두 뺀다(종료일이 같아도 두 번 세지 않게) — 전부 반이동이면 마지막 줄 하나만.
  if (exit.some((e) => !e.transferred)) return exit.filter((e) => !e.transferred);
  const last = exit.reduce<TrendEnrollment | null>((m, e) => (!m || e.end! > m.end! ? e : m), null);
  return last ? [last] : [];
}

/**
 * 위 수강의 과목 — '모름'으로 모든 과목에 들거나(`subjectTrendOf`) 과목 선에서 빠지지(`breakdownTrendOf`) 않게(원장 2026-10-20).
 * 퇴원 과목 판정(`withdrawalSubjects`)과 같은 줄을 본다(반이동 줄 포함). 청구로 세어진 날이 아니면 null · 끝난 수강이 없으면 빈 목록.
 */
export function billedExitSubjects(s: TrendStudent, rows: readonly TrendEnrollment[], en: TrendEnrollments, d: string): string[] | null {
  const exit = exitWindowRows(s, rows, en, d);
  return exit && [...new Set(exit.flatMap((e) => (e.subject ? [e.subject] : [])))].sort();
}
