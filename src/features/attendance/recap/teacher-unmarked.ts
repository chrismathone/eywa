/**
 * "입력이 덜 된 강사" 줄 → **그 강사의 미입력 출석부 목록**(순수 함수, Vitest).
 *
 * 원장 제보 2026-08-19: *"어제 출결에서 미입력 볼 수 있는 방법이 없네? 누르면 리스트라도 볼 수 있어야
 * 하는데 바로가기 같은것도 없네."* — 줄이 `미입력 3반`이라고만 말하고 **어느 반인지·어디로 가는지**가
 * 없었다.
 *
 * 🔑 새로 세지 않는다. 날짜 블록이 이미 그리는 `day.unmarked`(반 단위)를 그 강사 것만 고를 뿐이라
 *    줄의 숫자와 펼친 목록이 **구조적으로 같은 값**이다(둘 다 `buildDayRecap`의 같은 순회에서 나온다).
 * 🔴 고르는 키는 `teacherNames`(표시)가 아니라 **`teacherLines`(집계 축)** 다 — 표시는 자리면 `LAB`·`JJ`,
 *    영어면 시트 닉네임 원문(`Jane`)이라 강사 줄 이름(`이현이`·`담당 미지정`)과 안 맞는다. 표시로 고르면
 *    "미입력 3반"인데 펼치면 0건이 된다(digest.ts `teacherLines` 주석 참조).
 * ⚠️ 반 단위라 **같은 반의 여러 교시는 한 줄**이다(영어는 하루에 2~4교시가 흔하다 — 교시는 행 안에
 *    `slots`로 함께 적힌다). 담당이 교시마다 갈리는 반은 **두 강사 줄에 모두** 뜬다(집계도 그렇게 센다).
 *
 * 🔑 2026-08-20부터 **빈 칸(부분 미입력)** 도 같은 모양으로 파생한다(`partialByTeacher`) — 통째 미입력은
 *    반 단위라 "학생 한 명만 빠진 출석부"를 표현하지 못해, 그런 강사 줄은 펼칠 것이 없다고 판단했었다
 *    (원장 제보 *"유형숙과 추민아는 펼쳐보기가 안되서 누가 입력안되었는지 체크가 안돼"*).
 */

import type { RecapPartialClass, RecapUnmarkedClass } from "./digest";

/** 하루치 미입력 목록 — 화면이 날짜 머리를 달아 그린다(기간 합계 줄이라 날짜가 사라지면 안 된다). */
export type TeacherUnmarkedDay = {
  date: string;
  classes: RecapUnmarkedClass[];
};

type DayLike = { date: string; unmarked: readonly RecapUnmarkedClass[] };

/**
 * 그 강사의 미입력 출석부를 **날짜 오름차순**으로. 없는 날은 아예 넣지 않는다(빈 날짜 머리 금지).
 *
 * @param teacherName 강사 줄의 이름(`RecapTeacherLine.teacherName`) — `담당 미지정`도 그대로 넘긴다.
 */
export function unmarkedByTeacher(
  days: readonly DayLike[],
  teacherName: string,
): TeacherUnmarkedDay[] {
  const out: TeacherUnmarkedDay[] = [];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const classes = day.unmarked.filter((c) => c.teacherLines.includes(teacherName));
    if (classes.length > 0) out.push({ date: day.date, classes });
  }
  return out;
}

/**
 * 펼쳤을 때 나올 반 수 — 줄에 적힌 `unmarkedClasses`(기간 합계)와 **같아야 한다**.
 * 다르면 파생 규칙이 집계와 어긋난 것이고, 그 자체가 버그다(테스트가 잠근다).
 */
export function countUnmarkedByTeacher(days: readonly DayLike[], teacherName: string): number {
  return unmarkedByTeacher(days, teacherName).reduce((n, d) => n + d.classes.length, 0);
}

/** 하루치 **부분 미입력**(출석부는 열렸는데 남은 빈 칸) 목록 — 위와 같은 모양이라 화면이 같은 틀로 그린다. */
export type TeacherPartialDay = {
  date: string;
  classes: RecapPartialClass[];
};

type PartialDayLike = { date: string; partial: readonly RecapPartialClass[] };

/**
 * 그 강사가 빈 칸을 남긴 반을 **날짜 오름차순**으로. 없는 날은 넣지 않는다(빈 날짜 머리 금지).
 *
 * 🔴 고르는 키는 `teacherLine`(집계 축) 하나다 — `RecapPartialClass`는 이미 (반 × 강사 줄)로 쪼개져
 *    있어서, 같은 반의 교시마다 담당이 갈려도 **자기 교시만** 따라온다.
 */
export function partialByTeacher(
  days: readonly PartialDayLike[],
  teacherName: string,
): TeacherPartialDay[] {
  const out: TeacherPartialDay[] = [];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const classes = day.partial.filter((p) => p.teacherLine === teacherName);
    if (classes.length > 0) out.push({ date: day.date, classes });
  }
  return out;
}

/**
 * 펼쳤을 때 나올 빈 칸 수 — 줄에 적힌 `partialCells`(기간 합계)와 **같아야 한다**.
 * 다르면 파생이 집계와 어긋난 것이고, 그 자체가 버그다(테스트가 잠근다).
 */
export function countPartialCellsByTeacher(
  days: readonly PartialDayLike[],
  teacherName: string,
): number {
  return partialByTeacher(days, teacherName).reduce(
    (n, d) => n + d.classes.reduce((m, c) => m + c.cells, 0),
    0,
  );
}
