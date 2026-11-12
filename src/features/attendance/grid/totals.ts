// 출석부 시트 집계 — 화면의 **모든** 합계(행 시수·출석률 · 반 시수 · 총합 · 상단 스탯)가 이 한 곳을 거친다.
//
// 🔴 왜 한 곳인가: 첫 렌더(서버, marks/units)와 타이핑 중(클라, 격자 값)이 **같은 숫자**를 내야 한다.
//    식을 두 벌 만들면 입력 중엔 A로 보이다가 새로고침 뒤 B로 굳는다 — 그 숫자는 급여로 흘러가는 시수다.
// ⚠️ 분모는 **기록이 있는 칸**뿐이다. 빈 칸은 결석이 아니라 "아직 안 찍음"이다(서버 marks에 키가 없는 것과 같은 규약).

import { COUNTABLE_STATUSES } from "../session-units";
import { attendedCount } from "@/lib/calc/attendance";
import { round1 } from "@/lib/guards";

/** 한 칸의 값 — 격자 저장소의 `GridValue`와 같은 모양. 순수 모듈이라 **구조로만** 받는다(순환 import 방지). */
export type CountedCell = { s: string; u: number | null; g?: true } | null;

export type Counted = {
  /** 기록이 있는 칸 수 = 출석률의 분모. */
  recorded: number;
  present: number;
  absent: number;
  late: number;
  makeup: number;
  /** 시수 합 = 소비 상태(출석·지각·조퇴·보강) 칸의 배수 합(배수 미입력 = 1). */
  units: number;
};

export const EMPTY_COUNT: Counted = { recorded: 0, present: 0, absent: 0, late: 0, makeup: 0, units: 0 };

/** 0.1 단위 반올림 — 1.5를 여러 번 더할 때 생기는 부동소수 꼬리를 자른다. */

export function countCells(values: Iterable<CountedCell>): Counted {
  let recorded = 0;
  let present = 0;
  let absent = 0;
  let late = 0;
  let makeup = 0;
  let units = 0;
  for (const v of values) {
    // 🔴 빗금 칸의 표시 값(`g` — 다른 선생님 교시 기록)은 **이 표의 값이 아니다**(원장 2026-09-14 "합계엔 안 넣는다").
    //    세면 그 교시를 맡은 선생님 표와 시수·출석률·기록 수가 이중으로 잡힌다. 서버 폴백(`countMarks`)도 marks만 센다.
    if (!v || v.g) continue;
    recorded++;
    if (v.s === "present") present++;
    else if (v.s === "absent") absent++;
    else if (v.s === "late") late++;
    else if (v.s === "makeup") makeup++;
    if (COUNTABLE_STATUSES.has(v.s)) units += v.u ?? 1;
  }
  return { recorded, present, absent, late, makeup, units: round1(units) };
}

/** 서버 첫 렌더용 — 매트릭스의 marks/units 레코드에서 같은 집계를 낸다(클라는 격자 값에서). */
export function countMarks(
  marks: Record<string, string>,
  units: Record<string, number>,
): Counted {
  return countCells(Object.entries(marks).map(([date, s]) => ({ s, u: units[date] ?? null })));
}

export function addCounts(a: Counted, b: Counted): Counted {
  return {
    recorded: a.recorded + b.recorded,
    present: a.present + b.present,
    absent: a.absent + b.absent,
    late: a.late + b.late,
    makeup: a.makeup + b.makeup,
    units: round1(a.units + b.units),
  };
}

export function sumCounts(list: Iterable<Counted>): Counted {
  let acc = EMPTY_COUNT;
  for (const c of list) acc = addCounts(acc, c);
  return acc;
}

/**
 * 행·반 표시용 출석률(정수 %).
 * ⚠️ 기록이 하나도 없으면 **null("—")** — 0%가 아니다. 출석률이 0인 것과 아직 아무도 안 찍은 것은 다른 사실이다.
 */
export function ratePercent(c: Counted): number | null {
  return c.recorded > 0 ? Math.round((attendedCount(c) / c.recorded) * 100) : null;
}

/** 상단 스탯용 출석률(소수 한 자리). 기록이 없으면 0 — 호출부가 `recorded`로 "—"를 가른다. */
export function rateDecimal(c: Counted): number {
  return c.recorded > 0 ? Math.round((attendedCount(c) / c.recorded) * 1000) / 10 : 0;
}
