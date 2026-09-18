/**
 * 월별 출석부 차수 뒤에 붙는 **단위 한 글자** — 영어 `U` · 수학 `T`(원장 2026-09-18:
 * *"영어 선생님 출석부는 … 숫자 뒤에 U 붙여 3 U, 1.5 U 이렇게"* · *"수학 선생님 출석부는 T 붙여. 2 T, 4 T"*).
 *
 * 🔑 **사람이 아니라 반의 과목**으로 가른다. 원장의 말은 "영어 선생님 / 수학 선생님"이지만, 겸직 강사의
 *    강사 전체 보기엔 두 과목 반이 한 표에 섞여 서므로 사람으로 정하면 한쪽 묶음이 거짓 단위를 단다.
 *    반으로 정하면 영어만 맡은 사람은 전부 `U`, 수학만 맡은 사람은 전부 `T`로 **결과가 같다**.
 * 🔴 과목 묶음 판정은 [`subjectGroupOf`](../students/program.ts) **단일 소스**를 그대로 지난다 —
 *    여기에 `english`·`math` 키를 다시 적으면 수학(심화)·EiE가 조용히 빠진다(운영 enum 하드코딩 금지).
 * ⚠️ 영어·수학 어느 묶음도 아닌 과목(국어·과학·미상)과 **과목이 섞인 묶음**(보강 반)은 **안 붙인다** —
 *    모르는 것에 글자를 붙이면 그 단위가 사실인 것처럼 읽힌다.
 */
import { subjectGroupOf, type ProgramSubject } from "@/features/students/program";
import { formatSessionUnits } from "./session-units";

export type AttendanceUnitSuffix = "U" | "T" | null;

/** 반 과목 → 단위 글자. `subjects`는 학원설정 `operations.subjects`. */
export function attendanceUnitSuffix(
  subject: string | null | undefined,
  subjects: readonly ProgramSubject[],
): AttendanceUnitSuffix {
  const group = subjectGroupOf(subject, subjects);
  return group === "english" ? "U" : group === "math" ? "T" : null;
}

/**
 * 표시 문자열 — `1.5 T` · 단위가 없으면 숫자만(`1.5`).
 * ⚠️ 숫자 서식은 `formatSessionUnits` 그대로다(정수는 소수점 없이) — 여기서 새로 반올림하지 않는다.
 */
export function formatUnitsWithSuffix(units: number, suffix: AttendanceUnitSuffix): string {
  const n = formatSessionUnits(units);
  return suffix ? `${n} ${suffix}` : n;
}

/**
 * '차이확인' = **수업 차수 − 등록 차수**(원장 2026-09-18). 뺄 수 없으면 null.
 *
 * 🔴 **단위가 같을 때만 뺀다** — 옛 '일수 기준' 확정(`daysBasis`)은 시수가 아니라 **출석 일수**라
 *    빼면 단위가 다른 두 수의 차가 나온다(회차 확정 화면이 붉게 칠하며 *"재확정 필요"*라 적는 그 값).
 *    미확정(`null`)도 같다 — 0으로 치면 "전부 초과"라는 거짓 신호가 열 전체에 깔린다.
 */
export function attendanceUnitsDiff(
  attended: number,
  term: { units: number; daysBasis?: boolean } | null | undefined,
): number | null {
  if (!term || term.daysBasis) return null;
  // 0.1 단위 값들이라 부동소수 꼬리(4.699999…)를 자른다.
  return Math.round((attended - term.units) * 10) / 10;
}
