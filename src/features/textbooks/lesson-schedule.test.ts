import { describe, expect, it } from "vitest";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import {
  buildLessonSchedule,
  lookaheadDates,
  slotsOfAxis,
  slotsOfStarts,
  MAX_LOOKAHEAD_DAYS,
} from "./lesson-schedule";

// 2026-09-14(월) 주. 실제 영어 반 모양에 맞춰 월·수 2교시 + 같은 날 JJ 1교시를 둔다.
function row(
  dayOfWeek: string,
  startTime: string,
  endTime: string,
  slotTeacherLabel: string | null = "Charlie",
): MonthScheduleRow {
  return { dayOfWeek, startTime, endTime, validFrom: null, validTo: null, slotTeacherLabel, slotRoomLabel: "304" };
}

const MON_WED: MonthScheduleRow[] = [
  row("mon", "18:20:00", "19:20:00"),
  row("mon", "19:20:00", "20:10:00"),
  row("wed", "18:20:00", "19:20:00"),
  row("wed", "19:20:00", "20:10:00"),
];

const WITH_SEATS: MonthScheduleRow[] = [
  ...MON_WED,
  row("mon", "20:20:00", "21:10:00", "JJ"),
  row("wed", "20:20:00", "21:10:00", "JJ"),
  row("mon", "17:20:00", "18:10:00", "LAB"),
];

describe("slotsOfAxis", () => {
  const slots = [
    { slotStart: "17:20", slotEnd: "18:10", teacherLabel: "LAB", roomLabel: null, seat: "LAB" as const },
    { slotStart: "18:20", slotEnd: "19:20", teacherLabel: "Charlie", roomLabel: "304", seat: null },
    { slotStart: "20:20", slotEnd: "21:10", teacherLabel: "JJ", roomLabel: "305", seat: "JJ" as const },
  ];

  it("class 축은 자리가 아닌 교시만", () => {
    expect(slotsOfAxis(slots, "class").map((s) => s.slotStart)).toEqual(["18:20"]);
  });

  it("jj 축은 JJ 교시만", () => {
    expect(slotsOfAxis(slots, "jj").map((s) => s.slotStart)).toEqual(["20:20"]);
  });

  it("🔴 LAB은 어느 축에도 안 들어간다", () => {
    expect(slotsOfAxis(slots, "class").some((s) => s.seat === "LAB")).toBe(false);
    expect(slotsOfAxis(slots, "jj").some((s) => s.seat === "LAB")).toBe(false);
  });
});

describe("lookaheadDates", () => {
  it("시작일부터 오름차순", () => {
    expect(lookaheadDates("2026-09-14", 3)).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);
  });

  it("상한을 넘겨도 MAX_LOOKAHEAD_DAYS까지만", () => {
    expect(lookaheadDates("2026-09-14", 9999)).toHaveLength(MAX_LOOKAHEAD_DAYS);
  });
});

describe("buildLessonSchedule — 단위(pace)", () => {
  it("period: 교시 하나가 차수 하나 (하루 2교시 = 2차수)", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3, 4],
      schedules: MON_WED,
      holidays: {},
      axis: "class",
      pace: "period",
      lookaheadDays: 14,
    });
    expect(s.targets).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "18:20" },
      { lessonNo: 2, date: "2026-09-14", slotStart: "19:20" },
      { lessonNo: 3, date: "2026-09-16", slotStart: "18:20" },
      { lessonNo: 4, date: "2026-09-16", slotStart: "19:20" },
    ]);
    expect(s.unplaced).toEqual([]);
    expect(s.lastDate).toBe("2026-09-16");
  });

  it("day: 하루가 차수 하나 — 그 날 모든 교시에 같은 차수가 앉는다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2],
      schedules: MON_WED,
      holidays: {},
      axis: "class",
      pace: "day",
      lookaheadDays: 14,
    });
    expect(s.targets).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "18:20" },
      { lessonNo: 1, date: "2026-09-14", slotStart: "19:20" },
      { lessonNo: 2, date: "2026-09-16", slotStart: "18:20" },
      { lessonNo: 2, date: "2026-09-16", slotStart: "19:20" },
    ]);
  });

  it("day 단위에서 교시가 하나뿐인 날도 차수 하나를 소비한다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2],
      schedules: [row("mon", "18:20:00", "19:20:00"), row("wed", "18:20:00", "19:20:00")],
      holidays: {},
      axis: "class",
      pace: "day",
      lookaheadDays: 14,
    });
    expect(s.targets.map((t) => `${t.lessonNo}@${t.date}`)).toEqual(["1@2026-09-14", "2@2026-09-16"]);
  });
});

describe("buildLessonSchedule — 휴일", () => {
  it("🔴 휴일은 차수를 소비하지 않고 다음 수업일로 밀린다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2],
      schedules: MON_WED,
      holidays: { "2026-09-14": "추석" },
      axis: "class",
      pace: "day",
      lookaheadDays: 21,
    });
    expect(s.targets.map((t) => `${t.lessonNo}@${t.date}`)).toEqual([
      "1@2026-09-16",
      "1@2026-09-16",
      "2@2026-09-21",
      "2@2026-09-21",
    ]);
    expect(s.skippedHolidays).toEqual([{ date: "2026-09-14", name: "추석" }]);
  });

  it("수업이 없는 날의 휴일은 '건너뛴 수업일'로 세지 않는다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1],
      schedules: MON_WED,
      // 화요일(15일)엔 원래 수업이 없다.
      holidays: { "2026-09-15": "임시휴원" },
      axis: "class",
      pace: "day",
      lookaheadDays: 14,
    });
    expect(s.skippedHolidays).toEqual([]);
  });

  it("휴일 맵이 없으면(조회 실패·미설정) 전부 평일로 본다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1],
      schedules: MON_WED,
      holidays: null,
      axis: "class",
      pace: "day",
      lookaheadDays: 14,
    });
    expect(s.targets[0]!.date).toBe("2026-09-14");
  });
});

describe("buildLessonSchedule — 축(axis)", () => {
  it("jj 축은 JJ 교시에만 앉는다 (정규 교시는 건드리지 않는다)", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2],
      schedules: WITH_SEATS,
      holidays: {},
      axis: "jj",
      pace: "period",
      lookaheadDays: 14,
    });
    expect(s.targets).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "20:20" },
      { lessonNo: 2, date: "2026-09-16", slotStart: "20:20" },
    ]);
  });

  it("class 축은 JJ·LAB을 빼고 센다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3],
      schedules: WITH_SEATS,
      holidays: {},
      axis: "class",
      pace: "period",
      lookaheadDays: 14,
    });
    expect(s.targets.map((t) => t.slotStart)).toEqual(["18:20", "19:20", "18:20"]);
  });
});

describe("buildLessonSchedule — 자리가 모자랄 때", () => {
  it("🔴 조용히 버리지 않고 unplaced로 알린다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3, 4, 5],
      schedules: [row("mon", "18:20:00", "19:20:00")],
      holidays: {},
      axis: "class",
      pace: "period",
      lookaheadDays: 14, // 월요일 2번뿐
    });
    expect(s.targets).toHaveLength(2);
    expect(s.unplaced).toEqual([3, 4, 5]);
  });

  it("시작 차수가 1이 아니어도 번호를 그대로 쓴다(이어서 배정)", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [7, 8],
      schedules: MON_WED,
      holidays: {},
      axis: "class",
      pace: "day",
      lookaheadDays: 14,
    });
    expect(s.targets.map((t) => t.lessonNo)).toEqual([7, 7, 8, 8]);
  });
});

describe("buildLessonSchedule — 배치 이력(valid_from/valid_to)", () => {
  it("아직 시작 안 한 교시는 그 날 안 센다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2],
      schedules: [
        { ...row("mon", "18:20:00", "19:20:00"), validFrom: "2026-09-21", validTo: null },
        row("wed", "18:20:00", "19:20:00"),
      ],
      holidays: {},
      axis: "class",
      pace: "period",
      lookaheadDays: 14,
    });
    // 9/14 월요일 교시는 아직 유효하지 않다 → 9/16(수) → 9/21(월)
    expect(s.targets.map((t) => t.date)).toEqual(["2026-09-16", "2026-09-21"]);
  });

  it("끝난 교시는 그 뒤로 안 센다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3],
      schedules: [{ ...row("mon", "18:20:00", "19:20:00"), validFrom: null, validTo: "2026-09-14" }],
      holidays: {},
      axis: "class",
      pace: "period",
      lookaheadDays: 21,
    });
    expect(s.targets.map((t) => t.date)).toEqual(["2026-09-14"]);
    expect(s.unplaced).toEqual([2, 3]);
  });
});

describe("slotsOfStarts — 고른 시각만", () => {
  const slots = [
    { slotStart: "16:20", slotEnd: "17:20", teacherLabel: "JJ", roomLabel: "305", seat: "JJ" as const },
    { slotStart: "17:20", slotEnd: "18:10", teacherLabel: "JJ", roomLabel: "305", seat: "JJ" as const },
    { slotStart: "18:20", slotEnd: "19:20", teacherLabel: "송지혜", roomLabel: "304", seat: null },
    { slotStart: "15:20", slotEnd: "16:10", teacherLabel: "LAB", roomLabel: "603", seat: "LAB" as const },
  ];

  it("고른 시각만 남는다 — 자리든 강사 수업이든 그대로", () => {
    expect(slotsOfStarts(slots, new Set(["16:20", "18:20"])).map((s) => s.slotStart)).toEqual(["16:20", "18:20"]);
  });

  it("🔴 LAB은 골라도 안 들어간다 — ECS가 언제나 빼는 자리다", () => {
    expect(slotsOfStarts(slots, new Set(["15:20", "16:20"])).map((s) => s.slotStart)).toEqual(["16:20"]);
  });

  it("아무것도 안 고르면 빈 목록", () => {
    expect(slotsOfStarts(slots, new Set())).toEqual([]);
  });
});

describe("buildLessonSchedule — 시각 선택(slotStarts)", () => {
  it("🔑 고른 시각이 축을 이긴다 — JJ와 강사 수업을 함께 고를 수 있다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3, 4],
      schedules: WITH_SEATS,
      holidays: {},
      axis: "class", // 있어도 안 쓴다
      slotStarts: ["18:20", "20:20"], // 18:20=강사 수업 · 20:20=JJ
      pace: "period",
      lookaheadDays: 14,
    });
    expect(s.targets).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "18:20" },
      { lessonNo: 2, date: "2026-09-14", slotStart: "20:20" },
      { lessonNo: 3, date: "2026-09-16", slotStart: "18:20" },
      { lessonNo: 4, date: "2026-09-16", slotStart: "20:20" },
    ]);
  });

  it("고른 시각이 그 날 없으면 그 날은 건너뛴다(차수를 안 쓴다)", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1],
      schedules: [row("mon", "18:20:00", "19:20:00"), row("wed", "19:20:00", "20:10:00")],
      holidays: {},
      axis: "class",
      slotStarts: ["19:20"],
      pace: "period",
      lookaheadDays: 14,
    });
    expect(s.targets).toEqual([{ lessonNo: 1, date: "2026-09-16", slotStart: "19:20" }]);
  });

  it("day 단위면 그 날 고른 교시 전부에 같은 차수", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1],
      schedules: WITH_SEATS,
      holidays: {},
      axis: "class",
      slotStarts: ["18:20", "19:20"],
      pace: "day",
      lookaheadDays: 14,
    });
    expect(s.targets).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "18:20" },
      { lessonNo: 1, date: "2026-09-14", slotStart: "19:20" },
    ]);
  });

  it("빈 배열이면 옛 축 방식으로 돈다(0268a 적용 전 배정)", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1],
      schedules: WITH_SEATS,
      holidays: {},
      axis: "jj",
      slotStarts: [],
      pace: "period",
      lookaheadDays: 14,
    });
    expect(s.targets).toEqual([{ lessonNo: 1, date: "2026-09-14", slotStart: "20:20" }]);
  });
});
