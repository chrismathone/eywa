import { getGradeLevel } from "@/lib/format/school-grade";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { NET_MULTIPLIER } from "@/features/payroll/settlement";
import { floor1 } from "@/features/payroll/tier-settlement";
import { actualLessonAmount } from "./actual-amount";
import type { AttendanceConfirmedPrice, AttendanceTermSessions } from "./class-billing";

export const ATTENDANCE_RATE_LEVELS = ["초등", "중등", "고등"] as const;
export type AttendanceRateLevel = typeof ATTENDANCE_RATE_LEVELS[number];
export type AttendanceSalaryRates = {
  regular: Partial<Record<AttendanceRateLevel, number>>;
  special: Partial<Record<AttendanceRateLevel, number>>;
  classes: Record<string, number>;
};
export const emptyAttendanceRates = (): AttendanceSalaryRates => ({ regular: {}, special: {}, classes: {} });

/** Strict save validation, including zero as an intentional rate. */
export function parseAttendanceRates(value: unknown): AttendanceSalaryRates | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const out = emptyAttendanceRates();
  for (const kind of ["regular", "special", "classes"] as const) {
    const data = input[kind];
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    for (const [key, rate] of Object.entries(data)) {
      if (kind === "classes" ? !/^[0-9a-f-]{36}$/i.test(key) : !ATTENDANCE_RATE_LEVELS.includes(key as AttendanceRateLevel)) return null;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100) return null;
      (out[kind] as Record<string, number>)[key] = Math.round(rate * 100) / 100;
    }
  }
  return out;
}

export function attendanceSalaryRate(rates: AttendanceSalaryRates, row: {
  classId: string; className: string; isSpecial?: boolean; grade: string | null;
}): number | null {
  if (rates.classes[row.classId] !== undefined) return rates.classes[row.classId]!;
  const grade = getGradeLevel(row.grade);
  const level = grade === "초" ? "초등" : grade === "중" ? "중등" : grade === "고" ? "고등" : null;
  if (!level) return null;
  return rates[isSpecialLecture(row) ? "special" : "regular"][level] ?? null;
}

/**
 * 실급여 상한에 쓸 **이 선생님 몫의 청구액**.
 *
 * 영어 반을 여러 선생님이 나눠 맡으면 칸의 시수는 그 선생님 교시뿐이고 등록 차수도 그 몫으로 나뉘는데(`teacherTermSessions`),
 * 청구액은 줄 전체 금액이다. 전체 금액과 비교하면 두 선생님이 각자 상한 안이어도 **합쳐서** 받은 돈을 넘는다
 * (청구 72,000 · 실수업 48,000 + 48,000 → 둘 다 안 깎여 96,000을 기준으로 지급). 그래서 등록 차수가 나뉜 줄은
 * **청구액 × 제 몫 ÷ 반 전체**로 깎는다 — 화면의 등록 차수와 같은 비율이다.
 * ⚠️ 몫을 모르면(배분 대기) 전체 청구액을 쓴다(한 선생님 기준으로는 여전히 받은 돈을 넘지 않는다).
 * ⚠️ 청구액을 모르면 `undefined`(상한 없음 — `actualSalaryBase`와 같은 규약).
 */
export function salaryBilledCap(
  billed: number | null | undefined,
  term: AttendanceTermSessions | null | undefined,
): number | undefined {
  if (typeof billed !== "number" || !Number.isFinite(billed)) return undefined;
  const whole = term?.classUnits;
  if (!term || term.allocationPending || whole === undefined || !(whole > 0)) return billed;
  return billed * Math.min(1, Math.max(0, term.units / whole));
}

/**
 * 실급여의 바탕 금액 — **실수업액과 청구액 중 작은 쪽**(원장 2026-09-21 *"실급여 계산시 실수업액이 청구액을 초과하는
 * 경우는 '청구액'으로 계산해야함. 받은 돈보다 많은 돈을 지급하면 안되기 때문."*).
 * ⚠️ 청구액을 모르면(`null`·`undefined` — 회차 미확정·청구서 없음) 깎을 근거가 없어 실수업액 그대로다.
 *    모르는 것을 0으로 읽으면 실급여가 통째로 0이 된다.
 */
export function actualSalaryBase(
  prices: readonly AttendanceConfirmedPrice[] | null | undefined,
  units: number,
  billed?: number | null,
): { base: number; capped: boolean } | null {
  if (actualLessonAmount(prices, units) === null) return null;
  const raw = prices![0]!.unitPrice * units;
  if (typeof billed === "number" && Number.isFinite(billed) && billed < raw) return { base: Math.max(0, billed), capped: true };
  return { base: raw, capped: false };
}

/** Match the established settlement precision: floor each row to one decimal, then sum. */
export function actualLessonSalary(
  prices: readonly AttendanceConfirmedPrice[] | null | undefined,
  units: number,
  rate: number | null | undefined,
  billed?: number | null,
): number | null {
  const base = actualSalaryBase(prices, units, billed);
  if (rate == null || base === null) return null;
  return floor1(base.base * NET_MULTIPLIER * (rate / 100));
}

/**
 * 줄 실급여들의 **합계**(원, 내림) — 출석부 합계 칸과 프리랜서 명세서가 같은 함수를 쓴다(원장 2026-10-06 "출석부 그대로").
 * 🔑 줄 값은 소수 한 자리(`floor1`)다. 소수로 그냥 더하면 더하는 순서에 따라 정수 경계에서 1원이 갈릴 수 있어
 *    **0.1원 단위 정수로** 더한 뒤 내린다 — 줄 순서가 달라도(화면 정렬 · 서버 조립) 같은 값이 나온다.
 */
export function sumSalaryAmounts(amounts: Iterable<number>): number {
  let tenths = 0;
  for (const amount of amounts) tenths += Math.round(amount * 10);
  return Math.floor(tenths / 10);
}
