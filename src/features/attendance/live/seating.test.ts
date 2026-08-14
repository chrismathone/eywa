import { describe, expect, it } from "vitest";
import { foldSeating, pickClassDayHit, seatingSummary } from "./seating";
import type { LiveBoardSlot } from "./types";

const slot = (over: Partial<LiveBoardSlot> & { key: string; slotStart: string }): LiveBoardSlot => ({
  classId: over.classId ?? "c1",
  className: over.className ?? "A반",
  subject: "english",
  saveSlot: over.slotStart,
  slotEnd: "17:20",
  periodLabel: null,
  teacherId: null,
  teacherName: "김강사",
  slotTeacherLabel: null,
  students: [],
  hasAnyRecord: false,
  recordedCount: 0,
  phase: "due",
  ownedByMe: false,
  ...over,
});

const student = (
  name: string,
  over: { status?: string | null; recordedAt?: string | null; recordSlot?: string | null } = {},
) => ({
  studentId: name,
  studentName: name,
  schoolGrade: null,
  parentPhone: null,
  studentPhone: null,
  status: over.status ?? null,
  note: null,
  signal: over.status ? null : ("unmarked" as const),
  recordedAt: over.recordedAt ?? null,
  recordSlot: over.recordSlot ?? null,
});

describe("foldSeating", () => {
  it("섹션 = 반, 오늘 첫 교시 시작시각 순 — 같은 시각이면 반 이름순", () => {
    const classes = foldSeating([
      slot({ key: "late", classId: "c2", className: "늦은반", slotStart: "18:20" }),
      slot({ key: "z", classId: "c3", className: "Z반", slotStart: "16:20" }),
      slot({ key: "a", classId: "c1", className: "A반", slotStart: "16:20" }),
    ]);
    expect(classes.map((c) => c.className)).toEqual(["A반", "Z반", "늦은반"]);
  });

  it("연강 2~3교시도 섹션 하나·학생 칸 하나", () => {
    const classes = foldSeating([
      slot({
        key: "p1",
        classId: "math1",
        className: "중3A",
        subject: "math",
        slotStart: "16:20",
        saveSlot: null,
        students: [student("김철수"), student("이영희")],
      }),
      slot({
        key: "p2",
        classId: "math1",
        className: "중3A",
        subject: "math",
        slotStart: "17:20",
        saveSlot: null,
        students: [student("김철수"), student("이영희")],
      }),
    ]);
    expect(classes).toHaveLength(1);
    expect(classes[0]?.firstStart).toBe("16:20");
    expect(classes[0]?.students.map((s) => s.studentId)).toEqual(["김철수", "이영희"]);
  });

  it("수학 day-level 출석이 있으면 둘째 교시도 출석 — 거짓 미출결이 아니다", () => {
    const [klass] = foldSeating([
      slot({
        key: "p1",
        classId: "m",
        className: "중3A",
        subject: "math",
        slotStart: "16:20",
        saveSlot: null,
        phase: "due",
        students: [student("김철수", { status: "present", recordedAt: "T1", recordSlot: null })],
      }),
      slot({
        key: "p2",
        classId: "m",
        className: "중3A",
        subject: "math",
        slotStart: "17:20",
        saveSlot: null,
        phase: "due",
        students: [student("김철수")], // 교시축이면 빈 칸 = 거짓 미출결
      }),
    ]);
    expect(klass?.students[0]?.mark).toBe("present");
    expect(klass?.students[0]?.writeSlot).toBeNull(); // 기존 day-level 행을 갱신
  });

  it("영어 신규는 첫 교시에만 쓴다 — 한 클릭이 2행을 만들지 않는다", () => {
    const [klass] = foldSeating([
      slot({
        key: "p1",
        classId: "e",
        className: "CR1A",
        subject: "english",
        slotStart: "16:20",
        saveSlot: "16:20",
        students: [student("박민수")],
      }),
      slot({
        key: "p2",
        classId: "e",
        className: "CR1A",
        subject: "english",
        slotStart: "18:20",
        saveSlot: "18:20",
        students: [student("박민수")],
      }),
    ]);
    expect(klass?.students[0]?.writeSlot).toBe("16:20");
  });

  it("영어에 이미 둘째 교시 행이 있으면 그 행을 갱신 — 첫 교시 행을 하나 더 만들지 않는다", () => {
    const [klass] = foldSeating([
      slot({
        key: "p1",
        classId: "e",
        className: "CR1A",
        subject: "english",
        slotStart: "16:20",
        students: [student("박민수")],
      }),
      slot({
        key: "p2",
        classId: "e",
        className: "CR1A",
        subject: "english",
        slotStart: "18:20",
        students: [student("박민수", { status: "present", recordedAt: "T2", recordSlot: "18:20" })],
      }),
    ]);
    expect(klass?.students[0]?.mark).toBe("present");
    expect(klass?.students[0]?.writeSlot).toBe("18:20");
  });

  it("첫 교시 유예 안의 빈 칸은 대기", () => {
    const [klass] = foldSeating([
      slot({
        key: "c",
        slotStart: "16:20",
        phase: "grace",
        students: [student("김대기"), student("이출석", { status: "present", recordedAt: "T" })],
      }),
    ]);
    expect(klass?.students.find((s) => s.studentId === "김대기")?.mark).toBe("waiting");
    expect(klass?.students.find((s) => s.studentId === "이출석")?.mark).toBe("present");
  });
});

describe("pickClassDayHit", () => {
  it("여러 행이면 recorded_at 최신", () => {
    const hit = pickClassDayHit([
      { status: "absent", note: null, recordedAt: "2026-08-14T07:00:00Z", recordSlot: "16:20" },
      { status: "present", note: null, recordedAt: "2026-08-14T08:00:00Z", recordSlot: "18:20" },
    ]);
    expect(hit?.status).toBe("present");
    expect(hit?.recordSlot).toBe("18:20");
  });

  it("기록 없는 칸은 고르지 않는다", () => {
    expect(pickClassDayHit([{ status: null, note: null, recordedAt: null, recordSlot: null }])).toBeNull();
  });
});

describe("seatingSummary", () => {
  it("칸 수 = 반×학생 (교시로 안 부푼다)", () => {
    const classes = foldSeating([
      slot({
        key: "p1",
        classId: "m",
        className: "중3A",
        subject: "math",
        slotStart: "16:20",
        phase: "due",
        students: [
          student("a"),
          student("b", { status: "present", recordedAt: "T" }),
          student("c", { status: "absent", recordedAt: "T" }),
        ],
      }),
      slot({
        key: "p2",
        classId: "m",
        className: "중3A",
        subject: "math",
        slotStart: "17:20",
        phase: "due",
        students: [student("a"), student("b"), student("c")],
      }),
    ]);
    expect(seatingSummary(classes)).toEqual({ unmarked: 1, absent: 1, recorded: 2, expected: 3 });
  });
});
