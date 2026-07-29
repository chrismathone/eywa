import { describe, expect, it } from "vitest";
import { buildWeekGrid, sheetFillStats, type GridPlanLine } from "./grid";

// 2026-07-20(월) 주. 화=2026-07-21, 수=07-22, 금=07-24, 토=07-25.
const MON = "2026-07-20";

const line = (over: Partial<GridPlanLine>): GridPlanLine => ({
  id: over.id ?? "00000000-0000-0000-0000-000000000001",
  planDate: over.planDate ?? MON,
  slotStart: over.slotStart ?? "15:00",
  termMode: over.termMode ?? "regular",
  skillArea: over.skillArea ?? "vocab",
  lineNo: over.lineNo ?? 1,
  textbook: over.textbook ?? null,
  pageRange: over.pageRange ?? null,
  progress: over.progress ?? null,
  homework: over.homework ?? null,
  updatedAt: over.updatedAt ?? "2026-07-20T00:00:00Z",
});

const sched = (dow: "mon" | "tue" | "wed" | "thu" | "fri", start: string, over?: object) => ({
  dayOfWeek: dow,
  startTime: `${start}:00`,
  endTime: "15:40:00",
  validFrom: "2026-01-01",
  validTo: null,
  teacherId: null,
  slotTeacherLabel: "Hannah",
  slotRoomLabel: "303",
  ...over,
});

const enr = (studentId: string, over?: object) => ({
  studentId,
  startDate: "2026-01-01",
  endDate: null,
  onHold: false,
  attendanceDays: [] as string[],
  ...over,
});

describe("buildWeekGrid — 실날짜별 슬롯 유효성", () => {
  it("주중 시간표 변경: valid_to가 주 중간이면 그 날짜 이후는 비스케줄(데이터 있으면 고아)", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [
        sched("wed", "15:00", { validTo: "2026-07-21" }), // 화요일까지만 유효 → 수요일엔 없음
        sched("wed", "16:00", { validFrom: "2026-07-22" }), // 수요일부터 유효
      ],
      enrollments: [enr("s1")],
      planLines: [line({ planDate: "2026-07-22", slotStart: "15:00", progress: "Ch 1" })],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    const wed = grid.days.find((d) => d.date === "2026-07-22");
    expect(wed).toBeDefined();
    const s15 = wed!.slots.find((s) => s.slotStart === "15:00");
    const s16 = wed!.slots.find((s) => s.slotStart === "16:00");
    expect(s15?.scheduled).toBe(false); // 고아(계획은 보존)
    expect(s15?.lines).toHaveLength(1);
    expect(s16?.scheduled).toBe(true);
  });

  it("스케줄도 데이터도 없는 날짜는 렌더 대상이 아니다", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00")],
      enrollments: [],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(grid.days.map((d) => d.dow)).toEqual(["mon"]);
  });
});

describe("buildWeekGrid — 날짜별 로스터(입퇴반·분리등원·퇴원)", () => {
  it("일반 종료는 종료일 당일까지 재원, 다음날부터 제외", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00"), sched("wed", "15:00"), sched("fri", "15:00")],
      enrollments: [enr("s1", { endDate: "2026-07-22" })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    const byDate = Object.fromEntries(
      grid.days.map((d) => [d.date, d.slots[0].roster.filter((r) => r.eligible).length]),
    );
    expect(byDate["2026-07-20"]).toBe(1);
    expect(byDate["2026-07-22"]).toBe(1); // 종료일 당일 포함
    expect(byDate["2026-07-24"]).toBe(0);
  });

  it("반이동(is_transferred)은 반열림 — 종료일 당일부터 제외", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("wed", "15:00")],
      enrollments: [enr("s1", { endDate: "2026-07-22", isTransferred: true })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(grid.days[0].slots[0].roster.filter((r) => r.eligible)).toHaveLength(0);
  });

  it("분리등원(attendance_days)은 그 요일만 eligible", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00"), sched("wed", "15:00")],
      enrollments: [enr("s1", { attendanceDays: ["mon"] })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    const mon = grid.days.find((d) => d.dow === "mon")!;
    const wed = grid.days.find((d) => d.dow === "wed")!;
    expect(mon.slots[0].roster.filter((r) => r.eligible)).toHaveLength(1);
    expect(wed.slots[0].roster.filter((r) => r.eligible)).toHaveLength(0);
  });

  it("students.withdrawn_at 이후 날짜는 제외", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00"), sched("fri", "15:00")],
      enrollments: [enr("s1", { withdrawnAt: "2026-07-21" })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    const mon = grid.days.find((d) => d.dow === "mon")!;
    const fri = grid.days.find((d) => d.dow === "fri")!;
    expect(mon.slots[0].roster.filter((r) => r.eligible)).toHaveLength(1); // 퇴원 확정일 전
    expect(fri.slots[0].roster.filter((r) => r.eligible)).toHaveLength(0);
  });

  it("같은 학생 중복 enrollment은 1행으로 dedupe", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00")],
      enrollments: [enr("s1", { endDate: "2026-07-20" }), enr("s1", { startDate: "2026-07-01" })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(grid.days[0].slots[0].roster).toHaveLength(1);
  });
});

describe("buildWeekGrid — 과거 데이터 보존(합집합 로스터·고아·attendanceOnly)", () => {
  it("비eligible이어도 마크·출석 보유 학생은 historical로 로스터에 남는다", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00")],
      enrollments: [enr("s1")],
      planLines: [],
      marks: [{ studentId: "s2", markDate: MON, slotStart: "15:00:00", status: "완", progressNote: null }],
      attendance: [{ studentId: "s3", sessionDate: MON, status: "makeup" }],
      slotMemoKeys: [],
    });
    const roster = grid.days[0].slots[0].roster;
    expect(roster.map((r) => [r.studentId, r.eligible, r.historical])).toEqual([
      ["s1", true, false],
      ["s2", false, true],
      ["s3", false, true],
    ]);
  });

  it("고아 판정은 계획∪마크∪슬롯메모 합집합 — 마크만 있어도 슬롯 보존", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [],
      enrollments: [],
      planLines: [],
      marks: [{ studentId: "s1", markDate: "2026-07-24", slotStart: "17:00", status: "완", progressNote: null }],
      attendance: [],
      slotMemoKeys: ["slot:2026-07-21:18:00"],
    });
    expect(grid.days.map((d) => d.date)).toEqual(["2026-07-21", "2026-07-24"]);
    expect(grid.days.every((d) => d.slots[0].scheduled === false)).toBe(true);
  });

  it("스케줄 없는 날짜의 출석은 가짜 슬롯 없이 attendanceOnly로 분리", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00")],
      enrollments: [],
      planLines: [],
      marks: [],
      attendance: [{ studentId: "s9", sessionDate: "2026-07-25", status: "present" }],
      slotMemoKeys: [],
    });
    expect(grid.days.map((d) => d.date)).toEqual([MON]);
    expect(grid.attendanceOnly).toEqual([{ date: "2026-07-25", studentIds: ["s9"] }]);
  });
});

describe("sheetFillStats — 작성률(placeholder 제외·고아 분모 제외)", () => {
  it("의미 행 있는 스케줄 교시만 분자, 고아는 별도 카운트", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00"), sched("mon", "16:00"), sched("wed", "15:00")],
      enrollments: [],
      planLines: [
        line({ planDate: MON, slotStart: "15:00", progress: "Ch 1" }), // 의미 행
        line({ id: "00000000-0000-0000-0000-000000000002", planDate: MON, slotStart: "16:00" }), // placeholder
        line({ id: "00000000-0000-0000-0000-000000000003", planDate: "2026-07-24", slotStart: "17:00", progress: "고아" }),
      ],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(sheetFillStats(grid)).toEqual({ totalSlots: 3, filledSlots: 1, orphanSlots: 1 });
  });

  it("공백만 있는 행은 의미 행이 아니다(trim)", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00")],
      enrollments: [],
      planLines: [line({ textbook: "  ", pageRange: "", progress: null, homework: " " })],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(sheetFillStats(grid).filledSlots).toBe(0);
  });

  it("계획 행 정렬 = 평시 먼저, line_no 순", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00")],
      enrollments: [],
      planLines: [
        line({ id: "00000000-0000-0000-0000-00000000000a", termMode: "exam", lineNo: 1, progress: "내신" }),
        line({ id: "00000000-0000-0000-0000-00000000000b", termMode: "regular", lineNo: 2, progress: "r2" }),
        line({ id: "00000000-0000-0000-0000-00000000000c", termMode: "regular", lineNo: 1, progress: "r1" }),
      ],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(grid.days[0].slots[0].lines.map((l) => l.progress)).toEqual(["r1", "r2", "내신"]);
  });
});
