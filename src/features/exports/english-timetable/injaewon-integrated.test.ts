import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { DEFAULT_PERIODS_CONFIG } from "@/features/timetable/lib/periods";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import { appendInjaewonIntegratedSheet } from "./injaewon-integrated-sheet";

function slot(
  p: {
    classId: string;
    className: string;
    day: string;
    start: string;
    end: string;
    label?: string | null;
    teacher?: string | null;
    room?: string | null;
    students?: ScheduleSlotWithStudents["students"];
  },
): ScheduleSlotWithStudents {
  return {
    id: `${p.classId}-${p.day}-${p.start}`,
    classId: p.classId,
    className: p.className,
    subject: "english",
    dayOfWeek: p.day,
    startTime: `${p.start}:00`,
    endTime: `${p.end}:00`,
    teacherName: p.teacher ?? null,
    classroomName: null,
    studentCount: 0,
    slotTeacherLabel: p.label ?? null,
    slotRoomLabel: p.room ?? null,
    classBgColor: null,
    classTextColor: null,
    pendingHandover: null,
    students: p.students ?? [],
  } as ScheduleSlotWithStudents;
}

const students = [
  { name: "신지민", grade: "2", school: "종로초", studentId: "s1", status: "active", englishName: "Jenny" },
  { name: "김하윤", grade: "1", school: "침산초", studentId: "s2", status: "active", englishName: "Hanny" },
  { name: "박대기", grade: "3", school: "칠성초", studentId: "s3", status: "hold", englishName: null },
  { name: "이퇴원", grade: "4", school: "달성초", studentId: "s4", status: "withdrawn", englishName: null },
] as ScheduleSlotWithStudents["students"];

function fixture(): ScheduleSlotWithStudents[] {
  // DP5: 매일 14:20~15:00(교시1), Anna, 602. LT2: 월수목 14:20~16:20(교시1-3), Anna, 605. LAB 한 셀.
  const out: ScheduleSlotWithStudents[] = [];
  for (const d of ["mon", "tue", "wed", "thu", "fri"])
    out.push(slot({ classId: "dp5", className: "DP5", day: d, start: "14:20", end: "15:00", label: "Anna", teacher: "Anna", room: "602", students }));
  for (const d of ["mon", "wed", "thu"]) {
    out.push(slot({ classId: "lt2", className: "LT2", day: d, start: "14:20", end: "15:00", label: "Anna", teacher: "Anna", room: "605", students }));
    out.push(slot({ classId: "lt2", className: "LT2", day: d, start: "15:00", end: "15:40", label: "LAB", teacher: "Anna", room: null, students }));
  }
  return out;
}

describe("인재원 통합영어시간표 익스포터", () => {
  it("원본 형식 구조 — 타이틀·섹션·반헤더·교시셀(강사↵방)·LAB·명단·정원/인원/퇴원수", () => {
    const wb = new ExcelJS.Workbook();
    appendInjaewonIntegratedSheet(wb, fixture(), {
      config: DEFAULT_PERIODS_CONFIG,
      capacityByClassId: { dp5: 8, lt2: 8 },
      title: "인재원 본원 통합 영어시간표",
    });
    const sheet = wb.getWorksheet("통합영어시간표")!;
    expect(sheet).toBeTruthy();

    const vals: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === "string") vals.push(cell.value);
    }));
    const joined = vals.join(" | ");

    expect(joined).toContain("인재원 본원 통합 영어시간표"); // 타이틀
    expect(joined).toContain("오후 2:20"); // 섹션 라벨
    expect(vals.some((v) => v.includes("DP5") && v.includes("2:20") && v.includes("(Anna)"))).toBe(true); // 반 헤더
    expect(vals.some((v) => v.includes("Anna") && v.includes("602"))).toBe(true); // 교시 셀 강사+방
    expect(joined).toContain("LAB");
    expect(joined).toContain("신지민(Jenny)"); // 재원 명단(영문)
    expect(joined).toContain("정원");
    expect(joined).toContain("인원");
    expect(joined).toContain("퇴원수");
    expect(joined).toContain("이퇴원"); // 퇴원생 명단
  });
});
