import type { AttendanceTermSessions } from "./class-billing";
import { isEnrolledOn, type EnrollSpan } from "./enrollment-span";

/**
 * 월별 출석부 한 줄이 그 달 **수업날이 하나도 없는** 줄인가(원장 2026-09-18 *"출석부에서 수업날이 하나도 없어서
 * 등록차수가 - 표기된 수업은 '미확정' 이 아니라 등록차수를 0, 청구액을 0, 수업차수도 0 으로 해야할것"*).
 *
 * 🔑 "수업날"은 줄이 **수업요일 색을 칠하는 판정과 같다**(`MatrixRow`의 `attend`): 등원 요일 ∩ 수강 기간 ∩ 휴일 아님.
 *    화면이 색으로 "수업하는 날이 없다"고 말하는 줄에서만 0을 적는다 — 둘이 갈리면 색은 수업날이 있다는데 숫자는 0이 된다.
 *    ⚠️ 강사 보기의 '그 강사가 수업하는 날'(`ownDates`)은 **안 본다** — 청구·등록 차수는 학생 × 반의 사실이다.
 *    ⚠️ 다만 **찍힌 값**은 그 화면이 받은 값이다 — 강사 보기는 남의 교시·자리(JJ·랩실) 기록을 안 싣기 때문에, 그런 기록만 있는
 *       줄은 강사 화면에서만 0이 될 수 있다(2026-09-18 실측 해당 줄 0개 — 보강 방문 기록은 전부 교시 없는 수학).
 * 🔴 **사실이 규칙을 이긴다** — 찍힌 출결이나 수업보고서 파생 값이 하루라도 있으면 수업이 있었던 것이라 0이 아니다
 *    (보강·요일 밖 수업이 그렇다).
 * ⚠️ 수강 구간을 모르면(`spans` 빈 배열) `isEnrolledOn`이 참이라 등원 요일만으로 판정한다(모르는 것을 '재원 아님'으로 안 읽는다).
 */
export function hasNoLessonDays(input: {
  days: readonly { date: string; dow: number; placeholder?: boolean }[];
  holidays: Readonly<Record<string, string>>;
  attendDows: readonly number[];
  spans: readonly EnrollSpan[];
  /** 그 줄에 찍힌 값(날짜 → 상태) — 하나라도 있으면 수업이 있었다. */
  marks: Readonly<Record<string, unknown>>;
  /** 수업보고서에서 온 값(날짜 → 값) — 찍힌 값과 같은 사실로 본다. */
  derived?: Readonly<Record<string, unknown>>;
}): boolean {
  const { days, holidays, attendDows, spans, marks, derived } = input;
  if (Object.values(marks).some(Boolean)) return false;
  if (derived && Object.values(derived).some(Boolean)) return false;
  const dows = new Set(attendDows);
  return !days.some(
    (d) => !d.placeholder && dows.has(d.dow) && !holidays[d.date] && isEnrolledOn(d.date, spans),
  );
}

/** 수업날 없는 줄의 등록 차수 — 확정한 게 아니라 "셀 것이 없다"는 0이다. */
export const NO_LESSON_TERM: AttendanceTermSessions = { units: 0, daysBasis: false };

/**
 * 표 **한 곳**에서 0으로 적을 줄을 정하고, 그 줄을 얹은 청구액·등록 차수 두 벌을 만든다 — 줄 칸과 합계 행이 **같은 값**을 본다
 * (줄마다 따로 바꾸면 합계 행이 원래 재료로 세서 전부 0인 반의 합계가 `—`로 남는다 — 적대 리뷰 2026-09-18).
 *
 * 🔴 **청구액과 등록 차수가 둘 다 비었을 때만** 0이다. 한쪽에 실제 값이 있으면 그 줄은 손대지 않는다 — 청구 96,000원인데
 *    등록 0.0·차이 0.0(계획대로)으로 적으면 회차 확정이 남았다는 신호가 사라진다(적대 리뷰 2026-09-18, 8월 실측 21줄).
 * ⚠️ 열이 없는 값(`undefined`)은 빈 것으로 본다 — 열 자체가 없으면 거기엔 모순이 설 자리가 없다.
 */
export function noLessonZeroView(input: {
  rows: readonly { key: string; noLessons: boolean }[];
  billed?: Readonly<Record<string, number>>;
  term?: Readonly<Record<string, AttendanceTermSessions>>;
}): {
  zeroRows: Set<string>;
  billed?: Record<string, number>;
  term?: Record<string, AttendanceTermSessions>;
} {
  const { rows, billed, term } = input;
  const zeroRows = new Set(
    rows
      .filter((r) => r.noLessons && billed?.[r.key] === undefined && term?.[r.key] === undefined)
      .map((r) => r.key),
  );
  const zeros = [...zeroRows];
  return {
    zeroRows,
    ...(billed ? { billed: { ...billed, ...Object.fromEntries(zeros.map((k) => [k, 0])) } } : {}),
    ...(term ? { term: { ...term, ...Object.fromEntries(zeros.map((k) => [k, NO_LESSON_TERM])) } } : {}),
  };
}
