import { describe, expect, it } from "vitest";
import { planSeatGive, seatGiveCells, seatGiveKey, type SeatGiveRecord } from "./seat-give";
import type { AxisSlot } from "./teacher-axis";

/**
 * JJ실 시수를 선생님에게 주기(원장 2026-10-07 *"회차 확정에 JJ반이 생기면 거기서 주면 그냥 쉽게 해결"*) —
 * 회차 확정의 JJ실 줄에서 날짜를 골라 준다. 여기는 **어느 행을 누구 몫으로 고칠지**의 규칙.
 */
const A = "t-a";
const B = "t-b";
const D1 = "2026-10-07"; // 수요일
const D2 = "2026-10-14"; // 수요일
const slot = (over: Partial<AxisSlot>): AxisSlot => ({ dayOfWeek: "wed", startTime: "16:20", teacherId: null, slotTeacherLabel: null, validFrom: "2026-09-01", validTo: null, ...over });
/** 수요일: 16:20 A 선생님 수업 · 17:20 JJ실 · 18:20 JJ실 · 19:20 랩실. */
const SLOTS: AxisSlot[] = [
  slot({ startTime: "16:20", teacherId: A }),
  slot({ startTime: "17:20", slotTeacherLabel: "JJ" }),
  slot({ startTime: "18:20", slotTeacherLabel: "JJ" }),
  slot({ startTime: "19:20", slotTeacherLabel: "LAB" }),
];
let seq = 0;
const rec = (over: Partial<SeatGiveRecord> = {}): SeatGiveRecord => ({
  id: `r${String(++seq).padStart(3, "0")}`, studentId: "s1", date: D1, slotStart: "17:20", seatLabel: null, recordedVia: "seat",
  taughtBy: null, status: "present", units: null, recordedAt: "2026-10-07T08:00:00Z", ...over,
});

describe("칸(학생 × 날짜)마다 JJ실 기록을 모은다", () => {
  it("JJ실 기록만 센다 — 사람 수업 · 랩실 기록은 칸에 들지 않는다", () => {
    const cells = seatGiveCells([
      rec({ id: "jj1" }),
      rec({ id: "jj2", slotStart: "18:20", units: 1.5 }),
      rec({ id: "own", slotStart: "16:20", recordedVia: null }), // A 선생님 수업
      rec({ id: "lab", slotStart: "19:20", seatLabel: "LAB" }), // 랩실
    ], SLOTS);
    expect([...cells.keys()]).toEqual([seatGiveKey("s1", D1)]);
    expect(cells.get(seatGiveKey("s1", D1))).toEqual({
      studentId: "s1", date: D1, units: 2.5, holder: null, rowIds: ["jj1", "jj2"], parts: [{ holder: null, units: 2.5, rowIds: ["jj1", "jj2"] }],
    });
  });

  it("🔴 교시마다 가장 최근 행이 그 칸의 값이다 — 귀속은 같은 교시의 옛 정정 행까지 함께 고친다", () => {
    const cells = seatGiveCells([
      rec({ id: "old", status: "absent", recordedAt: "2026-10-07T08:00:00Z" }),
      rec({ id: "new", status: "present", recordedAt: "2026-10-07T09:00:00Z" }),
    ], SLOTS);
    const cell = cells.get(seatGiveKey("s1", D1))!;
    expect(cell.units).toBe(1); // 최신(출석) 기준 — 옛 결석은 값이 아니다
    expect([...cell.rowIds].sort()).toEqual(["new", "old"]);
  });

  it("결석 칸도 칸이다(시수 0) — 표에 서야 그날 누가 빠졌는지 보인다", () => {
    const cells = seatGiveCells([rec({ status: "absent" })], SLOTS);
    expect(cells.get(seatGiveKey("s1", D1))?.units).toBe(0);
  });

  it("지금 몫 — JJ실 그대로(null) · 한 선생님 · 교시마다 다르면 mixed", () => {
    expect(seatGiveCells([rec(), rec({ slotStart: "18:20" })], SLOTS).get(seatGiveKey("s1", D1))?.holder).toBeNull();
    expect(seatGiveCells([rec({ taughtBy: A }), rec({ slotStart: "18:20", taughtBy: A })], SLOTS).get(seatGiveKey("s1", D1))?.holder).toBe(A);
    expect(seatGiveCells([rec({ taughtBy: A }), rec({ slotStart: "18:20" })], SLOTS).get(seatGiveKey("s1", D1))?.holder).toBe("mixed");
  });

  it("🔴 대신 보강 귀속(`taught_by`)이 걸린 **사람 수업** 행은 칸에 들지 않는다 — 자리 기록만 건드린다", () => {
    const cells = seatGiveCells([rec({ slotStart: "16:20", recordedVia: null, taughtBy: B })], SLOTS);
    expect(cells.size).toBe(0);
  });
});

describe("주기 · 되돌리기 계획", () => {
  const records = () => [
    rec({ id: "a1", studentId: "s1", date: D1 }),
    rec({ id: "a2", studentId: "s2", date: D1 }),
    rec({ id: "a3", studentId: "s2", date: D1, slotStart: "18:20" }),
    rec({ id: "b1", studentId: "s1", date: D2, taughtBy: A }),
  ];

  it("고른 칸의 JJ실 행만 그 선생님 몫으로 — JJ −N · 선생님 +N", () => {
    const cells = seatGiveCells(records(), SLOTS);
    const plan = planSeatGive(cells, [{ studentId: "s1", date: D1, teacherId: A }, { studentId: "s2", date: D1, teacherId: A }]);
    expect(plan.moves).toEqual([{ from: null, to: A, dates: [D1], students: 2, units: 3, ids: ["a1", "a2", "a3"] }]);
    expect(plan.changed).toBe(2);
    expect(plan.missing).toBe(0);
  });

  it("되돌리기(JJ실 그대로) · 다른 선생님으로 바꾸기도 같은 길이다", () => {
    const cells = seatGiveCells(records(), SLOTS);
    expect(planSeatGive(cells, [{ studentId: "s1", date: D2, teacherId: null }])).toMatchObject({
      moves: [{ from: A, to: null, dates: [D2], students: 1, units: 1, ids: ["b1"] }], changed: 1,
    });
    expect(planSeatGive(cells, [{ studentId: "s1", date: D2, teacherId: B }]).moves).toEqual([{ from: A, to: B, dates: [D2], students: 1, units: 1, ids: ["b1"] }]);
  });

  it("🔴 이미 그 몫인 칸은 다시 쓰지 않는다 · 그사이 기록이 사라진 칸은 건너뛰고 센다", () => {
    const cells = seatGiveCells(records(), SLOTS);
    const plan = planSeatGive(cells, [
      { studentId: "s1", date: D2, teacherId: A }, // 이미 A
      { studentId: "s1", date: D1, teacherId: null }, // 이미 JJ실
      { studentId: "s9", date: D1, teacherId: A }, // 기록 없음
    ]);
    expect(plan).toEqual({ moves: [], changed: 0, missing: 1 });
  });

  it("같은 칸을 두 번 보낸 요청은 첫 값만 쓴다", () => {
    const cells = seatGiveCells(records(), SLOTS);
    const plan = planSeatGive(cells, [{ studentId: "s1", date: D1, teacherId: B }, { studentId: "s1", date: D1, teacherId: null }]);
    expect(plan.moves).toEqual([{ from: null, to: B, dates: [D1], students: 1, units: 1, ids: ["a1"] }]);
  });

  /**
   * 🔴 교시마다 몫이 다르던 칸(17:20 = A 선생님 · 18:20 = JJ실)은 **조각마다** 실제 이전 몫으로 센다(재리뷰 2026-10-07).
   *    한 덩어리로 접으면 'JJ실 그대로'가 (JJ실 → JJ실)이 되어 A의 시수가 빠지는데도 감사로그가 한 줄도 안 남는다.
   */
  it("🔴 교시마다 몫이 다르던 칸 — JJ실로 되돌리면 A에게서 빠진 조각만 옮기고 '되돌리기'로 남는다", () => {
    const mixed = seatGiveCells([rec({ id: "m1", taughtBy: A }), rec({ id: "m2", slotStart: "18:20" })], SLOTS);
    const plan = planSeatGive(mixed, [{ studentId: "s1", date: D1, teacherId: null }]);
    expect(plan.moves).toEqual([{ from: A, to: null, dates: [D1], students: 1, units: 1, ids: ["m1"] }]);
    expect(plan.changed).toBe(1);
  });

  it("🔴 교시마다 몫이 다르던 칸 — 다른 선생님에게 주면 (A → B)와 (JJ실 → B) 두 묶음이고 시수도 조각대로다", () => {
    const mixed = seatGiveCells([rec({ id: "m1", taughtBy: A }), rec({ id: "m2", slotStart: "18:20", units: 1.5 })], SLOTS);
    const plan = planSeatGive(mixed, [{ studentId: "s1", date: D1, teacherId: B }]);
    expect(plan.moves).toEqual([
      { from: A, to: B, dates: [D1], students: 1, units: 1, ids: ["m1"] },
      { from: null, to: B, dates: [D1], students: 1, units: 1.5, ids: ["m2"] },
    ]);
    // A에게 통일하면 이미 A인 조각은 건드리지 않는다.
    expect(planSeatGive(mixed, [{ studentId: "s1", date: D1, teacherId: A }]).moves).toEqual([{ from: null, to: A, dates: [D1], students: 1, units: 1.5, ids: ["m2"] }]);
  });
});
