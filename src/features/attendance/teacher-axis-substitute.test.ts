import { describe, expect, it } from "vitest";
import {
  attendanceSlotShare,
  excludedFromHomeroom,
  isSubstituteRowOf,
  ownsAttendanceSlot,
  resolveRecordTaughtBy,
  type AxisSlot,
} from "./teacher-axis";
import { tierRowsOwnedBy, type TierRow } from "@/features/payroll/tier-settlement";

/**
 * 🔴 원장 결정 3(2026-09-30): 위임 없이 남의 반(B반) 학생을 대신 보강하면 보고서·출석부 반은 B반이지만
 * **그 칸의 시수는 실제로 보강한 강사(A) 몫**이다 — 표식 = `attendance_records.taught_by`(0315a). 단일 소스 = teacher-axis.ts.
 */
const D = "2026-09-30"; // 수요일
const slots: AxisSlot[] = [
  { dayOfWeek: "wed", startTime: "16:20", teacherId: null, slotTeacherLabel: null, validFrom: "2026-01-01", validTo: null },
];
const base = { homeroomTeacherId: "B", slots, date: D, slotStart: null as string | null };

describe("ownsAttendanceSlot — 대신 보강 칸은 보강한 강사 렌즈에만", () => {
  it("귀속이 적힌 칸 = 그 강사 몫, 반 담임 렌즈에선 빠진다", () => {
    expect(ownsAttendanceSlot({ ...base, scopeTeacherId: "A", taughtBy: "A" })).toBe(true);
    expect(ownsAttendanceSlot({ ...base, scopeTeacherId: "B", taughtBy: "A" })).toBe(false);
  });
  it("반별 보기(스코프 없음)는 종전 그대로 전부 그 반 몫", () => {
    expect(ownsAttendanceSlot({ ...base, scopeTeacherId: null, taughtBy: "A" })).toBe(true);
  });
  it("귀속이 비었으면 종전 축(담임 폴백) 그대로 — 0315a 이전 행·칸 없는 스키마", () => {
    expect(ownsAttendanceSlot({ ...base, scopeTeacherId: "B" })).toBe(true);
    expect(ownsAttendanceSlot({ ...base, scopeTeacherId: "B", taughtBy: null })).toBe(true);
  });
  it("담임 렌즈의 셋 가르기에서 대신 보강 칸은 '그 밖'(자리 아님) — 담임 보기 저장이 그 칸을 제 몫으로 덮지 않는다", () => {
    expect(attendanceSlotShare({ ...base, scopeTeacherId: "B", taughtBy: "A" })).toBe("other");
    expect(attendanceSlotShare({ ...base, scopeTeacherId: "A", taughtBy: "A" })).toBe("mine");
  });
});

describe("resolveRecordTaughtBy — 행 단위 귀속", () => {
  it("귀속이 있으면 substitute, 없으면 종전 축", () => {
    expect(resolveRecordTaughtBy({ ...base, taughtBy: "A" })).toEqual({ teacherId: "A", source: "substitute" });
    expect(resolveRecordTaughtBy(base)).toEqual({ teacherId: "B", source: "homeroom" });
  });
  it("판정 한 줄짜리 두 함수", () => {
    expect(isSubstituteRowOf({ taughtBy: "A" }, "A")).toBe(true);
    expect(isSubstituteRowOf({ taughtBy: null }, "A")).toBe(false);
    expect(excludedFromHomeroom({ taughtBy: "A" }, "B")).toBe(true);
    expect(excludedFromHomeroom({ taughtBy: "B" }, "B")).toBe(false);
    expect(excludedFromHomeroom({ taughtBy: null }, "B")).toBe(false);
  });
});

describe("tierRowsOwnedBy — 정산 줄 귀속(명세서·출석부 정산액·수납 정산 면 공용)", () => {
  const row = (classId: string, taughtBy?: string | null): TierRow => ({
    studentId: "s",
    studentName: "학생",
    classId,
    tierLabel: "T",
    units: 1,
    ...(taughtBy !== undefined ? { taughtBy } : {}),
  });
  const rows = [row("Bclass"), row("Bclass", "A"), row("Aclass"), row("Cclass", "A"), row("Cclass")];
  it("🔴 B반 담임 B = B반 줄 중 A의 대신 보강을 뺀다", () =>
    expect(tierRowsOwnedBy(rows, "B", new Set(["Bclass"]))).toEqual([row("Bclass")]));
  it("🔴 보강한 강사 A = 제 반 줄 + 남의 반에서 한 대신 보강 줄", () =>
    expect(tierRowsOwnedBy(rows, "A", new Set(["Aclass"]))).toEqual([row("Bclass", "A"), row("Aclass"), row("Cclass", "A")]));
  it("귀속이 없는 줄만 있으면 종전과 같다(돈 산식 불변 — 골든마스터 입력엔 귀속이 없다)", () => {
    const plain = [row("Aclass"), row("Aclass")];
    expect(tierRowsOwnedBy(plain, "A", new Set(["Aclass"]))).toEqual(plain);
  });
});
