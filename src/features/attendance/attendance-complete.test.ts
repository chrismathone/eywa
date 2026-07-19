import { describe, expect, it } from "vitest";
import { isClassAttendanceComplete } from "./attendance-complete";

describe("isClassAttendanceComplete — G4 완료 전이 판정", () => {
  it("활성 수강생 전원 기록 = 완료", () => {
    expect(isClassAttendanceComplete(["a", "b", "c"], new Set(["a", "b", "c"]))).toBe(true);
  });
  it("한 명이라도 미기록 = 미완료", () => {
    expect(isClassAttendanceComplete(["a", "b", "c"], new Set(["a", "b"]))).toBe(false);
  });
  it("기록이 활성 수강생보다 많아도(전출생 잔기록 등) 활성 전원이면 완료", () => {
    expect(isClassAttendanceComplete(["a", "b"], new Set(["a", "b", "z"]))).toBe(true);
  });
  it("수강생 0명(빈 반·데이터 공백) = 완료 아님 — 무의미 벨 방지", () => {
    expect(isClassAttendanceComplete([], new Set())).toBe(false);
    expect(isClassAttendanceComplete([], new Set(["x"]))).toBe(false);
  });
});
