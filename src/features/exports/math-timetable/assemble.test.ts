import { describe, it, expect } from "vitest";
import { assembleMathParams } from "./assemble";
import type { ScheduleSlotWithStudents, StudentLine } from "@/features/timetable/server/queries";

function student(over: Partial<StudentLine> & { studentId: string; name: string }): StudentLine {
  return {
    grade: null,
    school: null,
    status: "active",
    ...over,
  } as StudentLine;
}

function slot(over: Partial<ScheduleSlotWithStudents>): ScheduleSlotWithStudents {
  return {
    id: "s",
    classId: "c1",
    className: "수학 A",
    subject: "math",
    dayOfWeek: "mon",
    startTime: "14:30:00",
    endTime: "15:25:00",
    teacherName: "김선생",
    classroomName: "304",
    studentCount: 0,
    slotTeacherLabel: null,
    slotRoomLabel: null,
    classBgColor: null,
    classTextColor: null,
    students: [],
    ...over,
  } as ScheduleSlotWithStudents;
}

const MON = new Date(2026, 5, 22); // 2026-06-22 (월)

describe("assembleMathParams", () => {
  it("math 슬롯만 포함(영어 제외)", () => {
    const p = assembleMathParams(
      [slot({ classId: "m", subject: "math" }), slot({ classId: "e", subject: "english" })],
      { referenceMonday: MON },
    );
    expect(p.filteredClasses.map((c) => c.id)).toEqual(["m"]);
  });

  it("평일 시각 → periodId, schedule 포맷 '월 1-1'", () => {
    const p = assembleMathParams([slot({ dayOfWeek: "mon", startTime: "16:20:00" })], { referenceMonday: MON });
    expect(p.filteredClasses[0].schedule).toContain("월 2-1"); // 16:20 = 2-1
    expect(p.currentPeriods).toContain("2-1");
  });

  it("주말 시각 → periodId(주말표 기준)", () => {
    const p = assembleMathParams([slot({ dayOfWeek: "sat", startTime: "09:00:00" })], { referenceMonday: MON });
    expect(p.filteredClasses[0].schedule).toContain("토 1-1"); // 주말 09:00 = 1-1
    expect(p.orderedSelectedDays).toContain("토");
  });

  it("slotTeacherLabel → slotTeachers['월-1'] (unified period)", () => {
    const p = assembleMathParams(
      [slot({ dayOfWeek: "mon", startTime: "14:30:00", slotTeacherLabel: "LAB", slotRoomLabel: "본원604" })],
      { referenceMonday: MON },
    );
    expect(p.filteredClasses[0].slotTeachers?.["월-1"]).toBe("LAB"); // 1-1 → unified 1
    expect(p.filteredClasses[0].slotRooms?.["월-1"]).toBe("본원604");
    expect(p.allResources).toContain("LAB"); // 셀 강사라벨이 리소스 컬럼
  });

  it("학생 상태/등원요일 매핑(Korean 변환·withdrawal·hold)", () => {
    const p = assembleMathParams(
      [
        slot({
          students: [
            student({ studentId: "a", name: "재원생", attendanceDays: ["mon", "thu"], enrollmentDate: "2026-06-01" }),
            student({ studentId: "b", name: "대기생", status: "hold" }),
            student({ studentId: "w", name: "퇴원생", status: "withdrawn", endDate: "2026-06-10" }),
          ],
        }),
      ],
      { referenceMonday: MON },
    );
    const list = p.filteredClasses[0].studentList!;
    const a = list.find((s) => s.name === "재원생")!;
    expect(a.attendanceDays).toEqual(["월", "목"]); // mon/thu → 월/목
    expect(a.enrollmentDate).toBe("2026-06-01");
    const b = list.find((s) => s.name === "대기생")!;
    expect(b.onHold).toBe(true);
    const w = list.find((s) => s.name === "퇴원생")!;
    expect(w.withdrawalDate).toBe("2026-06-10");
    expect(w.isTransferred).toBe(false);
  });

  it("반색·과목라벨·referenceDate 전달", () => {
    const p = assembleMathParams([slot({ classBgColor: "#2563EB", classTextColor: "#FFFFFF" })], {
      referenceMonday: MON,
    });
    expect(p.filteredClasses[0].bgColor).toBe("#2563EB");
    expect(p.subjectFilter).toBe("수학");
    expect(p.referenceDate).toBe("2026-06-22");
  });

  it("강사색 주입(teacherColors)", () => {
    const p = assembleMathParams([slot({ teacherName: "김선생" })], {
      referenceMonday: MON,
      teacherColors: { 김선생: { bgColor: "#111111", textColor: "#eeeeee" } },
    });
    const t = p.teachers.find((x) => x.name === "김선생");
    expect(t?.bgColor).toBe("#111111");
  });

  it("진도/교재 → studentMemoMap(이름 키)", () => {
    const p = assembleMathParams(
      [
        slot({
          students: [
            student({
              studentId: "a",
              name: "권나연",
              latestReport: { date: "2026-03-19", progress: "함수 단원", examInfo: null, homeworkScore: null, teacherName: null },
              latestTextbook: { name: "쎈 수학", date: "2026-06-15" },
            }),
          ],
        }),
      ],
      { referenceMonday: MON },
    );
    expect(p.studentMemoMap?.["권나연"]).toContain("쎈 수학");
    expect(p.studentMemoMap?.["권나연"]).toContain("함수 단원");
  });
});
