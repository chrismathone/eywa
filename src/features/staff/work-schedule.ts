// 주간 근무 일정 — 순수 로직(서버 의존 없음, Vitest 단위테스트 강제).
// 읽기(queries.getStaffWorkSchedule)와 쓰기(account-actions.updateWorkSchedule)가 동일 규칙을 쓰도록 단일 소스.

export const WORK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WorkDay = (typeof WORK_DAYS)[number];

// 요일별 시간대 배열. 각 항목은 "HH:MM-HH:MM" 문자열.
export type WorkSchedule = Partial<Record<WorkDay, string[]>>;

// 형식 + 실제 범위(00-23시·00-59분)를 정규식 하나로 강제(예: "25:99" 거부).
export const WORK_TIME_RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

/** 임의 입력(JSON 파싱 결과 등)을 유효한 요일 키 + 유효 시간대 문자열만 통과시켜 정제. */
export function sanitizeWorkSchedule(raw: unknown): WorkSchedule {
  if (!raw || typeof raw !== "object") return {};
  const out: WorkSchedule = {};
  for (const day of WORK_DAYS) {
    const v = (raw as Record<string, unknown>)[day];
    if (Array.isArray(v)) {
      const ranges = v.filter((x): x is string => typeof x === "string" && WORK_TIME_RANGE.test(x));
      if (ranges.length > 0) out[day] = ranges;
    }
  }
  return out;
}
