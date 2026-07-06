import { describe, it, expect } from "vitest";
import { assembleMathParams } from "./assemble";
import { DEFAULT_PERIODS_CONFIG, type PeriodsConfig } from "@/features/timetable/lib/periods";
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

  // 교시 설정 파생 매핑(적대리뷰 2026-07-06) — 기본 설정=하드코딩 상수와 동일 산출(회귀 0),
  // 커스텀 교시는 슬롯이 조용히 증발하지 않고(파생 맵으로 배치) 실패분은 onSkippedSlots로 알림.
  describe("periodsConfig 파생 매핑", () => {
    it("기본 설정(DEFAULT_PERIODS_CONFIG) = config 미전달과 동일 산출(회귀 카나리)", () => {
      const slots = [
        slot({ dayOfWeek: "mon", startTime: "16:20:00" }),
        slot({ classId: "c2", dayOfWeek: "sat", startTime: "09:00:00" }),
      ];
      const without = assembleMathParams(slots, { referenceMonday: MON });
      const withCfg = assembleMathParams(slots, { referenceMonday: MON, periodsConfig: DEFAULT_PERIODS_CONFIG });
      expect(withCfg.filteredClasses.map((c) => c.schedule)).toEqual(without.filteredClasses.map((c) => c.schedule));
      expect(withCfg.currentPeriods).toEqual(without.currentPeriods);
    });

    it("커스텀 교시 시각 = 파생 맵으로 배치(하드코딩이면 증발했을 슬롯)", () => {
      const custom: PeriodsConfig = {
        ...DEFAULT_PERIODS_CONFIG,
        weekday: { "1": { startTime: "15:00", endTime: "15:50" }, "2": { startTime: "15:50", endTime: "16:40" } },
      };
      const p = assembleMathParams([slot({ dayOfWeek: "mon", startTime: "15:00:00" })], {
        referenceMonday: MON,
        periodsConfig: custom,
      });
      expect(p.filteredClasses[0].schedule).toContain("월 1-1"); // 커스텀 1교시 15:00 → 1-1
    });

    it("매핑 실패 슬롯은 onSkippedSlots로 카운트 통지(무에러 증발 금지)", () => {
      let skipped = 0;
      const p = assembleMathParams(
        [slot({ dayOfWeek: "mon", startTime: "13:13:00" })], // 어떤 교시 시작과도 불일치
        { referenceMonday: MON, periodsConfig: DEFAULT_PERIODS_CONFIG, onSkippedSlots: (n) => (skipped = n) },
      );
      expect(skipped).toBe(1);
      expect(p.filteredClasses).toHaveLength(0);
    });
  });
});
