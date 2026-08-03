import { describe, expect, it } from "vitest";
import { buildWeekGrid, scheduledSlotKeySet, sheetFillStats, type GridPlanLine } from "./grid";

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

// 퇴원 유예 = 그 주 월요일 −30일. MON=2026-07-20 → 하한 2026-06-20.
describe("buildWeekGrid — 퇴원 유예(하단 '퇴원' 섹션, 시간표와 같은 30일 창)", () => {
  const rosterOf = (grid: ReturnType<typeof buildWeekGrid>, date: string) =>
    grid.days.find((d) => d.date === date)!.slots[0].roster;

  it("종료 다음날부터 endedOn을 달고 남는다(읽기 전용) — 사라지지 않는다", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00"), sched("fri", "15:00")],
      enrollments: [enr("s1", { endDate: "2026-07-22" })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(rosterOf(grid, MON)[0]).toMatchObject({ eligible: true, historical: false, endedOn: null });
    expect(rosterOf(grid, "2026-07-24")[0]).toMatchObject({
      studentId: "s1",
      eligible: false,
      historical: true,
      endedOn: "2026-07-22",
    });
  });

  it("유예(30일)가 지난 종료는 기록이 없으면 로스터에서 빠진다", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00")],
      enrollments: [enr("s1", { endDate: "2026-06-19" })], // 하한(06-20)보다 하루 이르다
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(rosterOf(grid, MON)).toHaveLength(0);
  });

  it("유예가 지나도 그 교시 기록이 있으면 '기록' 행으로 남는다(endedOn 없음 — 퇴원 아님)", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00")],
      enrollments: [enr("s1", { endDate: "2026-06-19" })],
      planLines: [],
      marks: [{ studentId: "s1", markDate: MON, slotStart: "15:00", status: "완", progressNote: null }],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(rosterOf(grid, MON)[0]).toMatchObject({ eligible: false, historical: true, endedOn: null });
  });

  it("퇴원일(withdrawn_at)이 반 종료일보다 이르면 이른 쪽이 종료일", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("fri", "15:00")],
      enrollments: [enr("s1", { endDate: "2026-07-22", withdrawnAt: "2026-07-21" })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(rosterOf(grid, "2026-07-24")[0].endedOn).toBe("2026-07-21");
  });

  it("반이동 전출(is_transferred)은 옛 반에 퇴원으로 남기지 않는다(새 반에서 보임)", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("fri", "15:00")],
      enrollments: [enr("s1", { endDate: "2026-07-22", isTransferred: true })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(rosterOf(grid, "2026-07-24")).toHaveLength(0);
  });

  it("대기(on_hold)·미시작은 퇴원이 아니다 — 종료일이 없으면 안 뜬다", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00")],
      enrollments: [enr("s1", { onHold: true }), enr("s2", { startDate: "2026-08-01" })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(rosterOf(grid, MON)).toHaveLength(0);
  });

  it("분리등원: 원래 안 오던 요일에는 퇴원도 뜨지 않는다", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("mon", "15:00"), sched("wed", "15:00")],
      enrollments: [enr("s1", { attendanceDays: ["mon"], endDate: "2026-07-19" })],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(rosterOf(grid, MON)[0]).toMatchObject({ eligible: false, endedOn: "2026-07-19" });
    expect(rosterOf(grid, "2026-07-22")).toHaveLength(0); // 수요일엔 원래 안 왔다
  });

  it("재등록: 열린 수강이 하나라도 있으면 재원(퇴원 행으로 중복되지 않는다)", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [sched("fri", "15:00")],
      enrollments: [
        enr("s1", { endDate: "2026-07-01" }),
        enr("s1", { startDate: "2026-07-10" }),
      ],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    const roster = rosterOf(grid, "2026-07-24");
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ eligible: true, endedOn: null });
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

// 자리(LAB·JJ)는 2026-07-31엔 코드가 **무조건 숨겼다가** 2026-08-03 원장 지시로 **상단 헤더 설정**이 됐다
// (기본 표시). 아래는 그 계약을 잠근다 — 기본값을 숨김으로 되돌리거나, 표시/숨김이 작성률과 어긋나면 깨진다.
describe("buildWeekGrid — 자리(LAB·JJ) 표시는 설정이 정한다(기본 표시)", () => {
  const lab = (dow: "mon" | "tue" | "wed" | "thu" | "fri", start: string, label = "LAB") =>
    sched(dow, start, { slotTeacherLabel: label, slotRoomLabel: "603" });

  it("기본(미지정)은 표시 — 다른 교시와 똑같이 그린다", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [lab("mon", "16:20"), lab("tue", "16:20", "JJ"), sched("wed", "15:00")],
      enrollments: [enr("s1")],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(grid.days.map((d) => d.dow)).toEqual(["mon", "tue", "wed"]);
    expect(grid.days[0].slots[0]).toMatchObject({ teacherLabel: "LAB", roomLabel: "603" });
    expect(grid.days[1].slots[0]).toMatchObject({ teacherLabel: "JJ" });
    expect(grid.hiddenSpecial).toEqual({ slots: 0, records: 0 }); // 숨긴 게 없으니 각주도 없다
  });

  it("표시일 땐 그 자리에 쓴 계획·마크가 화면에 남는다", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [lab("mon", "16:20")],
      enrollments: [enr("s1")],
      planLines: [line({ slotStart: "16:20", textbook: "Power Voca" })],
      marks: [{ studentId: "s1", markDate: MON, slotStart: "16:20", status: "완", progressNote: null }],
      attendance: [],
      slotMemoKeys: [],
    });
    expect(grid.days[0].slots[0].lines.map((l) => l.textbook)).toEqual(["Power Voca"]);
  });

  it("숨김이면 안 그린다 — 원 라벨 '이주희'(해석 전 값)도 같은 자리로 판정", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [lab("mon", "16:20", "이주희"), lab("tue", "16:20", "JJ"), sched("wed", "15:00")],
      enrollments: [enr("s1")],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
      includeSpecialRooms: false,
    });
    expect(grid.days.map((d) => d.dow)).toEqual(["wed"]);
  });

  it("숨김인데 기록이 남아 있으면 hiddenSpecial로 건수를 남긴다(침묵 금지)", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [lab("mon", "16:20"), lab("tue", "16:20", "JJ")],
      enrollments: [enr("s1")],
      planLines: [line({ slotStart: "16:20", textbook: "Power Voca" })],
      marks: [{ studentId: "s1", markDate: "2026-07-21", slotStart: "16:20", status: "완", progressNote: null }],
      attendance: [],
      slotMemoKeys: [],
      includeSpecialRooms: false,
    });
    expect(grid.days).toHaveLength(0);
    expect(grid.hiddenSpecial).toEqual({ slots: 2, records: 2 });
  });

  it("숨김: 빈 계획 행(placeholder)만 있으면 기록으로 세지 않는다", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [lab("mon", "16:20")],
      enrollments: [enr("s1")],
      planLines: [line({ slotStart: "16:20", textbook: "  " })],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
      includeSpecialRooms: false,
    });
    expect(grid.days).toHaveLength(0);
    expect(grid.hiddenSpecial).toEqual({ slots: 0, records: 0 });
  });

  it("숨김: 자리 교시뿐인 날짜라도 출석 기록은 attendanceOnly로 보존", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [lab("mon", "16:20")],
      enrollments: [enr("s1")],
      planLines: [],
      marks: [],
      attendance: [{ studentId: "s1", sessionDate: MON, status: "present" }],
      slotMemoKeys: [],
      includeSpecialRooms: false,
    });
    expect(grid.days).toHaveLength(0);
    expect(grid.attendanceOnly).toEqual([{ date: MON, studentIds: ["s1"] }]);
  });

  it("숨김: 같은 시각에 강사 수업이 겹치면 수업이 이긴다(실수업이 증발하지 않는다)", () => {
    const grid = buildWeekGrid({
      weekMonday: MON,
      schedules: [lab("mon", "16:20"), sched("mon", "16:20")],
      enrollments: [enr("s1")],
      planLines: [],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
      includeSpecialRooms: false,
    });
    expect(grid.days[0].slots[0]).toMatchObject({ teacherLabel: "Hannah" });
    expect(sheetFillStats(grid).totalSlots).toBe(1);
  });

  it("보이는 교시 = 세는 교시 — 작성률·랜딩 키셋이 설정을 같이 따른다", () => {
    const schedules = [lab("mon", "16:20"), sched("wed", "15:00")];
    const input = {
      weekMonday: MON,
      schedules,
      enrollments: [],
      planLines: [line({ slotStart: "16:20", progress: "자율" }), line({ planDate: "2026-07-22", progress: "Ch1" })],
      marks: [],
      attendance: [],
      slotMemoKeys: [],
    };
    // 표시 = 분모에 들어간다(랜딩도 같은 키셋).
    expect(sheetFillStats(buildWeekGrid(input))).toEqual({ totalSlots: 2, filledSlots: 2, orphanSlots: 0 });
    expect([...scheduledSlotKeySet(MON, schedules)].sort()).toEqual([
      "2026-07-20|16:20",
      "2026-07-22|15:00",
    ]);
    // 숨김 = 분모에서도 빠진다(화면에서 뺀 교시를 분모에 남기면 100%에 못 닿는다).
    const hidden = buildWeekGrid({ ...input, includeSpecialRooms: false });
    expect(sheetFillStats(hidden)).toEqual({ totalSlots: 1, filledSlots: 1, orphanSlots: 0 });
    expect(hidden.hiddenSpecial.records).toBe(1);
    expect([...scheduledSlotKeySet(MON, schedules, { includeSpecialRooms: false })]).toEqual([
      "2026-07-22|15:00",
    ]);
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
