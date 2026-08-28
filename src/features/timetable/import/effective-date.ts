// 시간표 가져오기 **적용일**(effective date) — "이 변경이 며칠부터 유효한가"의 단일 소스.
//
// 배경(원장 2026-08-28): 시트 가져오기는 늘 **누른 그 날**부터 적용됐다(`kstToday()` 하드코딩).
// 그런데 반 배치는 보통 "다음 주 월요일부터" 바뀐다 — 그날 아침에 사람이 직접 눌러야만 날짜가 맞고,
// 하루라도 늦거나 이르면 그 며칠이 통째로 틀린 배치로 남는다(출결·시수가 그 배치를 읽는다).
//
// 하부 구조는 이미 날짜를 받는다: `apply_english_structure(p_payload, p_today)`가 옛 행을
// `valid_to = p_today-1`로 마감하고 새 행을 `valid_from = p_today`로 넣고,
// `move_enrollments_batch(p_moves, p_effective_date)`가 수강을 그 날짜로 갈아탄다. 그래서 이 모듈은
// **사람이 고른 날짜를 검증**해 그 인자로 흘려보내는 얇은 관문이다.
//
// ⚠️ server-only 금지 — 다이얼로그(클라)와 서버 액션이 **같은 규칙**을 써야 한다([[#61]]).
//    클라 검증은 편의고, 진짜 게이트는 서버 액션이 이 함수를 다시 부르는 것이다.

import { mondayOf, shiftDays } from "@/features/timetable/lib/week";

/**
 * 적용일 상한(오늘로부터 일수). 반 배치를 반년 뒤로 예약할 일은 없고, 오타(2027-09-07)가
 * 조용히 통과하면 **그 사이 전부**가 옛 배치로 굳는다 — 되돌리려면 그때 가서 또 가져와야 한다.
 */
export const EFFECTIVE_DATE_MAX_DAYS = 180;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** UTC 파싱(서버 타임존 무관) — week.ts와 같은 규약. */
function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, day ?? 1));
}

/** 실재하는 날짜인가 — `2026-02-31`처럼 형식만 맞는 값을 거른다(Date가 3/3으로 굴러간다). */
function isRealDate(d: string): boolean {
  const dt = parse(d);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

/** "2026-09-07(월)" — 안내 문구용. 요일은 코드 고정 축이라 학원설정 대상이 아니다. */
export function effectiveDateLabel(date: string): string {
  if (!DATE_RE.test(date) || !isRealDate(date)) return date;
  return `${date}(${DOW_KO[parse(date).getUTCDay()]})`;
}

/** 오늘 이후의 **다음 주 월요일**(오늘이 월요일이어도 다음 주). 프리셋 = 배치 변경의 실제 기본값. */
export function nextMondayAfter(today: string): string {
  return shiftDays(mondayOf(today), 7);
}

export type EffectiveDateResult = { date: string } | { error: string };

/**
 * 사람이 고른 적용일을 검증해 확정한다. 빈 값은 **오늘**(종전 동작 그대로 — 기본값이 바뀌지 않는다).
 *
 * 🔴 **과거는 거절한다.** 소급 적용은 `valid_to = 지난날-1`로 이미 지나간 배치를 통째로 다시 쓰는 짓이라,
 *    그 사이에 이미 찍힌 출결·시수가 "존재하지 않는 슬롯"에 매달린다(되돌릴 방법이 없다).
 *    지난 날짜를 고치고 싶으면 가져오기가 아니라 그 반을 직접 수정해야 한다.
 */
export function normalizeEffectiveDate(
  input: string | null | undefined,
  today: string,
): EffectiveDateResult {
  const raw = (input ?? "").trim();
  if (raw === "") return { date: today };
  if (!DATE_RE.test(raw) || !isRealDate(raw)) return { error: "적용일 형식이 올바르지 않습니다(YYYY-MM-DD)" };
  if (raw < today)
    return {
      error: `적용일은 오늘(${today}) 이후로만 지정할 수 있습니다 — 지난 날짜로 소급하면 이미 기록된 출결과 어긋납니다.`,
    };
  const max = shiftDays(today, EFFECTIVE_DATE_MAX_DAYS);
  if (raw > max) return { error: `적용일은 ${max}까지만 지정할 수 있습니다(오늘로부터 ${EFFECTIVE_DATE_MAX_DAYS}일).` };
  return { date: raw };
}

/** 적용일이 오늘인가 — 화면이 "지금 바로"와 "예약"을 다르게 말하기 위한 판정. */
export function isImmediate(date: string, today: string): boolean {
  return date <= today;
}
