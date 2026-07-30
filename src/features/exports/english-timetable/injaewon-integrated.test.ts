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
  it("원본 형식 구조 — 타이틀·섹션·반헤더·교시셀(강사↵방)·특수자리(LAB)·명단·정원/인원/퇴원수", () => {
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
    expect(joined).toContain("1교시 시작"); // 섹션 라벨(앱 통합뷰 그룹핑 = N교시 시작)
    expect(vals.some((v) => v.includes("DP5") && v.includes("2:20") && v.includes("(Anna)"))).toBe(true); // 반 헤더
    expect(vals.some((v) => v.includes("Anna") && v.includes("602"))).toBe(true); // 교시 셀 강사+방
    expect(joined).toContain("LAB"); // 특수 자리 셀 = 사람 이름이 아니라 자리 라벨(LAB·JJ)
    expect(joined).toContain("신지민(Jenny)"); // 재원 명단(영문)
    expect(joined).toContain("정원");
    expect(joined).toContain("인원");
    expect(joined).toContain("퇴원수");
    expect(joined).toContain("이퇴원"); // 퇴원생 명단
  });

  it("명단 셀엔 내부 테두리가 없다 — 이름↔학교학년 세로선·행 사이 가로선 제거(2026-07-23)", () => {
    const wb = new ExcelJS.Workbook();
    appendInjaewonIntegratedSheet(wb, fixture(), {
      config: DEFAULT_PERIODS_CONFIG,
      capacityByClassId: { dp5: 8, lt2: 8 },
    });
    const sheet = wb.getWorksheet("통합영어시간표")!;

    // 학생 이름이 실제로 찍힌 칸을 찾는다(빈 칸이 아니라 **값이 있는 칸**이 예전에 격자를 갖고
    // 있었다 — 그래서 명단이 들쭉날쭉했다). 이름 셀은 C:E 병합이라 오른쪽 학교학년 셀은 +3.
    const NAME_COLS = 3;
    let checked = 0;
    sheet.eachRow((row, r) =>
      row.eachCell((cell, c) => {
        if (typeof cell.value !== "string" || !cell.value.startsWith("신지민")) return;
        // ⚠️ eachCell은 병합 **슬레이브 칸도** 같은 값으로 돌려준다 — 슬레이브에서 +3을 하면 옆 카드의
        // 이름 칸(카드 경계라 굵은 좌측선 보유)을 검사하게 돼 헛되이 실패한다. 마스터만 본다.
        if (cell.master !== cell) return;
        checked++;
        const name = sheet.getCell(r, c).border ?? {};
        const schoolGrade = sheet.getCell(r, c + NAME_COLS).border ?? {};
        // 행 사이 가로선 없음
        expect(name.top).toBeUndefined();
        expect(name.bottom).toBeUndefined();
        expect(schoolGrade.top).toBeUndefined();
        expect(schoolGrade.bottom).toBeUndefined();
        // 이름↔학교학년 사이 세로선 없음(이게 140820에서 거슬리던 내부선)
        expect(name.right).toBeUndefined();
        expect(schoolGrade.left).toBeUndefined();
      }),
    );
    expect(checked).toBeGreaterThan(0); // 명단 셀을 실제로 검사했는지(빈 검증 방지)
  });

  it("A열(시간범위 축)은 명단·정원/인원·대기·퇴원 구간이 각각 한 칸으로 병합된다", () => {
    const wb = new ExcelJS.Workbook();
    appendInjaewonIntegratedSheet(wb, fixture(), {
      config: DEFAULT_PERIODS_CONFIG,
      capacityByClassId: { dp5: 8, lt2: 8 },
    });
    const sheet = wb.getWorksheet("통합영어시간표")!;
    // 명단은 최소 11행 고정이라, A열에 11행 이상을 덮는 세로 병합이 반드시 하나는 있어야 한다.
    const merges: string[] = (sheet.model as unknown as { merges: string[] }).merges ?? [];
    const tallColA = merges.filter((m) => {
      const mm = /^A(\d+):A(\d+)$/.exec(m);
      return mm && Number(mm[2]) - Number(mm[1]) >= 10;
    });
    expect(tallColA.length).toBeGreaterThan(0);
  });
});
