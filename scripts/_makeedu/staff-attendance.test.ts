import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { staffAttendanceRange, parseStaffAttendance, planStaffAttendance } = require_("./staff-attendance.cjs");

const HEADERS = ["No", "이름", "고용형태", "일자", "출근 일시", "출근 태그IP", "출근 사진", "퇴근 일시", "퇴근 태그IP", "퇴근 사진", "근무시간", "메모", "직원번호"];
const row = (name: string, day: string, inAt: string, outAt: string, staffNo: string, memo = "") =>
  ["1", name, "정규직", day, inAt, "1.2.3.4", "", outAt, "1.2.3.4", "", "", memo, staffNo];
const users = [
  { id: "u-hong", display_name: "홍길동", english_name: "Amy", status: "active" },
  { id: "u-kim1", display_name: "김민지", english_name: null, status: "active" },
  { id: "u-kim2", display_name: "김민지", english_name: null, status: "active" },
];

describe("staffAttendanceRange", () => {
  it("지난달 1일 ~ 오늘(한국 날짜) — 1월이면 전년 12월부터", () => {
    expect(staffAttendanceRange({ today: "2026-10-15" })).toEqual({ from: "2026-09-01", to: "2026-10-15" });
    expect(staffAttendanceRange({ today: "2026-01-03" })).toEqual({ from: "2025-12-01", to: "2026-01-03" });
  });
  it("지정한 기간이 있으면 그 값 · 거꾸로면 멈춘다", () => {
    expect(staffAttendanceRange({ today: "2026-10-15", from: "2026-04-01", to: "2026-09-30" })).toEqual({ from: "2026-04-01", to: "2026-09-30" });
    expect(() => staffAttendanceRange({ today: "2026-10-15", from: "2026-10-20", to: "2026-10-01" })).toThrow("거꾸로");
  });
});

describe("parseStaffAttendance", () => {
  it("열 이름으로 읽고 시각은 한국 시간으로 · 시각이 없는 칸은 null", () => {
    const out = parseStaffAttendance({ headers: HEADERS, rows: [row("홍길동(Amy)", "2026-10-15", "2026-10-15 13:27:32", "", "S1", "외근")] });
    expect(out).toEqual([{ staffNo: "S1", name: "홍길동(Amy)", day: "2026-10-15", checkIn: "2026-10-15T13:27:32+09:00", checkOut: null, memo: "외근" }]);
  });
  it("열을 못 알아보면 쓰기 전에 멈춘다(화면 개편)", () => {
    expect(() => parseStaffAttendance({ headers: HEADERS.filter((h) => h !== "출근 일시"), rows: [] })).toThrow("없는 열: 출근 일시");
  });
  it("이름 없는 줄은 건너뛰고 · 이름은 있는데 날짜·직원 번호를 못 읽은 줄이 있으면 멈춘다(그날 기존 줄을 지우지 않게)", () => {
    expect(parseStaffAttendance({ headers: HEADERS, rows: [row("", "2026-10-15", "2026-10-15 13:00:00", "", "S1"), row("홍길동", "2026-10-15", "2026-10-15 13:00:00", "", "S1")] })).toHaveLength(1);
    expect(() => parseStaffAttendance({ headers: HEADERS, rows: [row("홍길동", "2026-10-15", "2026-10-15 13:00:00", "", "")] })).toThrow("직원 번호를 읽지 못했습니다");
    expect(() => parseStaffAttendance({ headers: HEADERS, rows: [row("홍길동", "", "2026-10-15 13:00:00", "", "S1")] })).toThrow("날짜");
  });
  it("그 기간 기록이 0건이면 화면의 '데이터 없음' 한 줄은 정상 · 총건수가 있는데 한 줄도 못 읽으면 멈춘다", () => {
    const empty = { headers: HEADERS, rows: [["데이터가 없습니다."]], totalReported: 0 };
    expect(parseStaffAttendance(empty)).toEqual([]);
    expect(() => parseStaffAttendance({ ...empty, totalReported: 3 })).toThrow("한 줄도 읽지 못했습니다");
  });
});

describe("planStaffAttendance", () => {
  const parsed = (rows: string[][]) => parseStaffAttendance({ headers: HEADERS, rows });
  it("이름으로 잇고 · 동명이인과 모르는 이름은 쓰지 않는다", () => {
    const plan = planStaffAttendance({
      tenantId: "t1", users, existing: [],
      rows: parsed([row("홍길동(Amy)", "2026-10-15", "2026-10-15 13:27:32", "2026-10-15 21:00:00", "S1"), row("김민지", "2026-10-15", "2026-10-15 12:00:00", "", "S2"), row("모르는사람", "2026-10-15", "2026-10-15 12:00:00", "", "S3")]),
    });
    expect(plan.writes).toEqual([{
      tenant_id: "t1", user_id: "u-hong", work_date: "2026-10-15", check_in_at: "2026-10-15T13:27:32+09:00", check_out_at: "2026-10-15T21:00:00+09:00",
      status: "present", late_minutes: null, source: "makeedu", source_key: "S1|2026-10-15", note: null,
    }]);
    expect(plan.unmatched).toBe(2);
  });
  it("같은 직원·날짜 두 줄은 가장 이른 출근 · 가장 늦은 퇴근으로 합친다", () => {
    const plan = planStaffAttendance({ tenantId: "t1", users, existing: [], rows: parsed([
      row("홍길동", "2026-10-15", "2026-10-15 14:00:00", "2026-10-15 18:00:00", "S1"), row("홍길동", "2026-10-15", "2026-10-15 13:10:00", "2026-10-15 22:00:00", "S1"),
    ]) });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ check_in_at: "2026-10-15T13:10:00+09:00", check_out_at: "2026-10-15T22:00:00+09:00" });
  });
  it("이미 같은 값이 있으면 쓰지 않는다 · 퇴근이 새로 찍히면 다시 쓴다 · 시각이 하나도 없으면 건너뛴다", () => {
    const existing = [{ source_key: "S1|2026-10-15", user_id: "u-hong", work_date: "2026-10-15", check_in_at: new Date("2026-10-15T04:27:32Z"), check_out_at: null, note: null }];
    const same = planStaffAttendance({ tenantId: "t1", users, existing, rows: parsed([row("홍길동", "2026-10-15", "2026-10-15 13:27:32", "", "S1")]) });
    expect(same).toMatchObject({ writes: [], unchanged: 1 });
    const out = planStaffAttendance({ tenantId: "t1", users, existing, rows: parsed([row("홍길동", "2026-10-15", "2026-10-15 13:27:32", "2026-10-15 21:00:00", "S1")]) });
    expect(out.writes).toHaveLength(1);
    const none = planStaffAttendance({ tenantId: "t1", users, existing: [], rows: parsed([row("홍길동", "2026-10-15", "2026-10-15 13:00:00", "", "S1"), row("홍길동", "2026-10-16", "", "", "S1")]) });
    expect(none).toMatchObject({ empty: 1 });
  });
  it("기간 안에 aywa엔 있는데 makeedu에서 지워졌거나 시각이 비워진 줄은 지운다 · 이름을 못 이은 줄은 남긴다", () => {
    const existing = ["S1|2026-10-14", "S1|2026-10-15", "S9|2026-10-15"].map((source_key) => ({ source_key, user_id: "u-hong", work_date: source_key.slice(-10), check_in_at: null, check_out_at: null, note: null }));
    const plan = planStaffAttendance({ tenantId: "t1", users, existing, rows: parsed([row("홍길동", "2026-10-15", "", "", "S1"), row("모르는사람", "2026-10-15", "2026-10-15 12:00:00", "", "S9")]) });
    expect(plan.deletes.sort()).toEqual(["S1|2026-10-14", "S1|2026-10-15"]);
  });
  it("한 직원에게 서로 다른 makeedu 직원 번호가 이어지면(퇴사한 동명이인) 그 직원 줄은 쓰지 않고 남은 줄도 지운다", () => {
    const existing = [{ source_key: "S1|2026-10-15", user_id: "u-hong", work_date: "2026-10-15", check_in_at: null, check_out_at: null, note: null }];
    const plan = planStaffAttendance({ tenantId: "t1", users, existing, rows: parsed([row("홍길동", "2026-10-15", "2026-10-15 13:00:00", "", "S1"), row("홍길동", "2026-10-15", "2026-10-15 09:00:00", "", "S7")]) });
    expect(plan).toMatchObject({ writes: [], ambiguous: 2, deletes: ["S1|2026-10-15"] });
  });
});
