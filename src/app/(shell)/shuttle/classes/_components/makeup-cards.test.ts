import { describe, expect, it } from "vitest";
import type { MakeupReservation } from "@/features/attendance/makeup-reservation";
import { buildMakeupCards } from "./makeup-cards";

const week = [
  { day: "mon", ymd: "2026-10-26" },
  { day: "tue", ymd: "2026-10-27" },
  { day: "wed", ymd: "2026-10-28" },
  { day: "thu", ymd: "2026-10-29" },
  { day: "fri", ymd: "2026-10-30" },
];
const slots = [
  {
    classId: "c1",
    className: "초5 수학 A",
    subject: "math",
    students: [
      { studentId: "s1", name: "김민준", school: "칠성초", grade: "초5" },
      { studentId: "s2", name: "이서연", school: "칠성초", grade: "초6" },
    ],
  },
];
const r = (p: Partial<MakeupReservation>): MakeupReservation => ({
  id: "r",
  studentId: "s1",
  classId: "c1",
  absenceDate: "2026-10-20",
  makeupDate: "2026-10-28",
  slotStart: "17:00:00",
  slotEnd: "18:00:00",
  periodLabel: null,
  note: null,
  status: "reserved",
  createdBy: null,
  ...p,
});

describe("buildMakeupCards", () => {
  it("탑승 학생의 이번 주 보강만 · 같은 반·날짜·시간은 한 카드", () => {
    const cards = buildMakeupCards(
      [r({ id: "a" }), r({ id: "b", studentId: "s2" }), r({ id: "c", studentId: "s9" }), r({ id: "d", makeupDate: "2026-11-02" })],
      slots,
      new Set(["s1", "s2"]),
      week,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ day: "wed", start: "17:00", end: "18:00", className: "초5 수학 A", subject: "math", makeup: true });
    expect(cards[0]!.students.map((s) => s.name)).toEqual(["김민준", "이서연"]);
  });

  it("🔑 학생마다 원래 수업(결석한 날 그 반 교시 구간)을 싣는다 · 모르면 시각 null", () => {
    const withSlots = [
      { ...slots[0]!, dayOfWeek: "tue", startTime: "16:00:00", endTime: "16:50:00" },
      { ...slots[0]!, dayOfWeek: "tue", startTime: "17:00:00", endTime: "17:50:00" },
    ];
    // 2026-10-20 = 화요일
    const [card] = buildMakeupCards([r({ id: "a" })], withSlots, new Set(["s1"]), week);
    expect(card!.students[0]!.from).toEqual({ date: "2026-10-20", day: "tue", start: "16:00", end: "17:50" });
    const [card2] = buildMakeupCards([r({ id: "a", absenceDate: "2026-10-21" })], withSlots, new Set(["s1"]), week);
    expect(card2!.students[0]!.from).toEqual({ date: "2026-10-21", day: "wed", start: null, end: null });
  });

  it("시간이 다르면 다른 카드", () => {
    const cards = buildMakeupCards([r({ id: "a" }), r({ id: "b", studentId: "s2", slotStart: "18:00:00", slotEnd: "19:00:00" })], slots, new Set(["s1", "s2"]), week);
    expect(cards).toHaveLength(2);
  });
});
