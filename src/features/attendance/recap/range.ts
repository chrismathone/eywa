/**
 * 요약 **범위** — 하루가 아니라 "지난번에 본 뒤로 지나간 수업일"을 덮는다. 순수 함수(Vitest).
 *
 * 원장 2026-08-19: *"월요일은 금,토 종합으로 보여줘"* → 정정 *"월요일은 금~주말 종합"* +
 * *"내용도 금토 구분해서 정리하고"*.
 *
 * 🔑 **월요일 아침의 '어제'는 일요일이라 비어 있다.** 그렇다고 토요일만 보면 금요일 하루가 통째로
 *    아무에게도 안 읽힌 채 넘어간다(주말을 낀 결석·미입력이 월요일엔 이미 사흘 묵은 것이 된다).
 *    그래서 월요일은 **금·토·일 사흘**을 덮되, **합쳐서 뭉개지 않고 날짜별로 나눠** 보여준다 —
 *    "언제 빠졌나"가 사라지면 학부모에게 전화할 때 할 말이 없어진다.
 * ⚠️ 일요일은 보통 수업이 없어 빈 블록이 되는데, **빈 날은 블록을 만들지 않고 한 줄로만 밝힌다**
 *    (보강·특강이 실제로 있었다면 그날은 블록으로 뜬다 — 있는데 안 보이는 일은 없다).
 * ⚠️ 범위는 URL의 `from`~`date`로 실린다(둘이 같으면 하루). 날짜 선택기로 고른 날은 항상 하루다.
 */

import { addDays, weekdayIndexOf } from "@/lib/date-kst";
import type { DayRecap, RecapTeacherLine } from "./digest";

/** 한 화면이 덮을 수 있는 최대 일수 — URL로 임의 범위를 넣어 보드를 N번 적재시키는 것을 막는다. */
export const RECAP_MAX_DAYS = 7;

/**
 * 그날 아침에 볼 요약이 덮어야 할 날짜들(오름차순).
 * · 월요일 = **금·토·일**(주말 전체) · 그 외 = 어제 하루.
 * ⚠️ 공휴일은 여기서 따지지 않는다(그날 블록이 "휴원일"로 뜬다) — 연휴 판정을 여기 넣으면
 *    학원설정을 읽어야 해서 순수 함수가 아니게 된다.
 */
export function recapDatesFor(today: string): string[] {
  // weekdayIndexOf: 0=일 … 6=토
  if (weekdayIndexOf(today) === 1) return [addDays(today, -3), addDays(today, -2), addDays(today, -1)];
  return [addDays(today, -1)];
}

/** URL `from`~`to`를 실제로 적재할 날짜 목록으로(비정상 입력은 하루로 접는다). */
export function recapRangeDates(from: string, to: string): string[] {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymd.test(to)) return [];
  if (!ymd.test(from) || from > to) return [to];
  // 🔴 **뒤(최근)에서부터 채운다.** 앞에서 세면 상한에 걸렸을 때 마지막 날이 `to`가 아니게 되고,
  //    그러면 AI 정리 행의 키(from~to)가 화면이 보는 범위와 어긋나 저장된 요약이 영영 안 보인다.
  //    (오래된 앞부분보다 최근이 급하기도 하다.)
  const out: string[] = [];
  for (let d = to; d >= from && out.length < RECAP_MAX_DAYS; d = addDays(d, -1)) out.unshift(d);
  return out.length > 0 ? out : [to];
}

export type RecapDay = DayRecap & {
  /** 그날이 쉬는 날이면 이름(아니면 null) — 빈 블록을 "기록 0"과 구분한다. */
  holiday: string | null;
};

export type RangeRecap = {
  from: string;
  to: string;
  /** 날짜 오름차순. 하루면 1개. */
  days: RecapDay[];
  /** 범위 전체 합계 — 화면 맨 위 스탯이 읽는 값. */
  totals: DayRecap["totals"];
  /** 범위 전체 강사별 입력(덜 찍은 순) — 날짜별로 흩으면 "누가 계속 안 찍나"가 안 보인다. */
  teachers: RecapTeacherLine[];
};

const ZERO: DayRecap["totals"] = {
  slots: 0,
  classes: 0,
  cells: 0,
  recorded: 0,
  inputRate: null,
  present: 0,
  absent: 0,
  excused: 0,
  late: 0,
  earlyLeave: 0,
  makeup: 0,
  unmarkedClasses: 0,
  unmarkedStudents: 0,
  absentPending: 0,
  // ⚠️ 합계 루프가 `ZERO`의 키를 돌며 더한다 — totals에 필드를 추가하면 **여기에도 반드시** 넣을 것
  //    (빠뜨리면 범위 합계에서 그 값만 undefined가 되고 화면은 NaN을 그린다).
  absentUrgent: 0,
  absentNotified: 0,
};

/**
 * 날짜별 요약 → 범위 요약.
 *
 * 🔑 합계는 **그냥 더한다** — 세는 단위가 (학생·반·그날)이라 금요일에 빠지고 토요일에 또 빠진 학생은
 *    2건이 맞다("빠진 수업"을 센다, 0221a와 같은 자). 사람 수로 접으면 이틀 연속 결석이 1로 보인다.
 * ⚠️ `classes`만은 **날짜별 반 수의 합**이라 같은 반이 이틀 열리면 2로 센다 — 화면이 "반 N개"가 아니라
 *    "N교시"를 앞세우는 이유다(반 수는 보조 표기).
 */
export function buildRangeRecap(days: readonly RecapDay[]): RangeRecap {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const totals = { ...ZERO };
  for (const day of ordered) {
    for (const key of Object.keys(ZERO) as (keyof DayRecap["totals"])[]) {
      if (key === "inputRate") continue;
      totals[key] = (totals[key] as number) + (day.totals[key] as number);
    }
  }
  totals.inputRate = totals.cells > 0 ? Math.round((totals.recorded / totals.cells) * 100) : null;

  // 강사는 날짜를 가로질러 합친다 — 금·토 각각 한 줄씩 두면 같은 사람이 두 번 나와 "덜 찍은 사람"이 흐려진다.
  const byTeacher = new Map<string, RecapTeacherLine>();
  for (const day of ordered) {
    for (const line of day.teachers) {
      const hit = byTeacher.get(line.teacherName);
      if (hit) {
        hit.cells += line.cells;
        hit.recorded += line.recorded;
        hit.unmarkedClasses += line.unmarkedClasses;
        // 빈 칸도 날짜를 가로질러 더한다 — `days`엔 `partial`이 그대로 실리므로 목록은 자동으로 흐른다.
        hit.partialCells += line.partialCells;
      } else {
        byTeacher.set(line.teacherName, { ...line });
      }
    }
  }

  return {
    from: ordered[0]?.date ?? "",
    to: ordered[ordered.length - 1]?.date ?? "",
    days: ordered,
    totals,
    teachers: [...byTeacher.values()].sort((a, b) => {
      const ra = a.cells === 0 ? 1 : a.recorded / a.cells;
      const rb = b.cells === 0 ? 1 : b.recorded / b.cells;
      return ra - rb || a.teacherName.localeCompare(b.teacherName, "ko");
    }),
  };
}
