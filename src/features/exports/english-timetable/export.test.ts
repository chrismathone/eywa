import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { DEFAULT_PERIODS_CONFIG } from "@/features/timetable/lib/periods";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import { appendTeacherGridSheet } from "./teacher-grid-sheet";
import { appendIntegratedSheet } from "./integrated-sheet";

// 합성 영어 슬롯 — 두 반(LT2=Anna, LS2=Sam), 병렬 LAB, 재원/대기/퇴원·영문이름.
function fixtureSlots(): ScheduleSlotWithStudents[] {
  const base = {
    subject: "english",
    classroomName: null,
    studentCount: 0,
    slotRoomLabel: null as string | null,
    classBgColor: null as string | null,
    classTextColor: null as string | null,
    pendingHandover: null,
  };
  const student = (
    name: string,
    status: "active" | "hold" | "withdrawn",
    extra: Partial<ScheduleSlotWithStudents["students"][number]> = {},
  ) => ({
    name,
    grade: "5",
    school: "칠성초",
    studentId: `s-${name}`,
    status,
    englishName: extra.englishName ?? null,
    ...extra,
  });
  const students = [
    student("김철수", "active", { englishName: "Charlie" }),
    student("이영희", "active", { isNew: true }),
    student("박민수", "hold"),
    student("최지우", "withdrawn", { endDate: "2026-07-01" }),
  ] as ScheduleSlotWithStudents["students"];

  const mk = (
    id: string,
    className: string,
    day: string,
    start: string,
    end: string,
    label: string | null,
    teacher: string | null,
    room: string | null,
  ): ScheduleSlotWithStudents =>
    ({
      ...base,
      id: `${id}-${day}-${start}`,
      classId: id,
      className,
      dayOfWeek: day,
      startTime: start,
      endTime: end,
      teacherName: teacher,
      slotTeacherLabel: label,
      slotRoomLabel: room,
      students,
    }) as ScheduleSlotWithStudents;

  return [
    mk("c-lt2", "LT2", "mon", "14:20", "16:20", "Anna", "Anna", "602"),
    mk("c-lt2", "LT2", "wed", "14:20", "16:20", "Anna", "Anna", "602"),
    mk("c-ls2", "LS2", "tue", "14:20", "16:20", "Sam", "Sam", "604"),
    // 병렬 LAB(같은 시간 범위, 같은 강사 라벨 LAB) — 레인 2개.
    mk("c-lab1", "LABa", "mon", "16:20", "17:00", "LAB", null, "605"),
    mk("c-lab2", "LABb", "mon", "16:20", "17:00", "LAB", null, "606"),
  ];
}

describe("영어 시간표 익스포터", () => {
  it("강사별 탭 — 강사 밴드·수업 블록(반명+방)을 emit", () => {
    const wb = new ExcelJS.Workbook();
    appendTeacherGridSheet(wb, fixtureSlots(), { weekMonday: "2026-07-06", stepMin: 10 });
    const sheet = wb.getWorksheet("강사별영어시간표")!;
    expect(sheet).toBeTruthy();

    // 강사 밴드(row 1)에 Anna·Sam·LAB이 존재.
    const bandVals = new Set<string>();
    for (let c = 1; c <= sheet.columnCount; c++) {
      const v = sheet.getCell(1, c).value;
      if (typeof v === "string") bandVals.add(v);
    }
    expect(bandVals.has("Anna")).toBe(true);
    expect(bandVals.has("Sam")).toBe(true);
    expect(bandVals.has("LAB")).toBe(true);

    // 어딘가에 "LT2\n602" 블록(반명+방)이 있어야 한다.
    let foundBlock = false;
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string" && cell.value.includes("LT2") && cell.value.includes("602"))
          foundBlock = true;
      });
    });
    expect(foundBlock).toBe(true);
  });

  it("병렬 LAB — 레인 2개가 별개 셀(LABa·LABb)로 emit", () => {
    const wb = new ExcelJS.Workbook();
    appendTeacherGridSheet(wb, fixtureSlots(), { weekMonday: "2026-07-06", stepMin: 10 });
    const sheet = wb.getWorksheet("강사별영어시간표")!;
    const vals = new Set<string>();
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === "string") vals.add(cell.value.split("\n")[0]!);
    }));
    expect(vals.has("LABa")).toBe(true);
    expect(vals.has("LABb")).toBe(true);
  });

  it("통합 탭 — 수업명·명단 섹션·학생(영문이름) emit", () => {
    const wb = new ExcelJS.Workbook();
    appendIntegratedSheet(wb, fixtureSlots(), { config: DEFAULT_PERIODS_CONFIG });
    const sheet = wb.getWorksheet("통합영어시간표")!;
    expect(sheet).toBeTruthy();

    const vals: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === "string") vals.push(cell.value);
    }));
    const joined = vals.join(" | ");
    expect(joined).toContain("수업명");
    expect(joined).toContain("재원");
    expect(joined).toContain("LT2");
    expect(joined).toContain("김철수 (Charlie)"); // 영문이름 포함
    expect(joined).toContain("최지우"); // 퇴원생도 표기
  });
});
