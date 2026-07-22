import { describe, expect, it } from "vitest";
import { includeInAttendanceInput, type AttendanceInputCandidate } from "./input-roster";

const base: AttendanceInputCandidate = {
  startDate: "2026-03-01",
  endDate: null,
  onHold: false,
  attendanceDays: null,
};
// 2026-07-23 = 목요일
const THU = "2026-07-23";

describe("includeInAttendanceInput", () => {
  it("등원요일 지정이 없으면 반 운영일 전부 대상", () => {
    expect(includeInAttendanceInput(base, THU, "thu", false)).toBe(true);
  });

  it("분리등원 — 그 요일에 오는 학생만 (이게 빠져서 월7·화7·목9·금5명이 잘못 떴다)", () => {
    const monOnly = { ...base, attendanceDays: ["mon"] };
    expect(includeInAttendanceInput(monOnly, THU, "thu", false)).toBe(false);
    expect(includeInAttendanceInput(monOnly, "2026-07-20", "mon", false)).toBe(true);
  });

  it("휴원(on_hold)은 제외", () => {
    expect(includeInAttendanceInput({ ...base, onHold: true }, THU, "thu", false)).toBe(false);
  });

  it("일반 종료는 종료일 당일까지 포함, 반이동은 그날 이미 새 반", () => {
    const ended = { ...base, endDate: THU };
    expect(includeInAttendanceInput(ended, THU, "thu", false)).toBe(true);
    expect(includeInAttendanceInput({ ...ended, isTransferred: true }, THU, "thu", false)).toBe(false);
  });

  it("⚠️ 이미 기록이 있으면 등원요일 밖·휴원·종료여도 남긴다 — 안 그러면 수정 불가가 된다", () => {
    const monOnly = { ...base, attendanceDays: ["mon"] };
    expect(includeInAttendanceInput(monOnly, THU, "thu", true)).toBe(true);
    expect(includeInAttendanceInput({ ...base, onHold: true }, THU, "thu", true)).toBe(true);
    expect(includeInAttendanceInput({ ...base, endDate: "2026-05-01" }, THU, "thu", true)).toBe(true);
  });

  it("수강 시작 전 날짜는 제외(기록이 없으면)", () => {
    expect(includeInAttendanceInput(base, "2026-02-01", "sun", false)).toBe(false);
  });
});
