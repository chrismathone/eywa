import { describe, expect, it } from "vitest";
import { isJjSeatRow, type SeatTransferRow } from "./seat-transfer";
import { attendanceSlotShare, ownsAttendanceSlot, type AxisSlot } from "./teacher-axis";

// JJ실 시수 넘기기(원장 2026-10-07) — JJ실 기록 한 칸을 한 선생님 몫으로(`taught_by`). 랩실은 대상이 아니다.
const TEACHER = "t-homeroom";
const OTHER = "t-other";
const DATE = "2026-10-07"; // 수요일
const slot = (over: Partial<AxisSlot>): AxisSlot => ({ dayOfWeek: "wed", startTime: "16:20", teacherId: null, slotTeacherLabel: null, validFrom: "2026-09-01", validTo: null, ...over });
/** 수요일: 16:20 담임 수업 · 17:20 JJ실 · 18:20 랩실. */
const SLOTS: AxisSlot[] = [
  slot({ startTime: "16:20", teacherId: TEACHER }),
  slot({ startTime: "17:20", slotTeacherLabel: "JJ" }),
  slot({ startTime: "18:20", slotTeacherLabel: "LAB" }),
];
const row = (over: Partial<SeatTransferRow> = {}): SeatTransferRow => ({ slotStart: "17:20", seatLabel: null, recordedVia: "seat", taughtBy: null, status: "present", units: null, ...over });

describe("JJ실 자리 기록 판정", () => {
  it("자리 문이 쓴 라벨 없는 기록 · JJ 슬롯 교시의 기록 = JJ실", () => {
    expect(isJjSeatRow(row(), SLOTS, DATE)).toBe(true);
    // 자리 문 표식이 없는 옛 기록도 교시가 JJ 슬롯이면 JJ실이다.
    expect(isJjSeatRow(row({ recordedVia: null }), SLOTS, DATE)).toBe(true);
    // 자리판 '다른 시간으로 옮기기'로 JJ 슬롯 밖 시각에 찍힌 자리 기록도 자리 문 표식으로 잡는다.
    expect(isJjSeatRow(row({ slotStart: "19:20" }), SLOTS, DATE)).toBe(true);
  });

  it("🔴 랩실 기록(자리 시수 라벨)은 아니다 — 정산이 그 행을 따로 뺀다", () => {
    expect(isJjSeatRow(row({ slotStart: "18:20", seatLabel: "LAB" }), SLOTS, DATE)).toBe(false);
    // 라벨도 문 표식도 없는 랩실 슬롯 교시 기록 — JJ 슬롯이 아니다.
    expect(isJjSeatRow(row({ slotStart: "18:20", recordedVia: null }), SLOTS, DATE)).toBe(false);
  });

  it("🔴 사람이 가르친 교시 · 교시 없는 기록 · 끝난 슬롯은 JJ실이 아니다", () => {
    expect(isJjSeatRow(row({ slotStart: "16:20", recordedVia: null }), SLOTS, DATE)).toBe(false);
    expect(isJjSeatRow(row({ slotStart: null, recordedVia: null }), SLOTS, DATE)).toBe(false);
    const ended = [slot({ startTime: "17:20", slotTeacherLabel: "JJ", validTo: "2026-09-30" })];
    expect(isJjSeatRow(row({ recordedVia: null }), ended, DATE)).toBe(false);
    // 같은 시각에 사람 슬롯이 함께 있으면 사람 수업이다(자리 문 표식이 없을 때).
    const mixed = [...SLOTS, slot({ startTime: "17:20", teacherId: OTHER })];
    expect(isJjSeatRow(row({ recordedVia: null }), mixed, DATE)).toBe(false);
  });

  it("🔴 렌즈와 같은 신호 — 화면이 자리로 보는 JJ 기록만 넘길 수 있다", () => {
    const facts = { scopeTeacherId: TEACHER, homeroomTeacherId: TEACHER, slots: SLOTS, date: DATE };
    for (const r of [row(), row({ recordedVia: null }), row({ slotStart: "19:20" })]) {
      expect(attendanceSlotShare({ ...facts, slotStart: r.slotStart, seatLabel: r.seatLabel, recordedVia: r.recordedVia })).toBe("seat");
      expect(isJjSeatRow(r, SLOTS, DATE)).toBe(true);
    }
  });
});

describe("넘기면 그 선생님 몫이 된다(JJ −1 · 선생님 +1)", () => {
  it("넘기기 전엔 누구 몫도 아니고, 넘긴 뒤엔 그 선생님 렌즈에서만 값이다", () => {
    const facts = { homeroomTeacherId: TEACHER, slots: SLOTS, date: DATE, slotStart: "17:20", seatLabel: null, recordedVia: "seat" };
    expect(ownsAttendanceSlot({ ...facts, scopeTeacherId: TEACHER })).toBe(false);
    expect(ownsAttendanceSlot({ ...facts, scopeTeacherId: TEACHER, taughtBy: TEACHER })).toBe(true);
    expect(ownsAttendanceSlot({ ...facts, scopeTeacherId: OTHER, taughtBy: TEACHER })).toBe(false);
  });
});
