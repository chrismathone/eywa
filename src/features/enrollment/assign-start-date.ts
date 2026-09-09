// 등록상담 → 수업 배정의 **배정일**(= 이때 만들어지는 수강의 `start_date`) 단일 소스.
//
// 배경(원장 2026-09-09): *"등록 상담에서 수업배정하면 배정날짜 지정할 수 있게"*. 그전까지 이 경로는
// `kstToday()` 하드코딩이라 "다음 달부터 다닌다"는 아이도 수강이 **오늘부터** 열렸다 — 그 사이 수업일이
// 전부 출석부·강사 시트에 서고(무기록 = 미작성), 반대로 지난주부터 나온 아이는 그 주가 통째로 없었다.
//
// 🔴 과거 허용 여부는 **반 배정(`createEnrollment`) 규약을 따른다**(= 허용). 시간표 가져오기
//    ([effective-date.ts](src/features/timetable/import/effective-date.ts))가 과거를 거절하는 근거는
//    "소급하면 이미 찍힌 출결이 사라진 슬롯에 매달린다"인데, 여기서 만드는 건 **새 학생의 첫 수강**이라
//    되돌려 깨뜨릴 기록이 애초에 없다. 게다가 같은 학생을 학생 상세 '수업' 탭에서 배정하면 과거가
//    통과하는데 이 화면만 막으면, 같은 일을 두 화면이 다르게 받는 더 나쁜 상태가 된다.
// 🔴 대신 **오타는 조용히 통과시키지 않는다** — `2025-09-09`(연도 오타) 한 번이면 그 학생의 수강이
//    1년치로 열려 출석부·시수·강사 시트가 전부 그 기간을 사실로 읽는다. 그래서 앞뒤로 상한을 둔다
//    (상한의 근거·수치는 시간표 적용일과 같다 — 반년 뒤·반년 전을 지정할 일은 없다).
//
// ⚠️ server-only 금지 — 다이얼로그(클라)와 서버 액션이 **같은 규칙**을 써야 한다([[#61]]).
//    클라 검증은 편의고 진짜 게이트는 서버 액션이 이 함수를 다시 부르는 것이다([[#77]]).

import { addDays, formatKoreanDate } from "@/lib/date-kst";

/** 배정일 상한(오늘로부터 며칠 뒤까지). 시간표 적용일(EFFECTIVE_DATE_MAX_DAYS)과 같은 근거·같은 수치. */
export const ASSIGN_START_MAX_AHEAD_DAYS = 180;
/** 배정일 하한(오늘로부터 며칠 전까지). 소급 등록은 있지만 반년을 넘기면 그건 등록이 아니라 오타다. */
export const ASSIGN_START_MAX_BACK_DAYS = 180;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 실재하는 날짜인가 — `2026-02-31`처럼 형식만 맞는 값을 거른다(Date가 3/3으로 굴러간다). */
function isRealDate(d: string): boolean {
  return DATE_RE.test(d) && addDays(d, 0) === d;
}

export type AssignStartDateResult = { date: string } | { error: string };

/**
 * 사람이 고른 배정일을 검증해 확정한다.
 *
 * 🔑 **빈 값·형식 깨짐은 오늘로 떨어뜨린다** — 배정 자체를 실패시키지 않는다. 이 폼의 목적은 학생을
 *    반에 넣는 것이고, 날짜는 그 옆의 부가 정보다. 종전 동작(항상 오늘)이 곧 이 폴백이라 기본값도 안 바뀐다.
 *    단 **범위를 벗어난 날짜는 에러**다 — 그건 "안 골랐다"가 아니라 "잘못 골랐다"라서, 조용히 오늘로
 *    바꾸면 사람이 적은 날짜와 저장된 날짜가 말없이 갈린다.
 */
export function normalizeAssignStartDate(
  input: string | null | undefined,
  today: string,
): AssignStartDateResult {
  const raw = (input ?? "").trim();
  if (raw === "" || !isRealDate(raw)) return { date: today };
  const min = addDays(today, -ASSIGN_START_MAX_BACK_DAYS);
  const max = addDays(today, ASSIGN_START_MAX_AHEAD_DAYS);
  if (raw < min)
    return {
      error: `배정일은 ${min}부터 지정할 수 있습니다(오늘로부터 ${ASSIGN_START_MAX_BACK_DAYS}일 전까지) — 연도를 잘못 적지 않았는지 확인해 주세요.`,
    };
  if (raw > max)
    return {
      error: `배정일은 ${max}까지만 지정할 수 있습니다(오늘로부터 ${ASSIGN_START_MAX_AHEAD_DAYS}일).`,
    };
  return { date: raw };
}

/**
 * 오늘이 아닌 배정일을 골랐을 때 화면이 **한 줄로** 말할 사실. 오늘이면 null(할 말이 없다).
 *
 * 🔴 "며칠 뒤"처럼 상대 표현으로 적지 않는다 — 기준(오늘)이 화면에 없어서 읽는 사람이 되짚지 못한다
 *    ([[#121]]: 임계값의 이름을 문구로 쓰면 숫자는 맞는데 사실이 틀린다). 실제 날짜를 적는다.
 */
export function assignStartDateNotice(date: string, today: string): string | null {
  if (!isRealDate(date) || date === today) return null;
  if (date > today)
    return `${formatKoreanDate(date)}부터 수업에 배정됩니다 — 그 전까지는 출석부·시간표 명단에 나오지 않습니다.`;
  return `${formatKoreanDate(date)}로 소급 배정됩니다 — 그 사이 수업일이 출석부·강사 시트에 빈 칸으로 잡힙니다.`;
}
