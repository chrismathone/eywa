import { getGradeLevel } from "@/lib/format/school-grade";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { NET_MULTIPLIER } from "@/features/payroll/settlement";
import { floor1 } from "@/features/payroll/tier-settlement";
import { actualLessonAmount } from "./actual-amount";
import type { AttendanceConfirmedPrice } from "./class-billing";

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

/** Match the established settlement precision: floor each row to one decimal, then sum. */
export function actualLessonSalary(prices: readonly AttendanceConfirmedPrice[] | null | undefined, units: number, rate: number | null | undefined): number | null {
  if (rate == null || actualLessonAmount(prices, units) === null) return null;
  return floor1(prices![0]!.unitPrice * units * NET_MULTIPLIER * (rate / 100));
}
