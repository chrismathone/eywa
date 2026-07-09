import { describe, it, expect } from "vitest";
import { computeStructureDiff } from "./diff";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import type { ExistingSchedule, MatchResult, ResolvedSlot } from "./types";

// ResolvedSlot 팩토리(테스트용 최소 필드).
function slot(p: {
  classId: string | null; className: string; day: DayOfWeek; startTime: string; endTime: string;
  room?: string | null; teacherName?: string; teacherId?: string | null;
}): ResolvedSlot {
  return {
    teacherIndex: 1, teacherName: p.teacherName ?? "Jane", teacherHeader: p.teacherName ?? "Jane",
    day: p.day, koDay: "월", className: p.className, room: p.room ?? null,
    startTime: p.startTime, endTime: p.endTime, rawTimeLabel: "", starred: false, raw: "",
    grid: { r1: 0, c1: 0, r2: 0, c2: 0 },
    classId: p.classId, teacherId: p.teacherId ?? null, classroomId: null,
  };
}
function existing(p: {
  id: string; classId: string; className: string; day: DayOfWeek; startTime: string; endTime: string;
  slotTeacherLabel?: string | null; slotRoomLabel?: string | null;
}): ExistingSchedule {
  return {
    id: p.id, classId: p.classId, className: p.className, day: p.day, startTime: p.startTime, endTime: p.endTime,
    teacherId: null, classroomId: null, slotTeacherLabel: p.slotTeacherLabel ?? null,
    slotRoomLabel: p.slotRoomLabel ?? null, mergeGroup: null, validFrom: "2026-07-01", validTo: null,
  };
}
function match(resolved: ResolvedSlot[], newClassNames: string[] = []): MatchResult {
  return { resolved, newClassNames, newTeacherNames: [], newRoomNames: [], matchedClasses: 0, matchedTeachers: 0, matchedRooms: 0 };
}

describe("computeStructureDiff — create/update/keep/remove 분류", () => {
  const m = match(
    [
      slot({ classId: "c1", className: "A반", day: "mon", startTime: "15:00", endTime: "15:40", room: "301", teacherName: "Jane" }), // keep
      slot({ classId: "c1", className: "A반", day: "tue", startTime: "16:00", endTime: "17:00", room: "302", teacherName: "Jane" }), // update(end)
      slot({ classId: "c2", className: "B반", day: "wed", startTime: "15:00", endTime: "15:40", room: "303", teacherName: "Anna" }), // create
      slot({ classId: null, className: "새반", day: "fri", startTime: "15:00", endTime: "15:40" }), // 신규 반(제외+경고)
    ],
    ["새반"],
  );
  const ex = [
    existing({ id: "s1", classId: "c1", className: "A반", day: "mon", startTime: "15:00", endTime: "15:40", slotTeacherLabel: "Jane", slotRoomLabel: "301" }), // = keep
    existing({ id: "s2", classId: "c1", className: "A반", day: "tue", startTime: "16:00", endTime: "16:40", slotTeacherLabel: "Jane", slotRoomLabel: "302" }), // end 16:40→17:00 update
    existing({ id: "s3", classId: "c1", className: "A반", day: "thu", startTime: "15:00", endTime: "15:40", slotTeacherLabel: "Jane", slotRoomLabel: "301" }), // 시트에 없음 → remove
  ];
  const d = computeStructureDiff(m, ex);

  it("plan 카운트", () => {
    expect(d.plan).toEqual({ create: 1, update: 1, keep: 1, remove: 1 });
  });
  it("update는 이전값(before) 보유", () => {
    const u = d.planItems.find((p) => p.action === "update");
    expect(u?.className).toBe("A반");
    expect(u?.before?.endTime).toBe("16:40");
    expect(u?.endTime).toBe("17:00");
  });
  it("remove는 기존 scheduleId 지정", () => {
    const r = d.planItems.find((p) => p.action === "remove");
    expect(r?.scheduleId).toBe("s3");
    expect(r?.day).toBe("thu");
  });
  it("신규 반은 적용 제외 + 경고", () => {
    expect(d.entitiesToCreate.classes).toContain("새반");
    expect(d.planItems.some((p) => p.className === "새반")).toBe(false);
    expect(d.warnings.some((w) => w.includes("새반"))).toBe(true);
  });
  it("방/강사 변경도 update로 감지", () => {
    const m2 = match([slot({ classId: "c1", className: "A반", day: "mon", startTime: "15:00", endTime: "15:40", room: "999", teacherName: "Dom" })]);
    const d2 = computeStructureDiff(m2, [ex[0]!]);
    expect(d2.plan.update).toBe(1);
  });
  it("변경분 hash는 결정적(같은 입력 = 같은 해시)", () => {
    expect(computeStructureDiff(m, ex).hash).toBe(d.hash);
  });
});
