import { describe, expect, it } from "vitest";
import { buildChildTimetable, classBlocksByDate, classDatesOf, type TimetableSlot } from "./parent-timetable";

const week = [
  { day: "mon", ymd: "2026-10-05" },
  { day: "tue", ymd: "2026-10-06" },
  { day: "wed", ymd: "2026-10-07" },
  { day: "thu", ymd: "2026-10-08" },
  { day: "fri", ymd: "2026-10-09" },
];
const classes = new Map([
  ["M", { name: "수학 A", subjectLabel: "수학" }],
  ["E", { name: "영어 B", subjectLabel: "영어" }],
]);
const slot = (classId: string, day: string, start: string, end: string, extra: Partial<TimetableSlot> = {}): TimetableSlot => ({
  classId, day, start, end, validFrom: null, validTo: null, ...extra,
});
const enr = (classId: string, extra = {}) => ({ classId, startDate: "2026-09-01", endDate: null, onHold: false, attendanceDays: [] as string[], ...extra });
const rowOf = (rows: ReturnType<typeof buildChildTimetable>, day: string) => rows.find((r) => r.day === day)!.blocks;

describe("buildChildTimetable — 학부모 수업 시간표", () => {
  it("이어지는 교시는 한 줄로 묶고, 다른 반은 시각 순으로 따로", () => {
    const rows = buildChildTimetable({
      week, classes, enrollments: [enr("M"), enr("E")],
      slots: [slot("M", "tue", "17:15", "18:10"), slot("M", "tue", "16:20", "17:15"), slot("E", "tue", "18:20", "19:10")],
    });
    expect(rows).toHaveLength(5);
    expect(rowOf(rows, "tue").map((b) => `${b.className} ${b.start}~${b.end}`)).toEqual(["수학 A 16:20~18:10", "영어 B 18:20~19:10"]);
    expect(rowOf(rows, "mon")).toEqual([]);
  });

  it("쉬는 시간이 10분을 넘으면 따로", () => {
    const rows = buildChildTimetable({
      week, classes, enrollments: [enr("M")],
      slots: [slot("M", "wed", "16:00", "17:00"), slot("M", "wed", "17:30", "18:30")],
    });
    expect(rowOf(rows, "wed")).toHaveLength(2);
  });

  it("끝난 배치 · 아직 안 시작한 배치 · 대기 · 수강 기간 밖 · 분리등원 밖 요일은 뺀다", () => {
    const rows = buildChildTimetable({
      week, classes,
      enrollments: [enr("M", { attendanceDays: ["thu"] }), enr("E", { onHold: true })],
      slots: [
        slot("M", "mon", "16:00", "17:00"),
        slot("M", "thu", "16:00", "17:00"),
        slot("M", "thu", "19:00", "20:00", { validTo: "2026-09-30" }),
        slot("M", "thu", "20:00", "21:00", { validFrom: "2026-11-01" }),
        slot("E", "thu", "18:00", "19:00"),
      ],
    });
    expect(rowOf(rows, "mon")).toEqual([]);
    expect(rowOf(rows, "thu").map((b) => `${b.start}~${b.end}`)).toEqual(["16:00~17:00"]);
    const ended = buildChildTimetable({ week, classes, enrollments: [enr("M", { endDate: "2026-10-06" })], slots: [slot("M", "tue", "16:00", "17:00"), slot("M", "wed", "16:00", "17:00")] });
    expect(rowOf(ended, "tue")).toHaveLength(1);
    expect(rowOf(ended, "wed")).toEqual([]);
  });

  it("수업 있는 날 — 시간표와 같은 판정으로 날짜만 뽑는다", () => {
    const dates = classDatesOf({
      dates: week,
      enrollments: [enr("M", { attendanceDays: ["thu"] })],
      slots: [slot("M", "mon", "16:00", "17:00"), slot("M", "thu", "16:00", "17:00")],
    });
    expect([...dates]).toEqual(["2026-10-08"]);
    const byDate = classBlocksByDate({
      dates: week, classes, enrollments: [enr("M")],
      slots: [slot("M", "thu", "16:20", "17:15"), slot("M", "thu", "17:15", "18:10")],
    });
    expect([...byDate.keys()]).toEqual(["2026-10-08"]);
    expect(byDate.get("2026-10-08")).toMatchObject([{ subjectLabel: "수학", start: "16:20", end: "18:10" }]);
  });
});
