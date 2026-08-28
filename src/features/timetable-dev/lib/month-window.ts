/**
 * 시간표(개발중) — "그 달"을 날짜 구간으로 펼치는 **순수** 규칙.
 *
 * 계획의 앵커는 달(`plan_month`)인데 원본(`class_schedules`)의 앵커는 날짜 구간(`valid_from`/`valid_to`)이라,
 * 시드(현재 시간표 복사)는 반드시 이 둘을 만나게 해야 한다. 그 만남의 규칙을 **여기 한 곳**에 두고
 * ① SQL 필터의 경계값과 ② JS 재확인이 같은 함수에서 나오게 한다(둘이 갈리면 경계 하루가 조용히 어긋난다).
 *
 * ⚠️ 판정 규약은 청구(`billing/session-terms`)가 쓰는 것과 **같다**:
 *    `valid_from <= 그달 말일 AND (valid_to is null OR valid_to >= 그달 1일)` = 그 달과 하루라도 겹치면 유효.
 *    🔴 기준일 하나(예: 1일)로 비교하면 달 중간에 시작·종료한 슬롯이 통째로 사라진다(시간표 주간 조회가
 *    같은 이유로 구간 비교를 쓴다 — timetable/server/queries.ts 229줄 주석).
 *
 * 날짜는 전부 'YYYY-MM-DD' 문자열이라 사전식 비교가 곧 시간 비교다(Date 파싱을 끼우지 않는다 — UTC 파싱이
 * KST에서 하루 밀리는 함정을 애초에 만들지 않는다).
 */
import { isPlanMonth } from "../types";

/** 'YYYY-MM' 한 달의 첫날·말일(둘 다 포함). */
export type MonthWindow = { first: string; last: string };

/** 'YYYY-MM' → 그 달의 첫날·말일. 형식이 아니면 null(호출부가 한글 에러로 되돌린다). */
export function planMonthWindow(month: string): MonthWindow | null {
  if (!isPlanMonth(month)) return null;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // m월 0일 = m월의 말일(윤년·30/31일 보정을 직접 하지 않는다). Date.UTC라 시간대 개입 없음.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** 시드가 보는 원본 한 줄의 유효 구간(컬럼명이 아니라 뜻으로 받는다 — 매핑은 호출부 몫). */
export type ScheduleValidity = { validFrom: string | null; validTo: string | null };

/**
 * 이 슬롯이 그 달과 **하루라도 겹치는가**.
 *
 * - `validTo === null` = 아직 끝나지 않음 → 시작일만 보면 된다(미래 달도 계속 유효).
 * - `validFrom > 말일` = 이 달이 끝난 뒤에 시작 → 아직 이 달의 시간표가 아니다.
 * - `validTo < 1일` = 이 달이 시작되기 전에 끝남 → 지난 이력이다.
 * - `validFrom`이 비어 있으면 판정 불가라 **제외**한다(DB에선 NOT NULL이지만, 조회가 컬럼을 빠뜨렸을 때
 *   "전부 유효"로 새는 쪽보다 "안 담긴다"가 눈에 띄고 안전하다).
 */
export function isScheduleLiveInMonth(row: ScheduleValidity, month: string): boolean {
  const w = planMonthWindow(month);
  if (!w) return false;
  if (!row.validFrom) return false;
  if (row.validFrom > w.last) return false;
  if (row.validTo && row.validTo < w.first) return false;
  return true;
}

/** 시드가 보는 반 한 줄의 생존 상태. */
export type ClassLifecycle = { isActive: boolean | null; closedAt: string | null };

/**
 * 그 달의 계획에 이 반을 담아도 되는가 — 폐지(`is_active=false`)·그 달 전에 이미 종강(`closed_at < 1일`)은 뺀다.
 * 🔑 `closed_at`이 달 **안**이면 담는다(그 달 일부는 실제로 수업이 있다 — 본 시간표가 같은 규칙이다).
 * `is_active`가 null이면 살아 있는 것으로 본다(본 시간표 SQL 필터가 `= true`라 null은 애초에 안 오지만,
 * 이 순수 함수만 따로 쓰일 때 "모르면 지우지 않는다" 쪽으로 둔다).
 */
export function isClassSeedableInMonth(cls: ClassLifecycle, month: string): boolean {
  const w = planMonthWindow(month);
  if (!w) return false;
  if (cls.isActive === false) return false;
  if (cls.closedAt && cls.closedAt < w.first) return false;
  return true;
}
