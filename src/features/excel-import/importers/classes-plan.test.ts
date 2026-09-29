import { describe, expect, it } from "vitest";
import { addDays, detectSlotConflicts, isLiveOn, normalizeDays, periodsOverlap, planScheduleReplace, sameSchedule, type SlotShape } from "./classes-plan";

const slot = (day: string, start: string, end = "17:00", teacher: string | null = "t1"): SlotShape => ({
  day, start, end, teacher, room: null, teacherLabel: null, roomLabel: null,
});

describe("classes-plan", () => {
  it("addDays는 월·해를 넘긴다", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("sameSchedule — 순서 무관, 내용이 하나라도 다르면 다름", () => {
    expect(sameSchedule([slot("mon", "16:00"), slot("wed", "16:00")], [slot("wed", "16:00"), slot("mon", "16:00")])).toBe(true);
    expect(sameSchedule([slot("mon", "16:00")], [slot("mon", "16:00", "17:30")])).toBe(false);
    expect(sameSchedule([slot("mon", "16:00")], [slot("mon", "16:00", "17:00", "t2")])).toBe(false);
    expect(sameSchedule([slot("mon", "16:00")], [slot("mon", "16:00"), slot("mon", "16:00")])).toBe(false);
  });

  it("planScheduleReplace — 끝난 이력은 두고, 걸친 행은 닫고, 뒤에 시작하는 행은 지운다", () => {
    const rows = [
      { id: "old", valid_from: "2026-03-01", valid_to: "2026-08-31" },
      { id: "live", valid_from: "2026-09-01", valid_to: null },
      { id: "future", valid_from: "2026-10-05", valid_to: null },
      { id: "same-day", valid_from: "2026-10-01", valid_to: null },
    ];
    expect(planScheduleReplace(rows, "2026-10-01")).toEqual({ close: ["live"], remove: ["future", "same-day"] });
  });

  it("isLiveOn — valid_to 당일 포함", () => {
    expect(isLiveOn({ valid_from: "2026-09-01", valid_to: "2026-09-30" }, "2026-09-30")).toBe(true);
    expect(isLiveOn({ valid_from: "2026-09-01", valid_to: "2026-09-30" }, "2026-10-01")).toBe(false);
    expect(isLiveOn({ valid_from: "2026-10-02", valid_to: null }, "2026-10-01")).toBe(false);
  });

  it("normalizeDays — 운영 요일 안으로, 전 요일이면 []", () => {
    const days = new Set(["mon", "wed", "fri"]);
    expect(normalizeDays(["wed", "mon"], days)).toEqual({ days: ["mon", "wed"], outside: [] });
    expect(normalizeDays(["mon", "wed", "fri"], days)).toEqual({ days: [], outside: [] });
    expect(normalizeDays(["tue", "mon"], days)).toEqual({ days: ["mon"], outside: ["tue"] });
    expect(normalizeDays(["mon"], new Set())).toEqual({ days: [], outside: [] });
  });

  it("periodsOverlap — 반열림(끝나는 날 시작은 안 겹침)", () => {
    expect(periodsOverlap("2026-09-01", "2026-09-10", "2026-09-10", null)).toBe(false);
    expect(periodsOverlap("2026-09-01", null, "2026-12-01", null)).toBe(true);
  });

  describe("detectSlotConflicts", () => {
    const t = (classId: string, o: Partial<Parameters<typeof detectSlotConflicts>[0][number]> = {}) => ({
      classId, day: "mon", start: "16:00", end: "17:00", teacherId: "T", roomId: "R1", rowNum: 2, ...o,
    });
    const kinds = (xs: ReturnType<typeof detectSlotConflicts>) => xs.map((c) => c.kind);

    it("같은 강사가 다른 강의실에 동시에 = teacher", () => {
      expect(kinds(detectSlotConflicts([t("A"), t("B", { roomId: "R2", rowNum: null })]))).toEqual(["teacher"]);
    });
    it("같은 강의실에 다른 강사 = room", () => {
      expect(kinds(detectSlotConflicts([t("A"), t("B", { teacherId: "U", rowNum: null })]))).toEqual(["room"]);
    });
    it("같은 강사·같은 강의실 = merged(합반, 막지 않음)", () => {
      expect(kinds(detectSlotConflicts([t("A"), t("B", { rowNum: null })]))).toEqual(["merged"]);
    });
    it("한 반이 같은 요일 겹치는 두 칸 = duplicate", () => {
      expect(kinds(detectSlotConflicts([t("A"), t("A", { start: "16:30", end: "17:30", rowNum: 3 })]))).toEqual(["duplicate"]);
    });
    it("시각이 맞닿기만 하거나 요일이 다르면 충돌 아님", () => {
      expect(detectSlotConflicts([t("A"), t("B", { start: "17:00", end: "18:00", roomId: "R2" })])).toEqual([]);
      expect(detectSlotConflicts([t("A"), t("B", { day: "tue", roomId: "R2" })])).toEqual([]);
    });
    it("파일 칸이 안 낀 옛 충돌은 알리지 않는다", () => {
      expect(detectSlotConflicts([t("A", { rowNum: null }), t("B", { roomId: "R2", rowNum: null })])).toEqual([]);
    });
    it("자리(강사·강의실 null)는 충돌이 아니다", () => {
      expect(detectSlotConflicts([t("A", { teacherId: null, roomId: null }), t("B", { teacherId: null, roomId: null })])).toEqual([]);
    });
  });
});
