import { kstToday } from "@/lib/date-kst";

/**
 * ClassNote 발송 too_old 가드 — edutrix 2026-05~06 과거보고서 재발송 사고(1~4월 3,500건이 학부모에게 오발송)
 * 대응으로 도입. "전 달 1일 이후" 보고서만 발송 허용. **KST 기준** 순수 문자열(YYYY-MM-DD) 비교라 Vercel UTC
 * 월초/자정 경계 오류 없음. (edutrix utils/classnoteGuard.ts 이식.)
 */

/** 오늘(KST) 기준 발송 허용 최소 날짜 = "전 달 1일"(YYYY-MM-DD). 1월이면 전년 12월 1일. */
export function classnoteMinDate(todayKst: string = kstToday()): string {
  const [y, m] = todayKst.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

/** report_date(YYYY-MM-DD)가 발송 허용 범위인가 — 전 달 1일 이후(문자열 사전순 비교). */
export function isClassnoteAllowed(reportDate: string, todayKst: string = kstToday()): boolean {
  if (!reportDate) return false;
  return reportDate >= classnoteMinDate(todayKst);
}
