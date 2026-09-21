import { describe, expect, it } from "vitest";
import { buildHomeroomHistoryIndex, homeroomTeacherOnDate, homeroomTeachersInRange, type TeacherTransition } from "@/features/classes/teacher-as-of";
import { ownsAttendanceSlot, teachesClassOn, type AxisSlot } from "./teacher-axis";

const transition = (date: string, teacherId: string, previousTeacherId?: string): TeacherTransition => ({ classId: "c", date, teacherId, previousTeacherId, teacherName: teacherId });
const history = buildHomeroomHistoryIndex([transition("2026-08-10", "kim"), transition("2026-09-21", "heo")]).get("c")!;
const slots: AxisSlot[] = [{ dayOfWeek: "thu", startTime: "15:25", teacherId: null, slotTeacherLabel: null, validFrom: "2026-03-01", validTo: null }];
const input = (teacher: string, date: string, slotStart: string | null = null) => ({ scopeTeacherId: teacher, homeroomTeacherId: "heo", homeroomHistory: history, slots, date, slotStart });

describe("담임 인계 후에도 이전 담당 기간의 출결은 남는다", () => {
  it("조회 기간과 겹치는 이전 담임을 목록에 포함하고 다음 달에서는 뺀다", () => {
    expect(homeroomTeachersInRange(history, "2026-09-01", "2026-09-30")).toEqual(["kim", "heo"]);
    expect(homeroomTeachersInRange(history, "2026-10-01", "2026-10-31")).toEqual(["heo"]);
    expect(homeroomTeachersInRange(history, "2026-08-01", "2026-08-31")).toEqual(["kim"]);
  });
  it.each([null, "15:25"])("일별/교시별 기록 %s: 김주현은 인계 전, 허은진은 인계 후만 집계", (slot) => {
    expect(ownsAttendanceSlot(input("kim", "2026-09-17", slot))).toBe(true);
    expect(ownsAttendanceSlot(input("heo", "2026-09-17", slot))).toBe(false);
    expect(ownsAttendanceSlot(input("kim", "2026-09-21", slot))).toBe(false);
    expect(ownsAttendanceSlot(input("heo", "2026-09-21", slot))).toBe(true);
  });
  it("보고서 파생 출결도 인계 전후를 구분한다", () => {
    expect(teachesClassOn(input("kim", "2026-09-17"))).toBe(true);
    expect(teachesClassOn(input("heo", "2026-09-17"))).toBe(false);
    expect(teachesClassOn(input("kim", "2026-09-24"))).toBe(false);
    expect(teachesClassOn(input("heo", "2026-09-24"))).toBe(true);
  });
  it("담임 A → B → A 재인계 시 첫 번째 A의 기록도 보존한다", () => {
    const h = buildHomeroomHistoryIndex([transition("2026-09-01", "a"), transition("2026-09-10", "b"), transition("2026-09-21", "a")]).get("c")!;
    const base = { ...input("a", "2026-09-04"), homeroomTeacherId: "a", homeroomHistory: h, homeroomSince: "2026-09-21" };
    expect(ownsAttendanceSlot(base)).toBe(true);
    expect(ownsAttendanceSlot({ ...base, date: "2026-09-14" })).toBe(false);
    expect(ownsAttendanceSlot({ ...base, date: "2026-09-22" })).toBe(true);
  });
  it("인계 후에도 별도 교시를 맡으면 그 교시만 계속 보인다", () => {
    const ownSlots = [{ ...slots[0]!, teacherId: "kim", validFrom: "2026-09-21" }, { ...slots[0]!, startTime: "16:20", validFrom: "2026-09-21" }];
    expect(ownsAttendanceSlot({ ...input("kim", "2026-09-24", "15:25"), slots: ownSlots })).toBe(true);
    expect(ownsAttendanceSlot({ ...input("kim", "2026-09-24", "16:20"), slots: ownSlots })).toBe(false);
  });
  it("교체 직전 담당이 보존된 최초 인계와 보완 로그를 읽는다", () => {
    const h = buildHomeroomHistoryIndex([transition("2026-09-21", "heo"), transition("2026-09-21", "heo", "kim")]).get("c")!;
    expect(homeroomTeacherOnDate(h, "heo", "2026-09-17")).toBe("kim");
    expect(homeroomTeacherOnDate(h, "heo", "2026-09-21")).toBe("heo");
  });
  it("예약·이력 없는 반은 현재 배정을 그대로 쓰고 자리 기록은 합산하지 않는다", () => {
    expect(homeroomTeacherOnDate([], "heo", "2026-09-17")).toBe("heo");
    expect(ownsAttendanceSlot({ ...input("kim", "2026-09-17"), recordedVia: "seat" })).toBe(false);
  });
});
