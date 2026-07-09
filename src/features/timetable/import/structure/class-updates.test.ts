import { describe, it, expect } from "vitest";
import { buildClassUpdates } from "./class-updates";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import type { ExistingContext, MatchResult, ResolvedSlot } from "./types";

function slot(p: {
  classId: string; className?: string; day: DayOfWeek; startTime: string;
  teacherName?: string; teacherId?: string | null; classroomId?: string | null;
}): ResolvedSlot {
  return {
    teacherIndex: 1, teacherName: p.teacherName ?? "Jane", teacherHeader: p.teacherName ?? "Jane",
    day: p.day, koDay: "월", className: p.className ?? "반", room: null,
    startTime: p.startTime, endTime: "15:00", rawTimeLabel: "", starred: false, raw: "",
    grid: { r1: 0, c1: 0, r2: 0, c2: 0 },
    classId: p.classId, teacherId: p.teacherId ?? null, classroomId: p.classroomId ?? null,
  };
}
function ctxOf(classes: { id: string; teacherId?: string | null; classroomId?: string | null }[]): ExistingContext {
  return {
    classes: classes.map((c) => ({ id: c.id, className: c.id, subject: "english", teacherId: c.teacherId ?? null, classroomId: c.classroomId ?? null })),
    teachers: [], classrooms: [],
  };
}
function match(resolved: ResolvedSlot[]): MatchResult {
  return { resolved, newClassNames: [], newTeacherNames: [], newRoomNames: [], matchedClasses: 0, matchedTeachers: 0, matchedRooms: 0 };
}

describe("buildClassUpdates — 변경된 반만 갱신(수학과 동일 원칙)", () => {
  it("changedClassIds에 없는 반은 담임 드리프트가 있어도 건드리지 않음", () => {
    // c1: 담임 t9(현재) vs 시트 modal Jane=t1 → 드리프트 있음. 하지만 c1은 변경 대상 아님.
    // c2: 변경 대상 + 담임 드리프트 → 갱신.
    const m = match([
      slot({ classId: "c1", day: "mon", startTime: "15:00", teacherName: "Jane", teacherId: "t1" }),
      slot({ classId: "c2", day: "tue", startTime: "16:00", teacherName: "Anna", teacherId: "t2" }),
    ]);
    const ctx = ctxOf([{ id: "c1", teacherId: "t9" }, { id: "c2", teacherId: "t9" }]);
    const updates = buildClassUpdates(m, ctx, new Set(["c2"])); // c2만 변경 대상
    expect(updates).toHaveLength(1);
    expect(updates[0]!.classId).toBe("c2");
    expect(updates[0]!.teacherId).toBe("t2");
    expect(updates[0]!.prevTeacherId).toBe("t9");
  });

  it("변경 대상이라도 modal이 현재와 같으면 미포함(불필요 쓰기 없음)", () => {
    const m = match([slot({ classId: "c1", day: "mon", startTime: "15:00", teacherName: "Jane", teacherId: "t1" })]);
    const ctx = ctxOf([{ id: "c1", teacherId: "t1" }]); // 이미 t1
    expect(buildClassUpdates(m, ctx, new Set(["c1"]))).toHaveLength(0);
  });

  it("changedClassIds가 비면 아무 반도 갱신 안 함", () => {
    const m = match([slot({ classId: "c1", day: "mon", startTime: "15:00", teacherName: "Jane", teacherId: "t1" })]);
    const ctx = ctxOf([{ id: "c1", teacherId: "t9" }]);
    expect(buildClassUpdates(m, ctx, new Set())).toHaveLength(0);
  });

  it("강의실 최빈값 변경도 감지(teacherId=null 미변경, classroomId만)", () => {
    const m = match([
      slot({ classId: "c1", day: "mon", startTime: "15:00", teacherName: "Jane", teacherId: "t1", classroomId: "r2" }),
      slot({ classId: "c1", day: "wed", startTime: "15:00", teacherName: "Jane", teacherId: "t1", classroomId: "r2" }),
    ]);
    const ctx = ctxOf([{ id: "c1", teacherId: "t1", classroomId: "r1" }]); // 담임 동일, 강의실만 r1→r2
    const u = buildClassUpdates(m, ctx, new Set(["c1"]));
    expect(u).toHaveLength(1);
    expect(u[0]!.teacherId).toBeNull(); // 담임 미변경
    expect(u[0]!.classroomId).toBe("r2");
    expect(u[0]!.prevClassroomId).toBe("r1");
  });
});
