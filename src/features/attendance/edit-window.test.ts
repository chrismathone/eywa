import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_EDIT_WINDOW_DAYS,
  attendanceLockMessage,
  isWithinAttendanceEditWindow,
} from "./edit-window";
import { diffDays } from "@/lib/date-kst";

const TODAY = "2026-07-21";

describe("diffDays(lib/date-kst) — 7일 잠금이 쓰는 일수 차", () => {
  it("일수 차를 정확히 센다(달·월 경계 포함)", () => {
    expect(diffDays("2026-07-21", "2026-07-21")).toBe(0);
    expect(diffDays("2026-07-14", "2026-07-21")).toBe(7);
    expect(diffDays("2026-06-30", "2026-07-01")).toBe(1);
    expect(diffDays("2026-02-28", "2026-03-01")).toBe(1); // 2026는 평년
  });
  it("이상한 날짜는 NaN", () => {
    expect(Number.isNaN(diffDays(TODAY, "2026-13-99"))).toBe(true);
  });
});

describe("isWithinAttendanceEditWindow — 강사는 7일 이내만", () => {
  it("오늘·어제는 가능", () => {
    expect(isWithinAttendanceEditWindow("2026-07-21", TODAY)).toBe(true);
    expect(isWithinAttendanceEditWindow("2026-07-20", TODAY)).toBe(true);
  });
  it("경계 — 6일 전은 가능, 7일 전부터 잠긴다", () => {
    expect(isWithinAttendanceEditWindow("2026-07-15", TODAY)).toBe(true); // 6일 전
    expect(isWithinAttendanceEditWindow("2026-07-14", TODAY)).toBe(false); // 7일 전
    expect(isWithinAttendanceEditWindow("2026-07-13", TODAY)).toBe(false);
  });
  it("미래 날짜는 막지 않는다(다음 수업 미리 찍기 허용)", () => {
    expect(isWithinAttendanceEditWindow("2026-07-25", TODAY)).toBe(true);
    expect(isWithinAttendanceEditWindow("2026-12-31", TODAY)).toBe(true);
  });
  it("날짜 형식이 이상하면 잠그지 않는다(다른 검증이 잡는다)", () => {
    expect(isWithinAttendanceEditWindow("bad-date", TODAY)).toBe(true);
  });
  it("창 크기는 상수 하나로 — 7일", () => {
    expect(ATTENDANCE_EDIT_WINDOW_DAYS).toBe(7);
  });
});

describe("attendanceLockMessage", () => {
  it("며칠 지났는지와 해결책을 한글로 알려준다(raw 코드 노출 금지)", () => {
    const m = attendanceLockMessage("2026-07-10", TODAY);
    expect(m).toContain("11일 지나");
    expect(m).toContain("7일 이내");
    expect(m).toContain("관리자");
  });
});
