// 수강료 계산 순수 함수 — 차시(세션) 기반 견적. UI·DB 비의존(테스트 강제).
// 등록상담 시 "월 수강료 얼마"를 즉석 산출하는 도구. 날짜는 전부 UTC로 처리해 타임존 시프트 방지.

/** 기간 안에서 지정 요일(0=일~6=토)에 해당하고 공휴일이 아닌 날의 수(=차시). start~end 포함. */
export function countSessions(
  startDate: string, // "YYYY-MM-DD"
  endDate: string,
  weekdays: number[], // [1,3,5] = 월·수·금
  holidays: string[] = [], // "YYYY-MM-DD" 제외일
): number {
  if (!startDate || !endDate || weekdays.length === 0) return 0;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;

  const wd = new Set(weekdays);
  const hol = new Set(holidays);
  let count = 0;
  for (let ts = start; ts <= end; ts += 86_400_000) {
    const d = new Date(ts);
    if (wd.has(d.getUTCDay()) && !hol.has(d.toISOString().slice(0, 10))) count++;
  }
  return count;
}

export type TuitionEstimate = {
  sessions: number;
  gross: number; // 차시 × 회당단가
  discount: number;
  total: number; // gross − discount
};

/** 차시·회당단가·할인 → 견적 금액. 음수·과할인 방어. */
export function estimateTuition(args: {
  sessions: number;
  perSession: number;
  discount?: number;
}): TuitionEstimate {
  const sessions = Math.max(0, Math.floor(args.sessions));
  const perSession = Math.max(0, Math.round(args.perSession));
  const gross = sessions * perSession;
  const discount = Math.max(0, Math.min(Math.round(args.discount ?? 0), gross));
  return { sessions, gross, discount, total: gross - discount };
}

/**
 * 해당 연도의 양력 고정 공휴일(신정·삼일절·어린이날·현충일·광복절·개천절·한글날·성탄절).
 * 음력(설·추석·석가탄신일)·대체공휴일은 매년 달라 제외 — 필요 시 UI에서 수동 추가.
 */
export function fixedHolidaysForYear(year: number): string[] {
  return ["01-01", "03-01", "05-05", "06-06", "08-15", "10-03", "10-09", "12-25"].map(
    (md) => `${year}-${md}`,
  );
}

/**
 * 학원 설정 공휴일(테넌트) + (옵션) 그 해 양력 고정 공휴일을 합쳐 중복 제거.
 * 설정 미지정(tenantHolidays=[]) + includeFixed=true면 기존 fixedHolidaysForYear만 적용 → 동등성.
 */
export function mergeHolidays(
  year: number,
  tenantHolidays: string[],
  includeFixed: boolean,
): string[] {
  const fixed = includeFixed ? fixedHolidaysForYear(year) : [];
  return Array.from(new Set([...fixed, ...tenantHolidays]));
}

/**
 * 청구 기간("YYYY-MM") + 납부 마감일(N일) → 마감일("YYYY-MM-DD"). 그 달 말일로 clamp(2월 31일 방어).
 * 서버(createInvoice)·클라(폼 기본값) 동일 결과 보장 위해 UTC 결정적 계산.
 */
export function resolveDueDate(period: string, dueDay: number): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return "";
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Math.floor(dueDay)), lastDay);
  return `${period}-${String(day).padStart(2, "0")}`;
}
