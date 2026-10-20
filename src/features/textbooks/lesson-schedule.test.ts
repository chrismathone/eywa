import { describe, expect, it } from "vitest";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import {
  buildLessonSchedule,
  lookaheadDates,
  slotsOfAxis,
  slotsOfPicks,
  parseSlotPick,
  MAX_LOOKAHEAD_DAYS,
  normalizeLessonPace,
  lessonsInSlot,
  groupSlotPicks,
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


/** 자리(`pos`)는 줄 표식(0382a) 테스트가 따로 본다 — 배치 테스트는 날짜·교시·차수만 견준다. */
const noPos = (ts: readonly { lessonNo: number; date: string; slotStart: string; pos: number }[]) =>
  ts.map(({ lessonNo, date, slotStart }) => ({ lessonNo, date, slotStart }));

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
    expect(noPos(s.targets)).toEqual([
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
    expect(noPos(s.targets)).toEqual([
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

describe("25분 수업(min25) — 원장 2026-10-14 정정", () => {
  it("1시간 교시라도 차수는 하나만 — '교시마다 1차수'와 같은 배치", () => {
    const base = { startDate: "2026-09-14", lessonNos: [1, 2, 3, 4], schedules: MON_WED, holidays: {}, axis: "class" as const, lookaheadDays: 14 };
    const min25 = buildLessonSchedule({ ...base, pace: "min25" });
    expect(min25.targets).toEqual(buildLessonSchedule({ ...base, pace: "period" }).targets);
    expect(min25.targets.filter((t) => t.date === "2026-09-14" && t.slotStart === "18:20")).toHaveLength(1);
  });

  it("단위 문자열은 한 함수로 읽는다 — 모르는 값은 period", () => {
    expect(normalizeLessonPace("min25")).toBe("min25");
    expect(normalizeLessonPace("day")).toBe("day");
    expect(normalizeLessonPace("period")).toBe("period");
    expect(normalizeLessonPace(null)).toBe("period");
    expect(normalizeLessonPace("week")).toBe("period");
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
    expect(noPos(s.targets)).toEqual([
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

describe("parseSlotPick — 요일|시각", () => {
  it("요일이 붙은 값을 읽는다", () => {
    expect(parseSlotPick("mon|17:20")).toEqual({ dow: "mon", start: "17:20", pos: null });
  });

  it("옛 모양(시각만)은 '모든 요일'로 읽는다", () => {
    expect(parseSlotPick("17:20")).toEqual({ dow: null, start: "17:20", pos: null });
  });

  it("모양이 틀리면 null — 앞뒤 공백은 봐준다", () => {
    expect(parseSlotPick(" mon|17:20 ")).toEqual({ dow: "mon", start: "17:20", pos: null });
    expect(parseSlotPick("월|17:20")).toBeNull();
    expect(parseSlotPick("mon|25:99")).toBeNull();
    expect(parseSlotPick("")).toBeNull();
  });
});

describe("slotsOfPicks — 그 요일에 고른 칸만", () => {
  const slots = [
    { slotStart: "16:20", slotEnd: "17:20", teacherLabel: "JJ", roomLabel: "305", seat: "JJ" as const },
    { slotStart: "17:20", slotEnd: "18:10", teacherLabel: "JJ", roomLabel: "305", seat: "JJ" as const },
    { slotStart: "18:20", slotEnd: "19:20", teacherLabel: "송지혜", roomLabel: "304", seat: null },
    { slotStart: "15:20", slotEnd: "16:10", teacherLabel: "LAB", roomLabel: "603", seat: "LAB" as const },
  ];

  it("고른 칸만 남는다 — 자리든 강사 수업이든 그대로", () => {
    expect(slotsOfPicks(slots, "mon", new Set(["mon|16:20", "mon|18:20"])).map((s) => s.slotStart)).toEqual([
      "16:20",
      "18:20",
    ]);
  });

  it("🔴 **다른 요일의 같은 시각은 안 들어간다** — 담당이 요일마다 갈리기 때문이다(원장 2026-09-18)", () => {
    expect(slotsOfPicks(slots, "thu", new Set(["mon|18:20"])).map((s) => s.slotStart)).toEqual([]);
  });

  it("🔴 LAB은 골라도 안 들어간다 — ECS가 언제나 빼는 자리다", () => {
    expect(slotsOfPicks(slots, "mon", new Set(["mon|15:20", "mon|16:20"])).map((s) => s.slotStart)).toEqual(["16:20"]);
  });

  it("옛 모양(시각만)은 모든 요일에 걸린다", () => {
    expect(slotsOfPicks(slots, "thu", new Set(["18:20"])).map((s) => s.slotStart)).toEqual(["18:20"]);
  });

  it("아무것도 안 고르면 빈 목록", () => {
    expect(slotsOfPicks(slots, "mon", new Set())).toEqual([]);
  });
});

describe("buildLessonSchedule — 칸 선택(slotPicks)", () => {
  it("🔑 고른 칸이 축을 이긴다 — JJ와 강사 수업을 함께 고를 수 있다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3, 4],
      schedules: WITH_SEATS,
      holidays: {},
      axis: "class", // 있어도 안 쓴다
      slotPicks: ["mon|18:20", "mon|20:20", "wed|18:20", "wed|20:20"], // 18:20=강사 수업 · 20:20=JJ
      pace: "period",
      lookaheadDays: 14,
    });
    expect(noPos(s.targets)).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "18:20" },
      { lessonNo: 2, date: "2026-09-14", slotStart: "20:20" },
      { lessonNo: 3, date: "2026-09-16", slotStart: "18:20" },
      { lessonNo: 4, date: "2026-09-16", slotStart: "20:20" },
    ]);
  });

  it("🔴 **한 요일만 골랐으면 그 요일에만 들어간다** — 같은 시각의 다른 요일은 남의 칸일 수 있다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2],
      schedules: MON_WED, // 월·수 모두 18:20이 있다
      holidays: {},
      axis: "class",
      slotPicks: ["mon|18:20"],
      pace: "period",
      lookaheadDays: 14,
    });
    // 수요일(9/16)은 건너뛰고 다음 월요일(9/21)로 간다.
    expect(noPos(s.targets)).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "18:20" },
      { lessonNo: 2, date: "2026-09-21", slotStart: "18:20" },
    ]);
  });

  it("고른 칸이 그 날 없으면 그 날은 건너뛴다(차수를 안 쓴다)", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1],
      schedules: [row("mon", "18:20:00", "19:20:00"), row("wed", "19:20:00", "20:10:00")],
      holidays: {},
      axis: "class",
      slotPicks: ["wed|19:20"],
      pace: "period",
      lookaheadDays: 14,
    });
    expect(noPos(s.targets)).toEqual([{ lessonNo: 1, date: "2026-09-16", slotStart: "19:20" }]);
  });

  it("day 단위면 그 날 고른 칸 전부에 같은 차수", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1],
      schedules: WITH_SEATS,
      holidays: {},
      axis: "class",
      slotPicks: ["mon|18:20", "mon|19:20"],
      pace: "day",
      lookaheadDays: 14,
    });
    expect(noPos(s.targets)).toEqual([
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
      slotPicks: [],
      pace: "period",
      lookaheadDays: 14,
    });
    expect(noPos(s.targets)).toEqual([{ lessonNo: 1, date: "2026-09-14", slotStart: "20:20" }]);
  });
});

/**
 * 🔴 **회차 미루기·당기기**(0282a) — 원장 2026-09-22 *"실제 에서는 수업 회차를 한주 미루거나 당기거나
 *    할수있게 하고싶음 미루면 차수 무시하고 수업내용 기입해서 쓸수있게"*.
 */
describe("buildLessonSchedule — 회차 미루기·당기기(shifts)", () => {
  const MON_ONLY = [row("mon", "18:20:00", "19:20:00")];

  it("미루면 그 칸은 비고 **차수를 안 쓴다** — 뒤가 한 주씩 밀린다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14", // 월
      lessonNos: [1, 2],
      schedules: MON_ONLY,
      holidays: {},
      axis: "class",
      slotPicks: ["mon|18:20"],
      shifts: { "2026-09-21|18:20": "skip" }, // 둘째 주를 미룬다
      pace: "period",
      lookaheadDays: 28,
    });
    expect(noPos(s.targets)).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "18:20" },
      // 9/21은 통째로 비고(자유 기입), 2차수는 9/28로 밀린다.
      { lessonNo: 2, date: "2026-09-28", slotStart: "18:20" },
    ]);
  });

  it("🔴 미룬 칸은 **휴일로 세지 않는다** — 사람이 내린 결정이지 연휴가 아니다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1],
      schedules: MON_ONLY,
      holidays: {},
      axis: "class",
      slotPicks: ["mon|18:20"],
      shifts: { "2026-09-14|18:20": "skip" },
      pace: "period",
      lookaheadDays: 14,
    });
    expect(s.skippedHolidays).toEqual([]);
    expect(noPos(s.targets)).toEqual([{ lessonNo: 1, date: "2026-09-21", slotStart: "18:20" }]);
  });

  it("당기면 그 칸의 차수를 버리고 **다음 차수**가 온다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3],
      schedules: MON_ONLY,
      holidays: {},
      axis: "class",
      slotPicks: ["mon|18:20"],
      shifts: { "2026-09-21|18:20": "advance" },
      pace: "period",
      lookaheadDays: 28,
    });
    expect(noPos(s.targets)).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "18:20" },
      { lessonNo: 3, date: "2026-09-21", slotStart: "18:20" }, // 2차수를 버렸다
    ]);
  });

  it("day 단위 — 그 날이 통째로 미뤄지면 차수를 안 쓴다", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2],
      schedules: [row("mon", "18:20:00", "19:20:00"), row("mon", "19:20:00", "20:10:00")],
      holidays: {},
      axis: "class",
      slotPicks: ["mon|18:20", "mon|19:20"],
      shifts: { "2026-09-14|18:20": "skip", "2026-09-14|19:20": "skip" },
      pace: "day",
      lookaheadDays: 14,
    });
    expect(noPos(s.targets)).toEqual([
      { lessonNo: 1, date: "2026-09-21", slotStart: "18:20" },
      { lessonNo: 1, date: "2026-09-21", slotStart: "19:20" },
    ]);
  });

  it("표식이 없으면 종전과 똑같다(회귀 방지)", () => {
    const base = {
      startDate: "2026-09-14",
      lessonNos: [1, 2],
      schedules: MON_ONLY,
      holidays: {},
      axis: "class" as const,
      slotPicks: ["mon|18:20"],
      pace: "period" as const,
      lookaheadDays: 28,
    };
    expect(buildLessonSchedule({ ...base, shifts: {} })).toEqual(buildLessonSchedule(base));
  });
});

describe("교시 안 차수 자리(1·2차수) — 원장 2026-10-16", () => {
  it("parseSlotPick은 자리를 읽고, 범위 밖·모양 틀림은 거절한다", () => {
    expect(parseSlotPick("tue|17:20|2")).toEqual({ dow: "tue", start: "17:20", pos: 2 });
    expect(parseSlotPick("tue|17:20|0")).toBeNull();
    expect(parseSlotPick("tue|17:20|5")).toBeNull();
    expect(parseSlotPick("tue|17:20|02")).toBeNull();
    expect(parseSlotPick("tue|17:20|1|2")).toBeNull();
  });

  it("lessonsInSlot = 고른 자리 수 · 자리 없는 옛 값은 1", () => {
    const picks = new Set(["tue|17:20|1", "tue|17:20|2", "fri|17:20|2", "mon|18:20"]);
    expect(lessonsInSlot(picks, "tue", "17:20")).toBe(2);
    expect(lessonsInSlot(picks, "fri", "17:20")).toBe(1);
    expect(lessonsInSlot(picks, "mon", "18:20")).toBe(1);
    expect(lessonsInSlot(picks, "wed", "17:20")).toBe(0);
  });

  it("🔑 '월 1·2차수 · 수 1차수'면 한 주에 3차수 — 같은 교시에 차수 둘이 순서대로", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3, 4, 5, 6],
      schedules: MON_WED,
      holidays: {},
      axis: "class",
      slotPicks: ["mon|18:20|1", "mon|18:20|2", "wed|18:20|1"],
      pace: "min25",
      lookaheadDays: 14,
    });
    expect(noPos(s.targets)).toEqual([
      { lessonNo: 1, date: "2026-09-14", slotStart: "18:20" },
      { lessonNo: 2, date: "2026-09-14", slotStart: "18:20" },
      { lessonNo: 3, date: "2026-09-16", slotStart: "18:20" },
      { lessonNo: 4, date: "2026-09-21", slotStart: "18:20" },
      { lessonNo: 5, date: "2026-09-21", slotStart: "18:20" },
      { lessonNo: 6, date: "2026-09-23", slotStart: "18:20" },
    ]);
    expect(s.unplaced).toEqual([]);
  });

  it("휴일은 그 교시의 차수 둘 다 건너뛴다(소비 안 함)", () => {
    const s = buildLessonSchedule({
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3],
      schedules: MON_WED,
      holidays: { "2026-09-14": "테스트휴일" },
      axis: "class",
      slotPicks: ["mon|18:20|1", "mon|18:20|2", "wed|18:20|1"],
      pace: "min25",
      lookaheadDays: 14,
    });
    expect(s.targets.map((t) => [t.lessonNo, t.date])).toEqual([
      [1, "2026-09-16"],
      [2, "2026-09-21"],
      [3, "2026-09-21"],
    ]);
  });

  it("미루기(skip)는 그 교시 전체를 비운다 · 당기기(advance)는 차수 하나만 버린다", () => {
    const base = {
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3, 4],
      schedules: MON_WED,
      holidays: {},
      axis: "class" as const,
      slotPicks: ["mon|18:20|1", "mon|18:20|2"],
      pace: "min25" as const,
      lookaheadDays: 14,
    };
    const skipped = buildLessonSchedule({ ...base, shifts: { "2026-09-14|18:20": "skip" } });
    expect(skipped.targets.map((t) => [t.lessonNo, t.date])).toEqual([
      [1, "2026-09-21"],
      [2, "2026-09-21"],
    ]);
    const advanced = buildLessonSchedule({ ...base, shifts: { "2026-09-14|18:20": "advance" } });
    expect(advanced.targets.map((t) => [t.lessonNo, t.date])).toEqual([
      [2, "2026-09-14"],
      [3, "2026-09-14"],
      [4, "2026-09-21"],
    ]);
  });

  // 원장 2026-10-20 *"수업이 2개면 각각 미룸, 당김"* — 줄 표식(0382a)은 그 교재 그 자리 **한 차수만**.
  //   옛 칸 표식은 미룸이 두 차수·당김이 한 차수라, 섞어 누르면 순서가 어긋났다(위 테스트가 그 비대칭이다).
  describe("줄 표식(교재·자리) — 한 차수씩", () => {
    const BOOK = "0b6f3c1e-1111-4222-8333-944455556666";
    const OTHER = "0b6f3c1e-aaaa-4bbb-8ccc-dddddddddddd";
    const base = {
      startDate: "2026-09-14",
      lessonNos: [1, 2, 3, 4, 5],
      schedules: MON_WED,
      holidays: {},
      axis: "class" as const,
      slotPicks: ["mon|18:20|1", "mon|18:20|2", "wed|18:20|1"],
      pace: "min25" as const,
      lookaheadDays: 14,
      lane: BOOK,
    };
    const at = (sh: Record<string, "skip" | "advance">) =>
      buildLessonSchedule({ ...base, shifts: sh }).targets.map((t) => `${t.lessonNo}@${t.date.slice(8)}#${t.pos}`);

    it("표식 없음 — 월 1·2 · 수 3 · 월 4·5", () => {
      expect(at({})).toEqual(["1@14#1", "2@14#2", "3@16#1", "4@21#1", "5@21#2"]);
    });

    it("미룸(1번 자리) = 그 자리만 비고 **한 차수** 밀린다 — 칸 통째(두 차수)가 아니다", () => {
      expect(at({ [`2026-09-14|18:20|${BOOK}|1`]: "skip" })).toEqual(["1@14#2", "2@16#1", "3@21#1", "4@21#2", "5@23#1"]);
    });

    it("당김(2번 자리) = 그 자리 차수(2)만 버리고 다음 차수가 온다 — 1번 자리는 그대로", () => {
      expect(at({ [`2026-09-14|18:20|${BOOK}|2`]: "advance" })).toEqual(["1@14#1", "3@14#2", "4@16#1", "5@21#1"]);
    });

    it("미룸과 당김이 **같은 크기**라 서로 지운다 — 앞에서 미루고 뒤에서 당기면 그 사이만 한 칸 늦다", () => {
      expect(
        at({ [`2026-09-14|18:20|${BOOK}|1`]: "skip", [`2026-09-16|18:20|${BOOK}|1`]: "advance" }),
      ).toEqual(["1@14#2", "3@16#1", "4@21#1", "5@21#2"]);
    });

    it("🔴 같은 줄을 두 번 당기면 **그 자리** 차수가 둘 건너뛴다(쌓기 `pos+4`) — 다음 자리 차수가 빠지지 않는다", () => {
      expect(at({ [`2026-09-14|18:20|${BOOK}|1`]: "advance", [`2026-09-14|18:20|${BOOK}|5`]: "advance" })).toEqual([
        "3@14#1",
        "4@14#2",
        "5@16#1",
      ]);
    });

    it("다른 교재의 줄 표식은 이 배정을 움직이지 않는다(같은 칸의 다른 줄은 그대로)", () => {
      expect(at({ [`2026-09-14|18:20|${OTHER}|1`]: "skip" })).toEqual(at({}));
    });

    it("옛 칸 표식은 그대로 읽는다(0382a 전 표식 — 교시 통째)", () => {
      expect(at({ "2026-09-14|18:20": "skip" })).toEqual(["1@16#1", "2@21#1", "3@21#2", "4@23#1"]);
    });
  });

  it("groupSlotPicks — 요일 순 · 자리 순으로 묶는다", () => {
    expect(groupSlotPicks(["fri|17:20|1", "tue|17:20|2", "tue|17:20|1", "mon|18:20", "bad"])).toEqual([
      { dow: "mon", start: "18:20", positions: [] },
      { dow: "tue", start: "17:20", positions: [1, 2] },
      { dow: "fri", start: "17:20", positions: [1] },
    ]);
  });
});
