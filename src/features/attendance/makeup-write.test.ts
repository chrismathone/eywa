import { describe, expect, it } from "vitest";
import { canWriteAttendanceStudent } from "./makeup-write";

describe("canWriteAttendanceStudent", () => {
  it("수강생은 그대로 쓴다", () => {
    expect(canWriteAttendanceStudent({ enrolled: true, hasRecord: false, allowMakeup: false })).toBe(true);
  });

  it("수강 아닌데 보강으로 넣는 저장은 통과", () => {
    expect(canWriteAttendanceStudent({ enrolled: false, hasRecord: false, allowMakeup: true })).toBe(true);
  });

  it("이미 그 칸에 기록이 있으면(보강으로 넣었던 칸) 고칠 수 있다", () => {
    expect(canWriteAttendanceStudent({ enrolled: false, hasRecord: true, allowMakeup: false })).toBe(true);
  });

  it("🔴 아무 근거 없이 남의 반 학생을 쓰면 안 된다", () => {
    expect(canWriteAttendanceStudent({ enrolled: false, hasRecord: false, allowMakeup: false })).toBe(false);
  });
});
