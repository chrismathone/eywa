import { addDays, weekdayIndexOf } from "@/lib/date-kst";

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "2026-09-01" → "9월 1일(월)". 버튼 한 줄에 들어가는 짧은 표기(연도는 오늘·어제라 자명). */
export function shortKoreanDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}월 ${d}일(${DOW_KO[weekdayIndexOf(ymd)]})`;
}

export type EndChoice = {
  key: "today" | "yesterday";
  /** `enrollments.end_date`에 그대로 저장할 값. */
  date: string;
  /** 버튼 제목 — 원장 지시 문구("오늘까지 수업인지, 어제까지 수업인지") 그대로. */
  label: string;
  /** 그래서 언제부터 명단에서 빠지는지 — **날짜를 직접 적는다**([[#121]]). */
  effect: string;
  /**
   * 고를 수 없는 갈래면 그 이유. 수강 시작일보다 앞으로는 종료할 수 없다 —
   * `endEnrollmentById`가 시작일로 **클램프**하므로 그대로 두면 버튼 설명이 거짓말이 된다
   * (오늘 시작한 수강에 "어제까지"를 누르면 실제로는 오늘까지로 저장된다).
   */
  disabledReason?: string;
};

/**
 * '수강 종료' 두 갈래 — 원장 2026-09-01: *"'오늘까지 수업인지, 어제까지 수업인지' 물어볼 것"* +
 * *"오늘까지 클릭하면 말그대로 오늘까지 수강하고 내일자부터 제외, 어제까지 수업이면 오늘부터 수강 제외"*.
 *
 * 🔑 `end_date`는 **포함**(그날까지 수강)이다 — 조회가 전부 `end_date >= 그날`로 판정한다
 *    (`enrollments` 소비처 공통 규약). 그래서 "오늘까지" = `end_date`=오늘이고 제외는 내일부터다.
 * ⚠️ 문구엔 '오늘/어제'만 쓰지 말고 **그 기준이 만들어 낸 실제 날짜**를 함께 적는다([[#121]]) —
 *    밤 11시에 누르는 사람과 새벽에 누르는 사람이 같은 글자를 다르게 읽는다.
 */
export function endChoices(today: string, startDate?: string | null): [EndChoice, EndChoice] {
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const blockedIfBeforeStart = (date: string): string | undefined =>
    startDate && date < startDate
      ? `수강 시작일 ${shortKoreanDate(startDate)} 이전으로는 종료할 수 없습니다`
      : undefined;
  return [
    {
      key: "today",
      date: today,
      label: `오늘까지 수업 · ${shortKoreanDate(today)}`,
      effect: `내일 ${shortKoreanDate(tomorrow)}부터 이 반 명단에서 빠집니다`,
      disabledReason: blockedIfBeforeStart(today),
    },
    {
      key: "yesterday",
      date: yesterday,
      label: `어제까지 수업 · ${shortKoreanDate(yesterday)}`,
      effect: `오늘 ${shortKoreanDate(today)}부터 이 반 명단에서 빠집니다`,
      disabledReason: blockedIfBeforeStart(yesterday),
    },
  ];
}
