/**
 * 강사 시트(ECS·MCS)가 공유하는 **휴일 규약** — 순수(Vitest). 두 시트가 같은 날을 같게 읽는 유일한 자리다.
 *
 * 🔴 **판정 자료는 학원설정 `operations.holidays` 하나뿐**이다([`buildHolidayMap`](@/features/attendance/calendar)).
 *    [`features/calendar/holidays.ts`](@/features/calendar/holidays)의 내장 법정공휴일 표는 **캘린더 탭 전용**이라
 *    쓰지 않는다 — 법정공휴일 ≠ 학원 휴원일이고, 이 학원은 실제로 공휴일에 수업한다(실측 2026-08-17
 *    대체공휴일에 출결 21행). 내장 표로 판정하면 그날 기록이 화면에서 조용히 사라진다.
 * 🔴 **화면 파일에서 날짜를 직접 비교하지 말 것.** 두 벌이 되면 같은 날이 화면마다 다르게 읽힌다.
 *
 * 🔴 **휴일은 칸을 없애지도 잠그지도 않는다**(원장 2026-09-01: *"대신 입력은 가능하도록 해줘 출석부처럼"*).
 *    월별 출석부가 이미 그렇다 — 헤더가 회색·빨강이고 셀이 muted지만 **입력은 그대로** 된다. 여기서 칸을
 *    막으면 그날 실제로 한 수업(위 21행)을 기록할 곳이 없어진다.
 *
 * 🔴 **작성률 규약은 새로 짓지 않았다** — [`report-admin/writing-rate.ts`](@/features/report-admin/writing-rate)의
 *    휴일 분기(원장 2026-07-22 결정)를 그대로 옮긴 것이다:
 *      · 안 쓴 휴일 = **대상 0**(분모에 안 들어간다 — 휴일엔 의무가 없다)
 *      · 쓴 휴일   = **대상 = 작성**(100% — 감점되지 않고 **한 일로 인정**된다)
 *    즉 휴일 칸은 작성률을 **깎을 수도, 부풀릴 수도 없다**. 부득이하게 수업하고 적은 사람만 이득을 본다.
 */
/** `buildHolidayMap`의 결과 — `YYYY-MM-DD` → 공휴일명(이름이 비면 "휴일"). */
export type HolidayMap = Record<string, string>;

/** 그 날짜의 공휴일명(아니면 null). 맵이 없으면(조회 실패·미설정) 언제나 null = 평일 취급. */
export function holidayNameOn(holidays: HolidayMap | null | undefined, date: string): string | null {
  return holidays?.[date] ?? null;
}

/** 그 날짜가 학원 휴일인가. */
export function isHolidayOn(holidays: HolidayMap | null | undefined, date: string): boolean {
  return holidayNameOn(holidays, date) !== null;
}

/**
 * 한 칸(교시 하나·학생-수업일 하나)의 작성률 재료.
 * `written` = 그 칸에 **의미 있는 기록**이 있는가(계획 줄·수업 기록 — 판정은 호출부 몫).
 */
export type HolidayFillCell = { holiday: boolean; written: boolean };

export type HolidayFill = {
  /** 분모 — 평일 전부 + **쓴 휴일**. */
  total: number;
  /** 분자 — 쓴 칸(평일·휴일 모두). */
  filled: number;
  /** 그중 휴일인데 써서 **한 일로 인정**된 칸 수(화면 각주·검산용). */
  holidayWritten: number;
  /** 안 쓴 휴일 — 분모에도 분자에도 안 들어간 칸 수("휴"로 표기할 자리). */
  holidayIdle: number;
};

/**
 * 위 규약대로 칸을 센다. 호출부는 자기 축(ECS=교시, MCS=학생×수업일)을 `{holiday, written}`으로만 접어 넘긴다.
 *
 * ⚠️ 분모·분자를 호출부에서 따로 더하지 말 것 — 그러면 "안 쓴 휴일을 뺀다"와 "쓴 휴일은 인정한다" 중
 *    한쪽만 구현한 화면이 반드시 생긴다(둘은 **한 규칙의 앞뒷면**이다).
 */
export function tallyHolidayFill(cells: Iterable<HolidayFillCell>): HolidayFill {
  const out: HolidayFill = { total: 0, filled: 0, holidayWritten: 0, holidayIdle: 0 };
  for (const cell of cells) {
    if (cell.holiday) {
      // 안 쓴 휴일은 여기서 통째로 빠진다(대상 0). 쓴 휴일만 대상=작성으로 들어간다.
      if (!cell.written) {
        out.holidayIdle += 1;
        continue;
      }
      out.holidayWritten += 1;
    }
    out.total += 1;
    if (cell.written) out.filled += 1;
  }
  return out;
}

/** 0~100 정수 백분율(분모 0이면 0) — 화면마다 반올림이 갈리지 않게 여기서 한 번만 짓는다. */
export function fillPct(fill: { filled: number; total: number }): number {
  return fill.total > 0 ? Math.round((fill.filled / fill.total) * 100) : 0;
}
