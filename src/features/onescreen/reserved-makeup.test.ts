import { describe, expect, it } from "vitest";
import type { MakeupReservation } from "@/features/attendance/makeup-reservation";
import { applyReservedMakeup, planReservedMakeup, reservedShownDone, reservedTimeText, studentReservations } from "./reserved-makeup";
import type { OneScreenStudent, Subject } from "./types";

const res = (over: Partial<MakeupReservation> = {}): MakeupReservation => ({
  id: "r1", studentId: "s1", classId: "BS2G", absenceDate: "2026-09-21", makeupDate: "2026-10-22",
  slotStart: "15:25", slotEnd: "16:20", periodLabel: "1-2", note: null, status: "reserved", createdBy: null, ...over,
});
const card = (subjects: Partial<Subject>[]): OneScreenStudent =>
  ({ id: "s1", name: "전주율", subjects: subjects.map((s) => ({ name: "수학", prev: "", today: "", ...s })) }) as unknown as OneScreenStudent;
const regular = new Set(["s1|BS2G"]);

describe("planReservedMakeup", () => {
  it("정규 수업일 · 묻지 않은 옛 예약(null) = 합침(그 예약들이 실제로 정규 칸에 합쳐져 돌았다)", () => {
    const plan = planReservedMakeup([res()], regular);
    expect([...plan.merge]).toEqual(["s1|BS2G"]);
    expect(plan.separate).toEqual([]);
    expect(plan.byKey.get("s1|BS2G")).toEqual([{ start: "15:25", end: "16:20", absenceDate: "2026-09-21", mode: "merge", done: false, date: "2026-10-22" }]);
  });
  it("정규 수업일 · 분리 = 정규 줄과 따로 '(보강)' 줄(같은 반 예약 둘이어도 한 줄)", () => {
    const plan = planReservedMakeup([res({ reportMode: "separate" }), res({ id: "r2", slotStart: "14:30", slotEnd: "15:25", reportMode: "separate" })], regular);
    expect(plan.merge.size).toBe(0);
    expect(plan.separate).toEqual([{ studentId: "s1", classId: "BS2G" }]);
    expect(plan.byKey.get("s1|BS2G")?.map((r) => r.start)).toEqual(["14:30", "15:25"]);
  });
  it("정규 수업일이 아니면 고른 방식과 상관없이 분리(합칠 정규 보고서가 없다) — 줄은 종전 예약 루프가 세운다", () => {
    const plan = planReservedMakeup([res({ classId: "JJ2B", reportMode: "merge" })], regular);
    expect(plan.merge.size).toBe(0);
    expect(plan.separate).toEqual([]);
    expect(plan.byKey.get("s1|JJ2B")?.[0]?.mode).toBe("separate");
  });
  it("이행분도 표식에 남는다('보강 완료') — 출석 뒤 새로고침에 합침이 풀리지 않게", () => {
    const plan = planReservedMakeup([res({ status: "done" })], regular);
    expect(plan.merge.has("s1|BS2G")).toBe(true);
    expect(plan.byKey.get("s1|BS2G")?.[0]?.done).toBe(true);
  });
});

describe("applyReservedMakeup", () => {
  it("합침 = 정규 줄 '정규+보강' + 예약에서 왔다는 표시(합침 취소 대신 예약을 바꾸게)", () => {
    const os = card([{ classId: "BS2G", makeup: false, attendanceRaw: null }]);
    applyReservedMakeup(os, planReservedMakeup([res()], regular));
    expect(os.subjects[0]).toMatchObject({ makeup: true, makeupByReservation: true });
    expect(os.subjects[0]?.makeupReserved).toHaveLength(1);
  });
  it("결석·공결인 날은 합치지 않는다(보강 추가의 합침 조건과 같다) — 표식만", () => {
    for (const raw of ["absent", "excused", "makeup"]) {
      const os = card([{ classId: "BS2G", makeup: false, attendanceRaw: raw }]);
      applyReservedMakeup(os, planReservedMakeup([res()], regular));
      expect(os.subjects[0]?.makeup).toBe(false);
      expect(os.subjects[0]?.makeupReserved).toHaveLength(1);
    }
  });
  it("출석·지각·조퇴는 합친다", () => {
    for (const raw of ["present", "late", "early_leave"]) {
      const os = card([{ classId: "BS2G", makeup: false, attendanceRaw: raw }]);
      applyReservedMakeup(os, planReservedMakeup([res()], regular));
      expect(os.subjects[0]?.makeup).toBe(true);
    }
  });
  it("분리 = 정규 줄은 정규 그대로 · 표식은 정규 줄과 '(보강)' 줄 둘 다", () => {
    const os = card([
      { classId: "BS2G", makeup: false, attendanceRaw: null },
      { name: "수학 (보강)", classId: null, makeup: true, makeupClassId: "BS2G" },
    ]);
    applyReservedMakeup(os, planReservedMakeup([res({ reportMode: "separate" })], regular));
    expect(os.subjects[0]?.makeup).toBe(false);
    expect(os.subjects[0]?.makeupByReservation).toBeUndefined();
    expect(os.subjects[0]?.makeupReserved).toHaveLength(1);
    expect(os.subjects[1]?.makeupReserved).toHaveLength(1);
    // 왼쪽 목록은 한 학생에 한 번
    expect(studentReservations(os)).toHaveLength(1);
  });
  it("다른 반 줄·나눔 받는 줄은 건드리지 않는다", () => {
    const os = card([{ classId: "JJ2G", makeup: false }, { classId: "BS2G", splitIn: "나눔", makeup: false }]);
    applyReservedMakeup(os, planReservedMakeup([res()], regular));
    expect(os.subjects.every((s) => !s.makeup && !s.makeupReserved)).toBe(true);
  });
});

describe("reservedTimeText", () => {
  it("한 건은 시각, 여러 건은 앞 것 + 건수", () => {
    const one = planReservedMakeup([res()], regular).byKey.get("s1|BS2G")!;
    expect(reservedTimeText(one)).toBe("15:25~16:20");
    const two = planReservedMakeup([res(), res({ id: "r2", slotStart: "16:20", slotEnd: "17:15" })], regular).byKey.get("s1|BS2G")!;
    expect(reservedTimeText(two)).toBe("15:25~16:20 +1");
  });
});

// 원장 2026-10-27 — BS2P 정규 16:20~18:10. 권민서A 보강 18:20~19:15(정규 뒤) · 박지호 보강 15:25~16:20(정규 앞). 16:24에 정규 출석을 찍으면 둘 다 이행된다.
describe("reservedShownDone — '보강 완료'는 끝 시각이 지나야", () => {
  const booked = (over: Partial<{ start: string; end: string; done: boolean; date?: string }> = {}) => ({
    start: "18:20", end: "19:15", absenceDate: "2026-10-02", mode: "merge" as const, done: true, date: "2026-10-27", ...over,
  });
  it("🔴 정규 뒤 보강(권민서A) — 16:24 출석으로 이행됐어도 19:15 전엔 완료가 아니다", () => {
    expect(reservedShownDone([booked()], "2026-10-27T16:24")).toBe(false);
    expect(reservedShownDone([booked()], "2026-10-27T19:14")).toBe(false);
    expect(reservedShownDone([booked()], "2026-10-27T19:15")).toBe(true);
    expect(reservedShownDone([booked()], "2026-10-28T09:00")).toBe(true);
  });
  it("정규 앞 보강(박지호) — 정규 출석 때는 이미 끝났다", () => {
    expect(reservedShownDone([booked({ start: "15:25", end: "16:20" })], "2026-10-27T16:24")).toBe(true);
  });
  it("이행 전이면 시간이 지나도 완료가 아니다 · 시계 전(null)이면 지나지 않은 것으로 · 날짜 없는 옛 값은 이행만 본다", () => {
    expect(reservedShownDone([booked({ done: false })], "2026-10-28T09:00")).toBe(false);
    expect(reservedShownDone([booked()], null)).toBe(false);
    expect(reservedShownDone([booked({ date: undefined })], null)).toBe(true);
    expect(reservedShownDone([], "2026-10-28T09:00")).toBe(false);
  });
  it("여러 건이면 전부 끝나야 완료", () => {
    const two = [booked({ start: "15:25", end: "16:20" }), booked()];
    expect(reservedShownDone(two, "2026-10-27T16:24")).toBe(false);
    expect(reservedShownDone(two, "2026-10-27T19:20")).toBe(true);
  });
});
