import { describe, expect, it } from "vitest";
import {
  foldSeating,
  groupAdjacentSlots,
  isAdjacentSlot,
  pickClassDayHit,
  SEATING_PERIOD_COLS,
  seatingHeaderClass,
  seatingSummary,
  spanAdjacentEnd,
} from "./seating";
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
  roomName: over.roomName ?? null,
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
    expect(classes[0]?.firstEnd).toBe("17:20");
    expect(classes[0]?.students.map((s) => s.studentId)).toEqual(["김철수", "이영희"]);
  });

  it("이어지는 연강은 끝까지 — BS4F 20:10~21:05 + 21:05~22:00 → 20:10~22:00", () => {
    const [klass] = foldSeating([
      slot({
        key: "p1",
        classId: "bs4f",
        className: "고등M 개별 BS4F",
        subject: "math",
        slotStart: "20:10",
        slotEnd: "21:05",
        saveSlot: null,
      }),
      slot({
        key: "p2",
        classId: "bs4f",
        className: "고등M 개별 BS4F",
        subject: "math",
        slotStart: "21:05",
        slotEnd: "22:00",
        saveSlot: null,
      }),
    ]);
    expect(klass?.firstStart).toBe("20:10");
    expect(klass?.firstEnd).toBe("22:00");
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

  it("강의실 이름은 오늘 슬롯 중 처음 있는 값을 쓴다", () => {
    const [klass] = foldSeating([
      slot({ key: "p1", classId: "m", slotStart: "16:20", roomName: null }),
      slot({ key: "p2", classId: "m", slotStart: "17:20", roomName: "본원305" }),
    ]);
    expect(klass?.roomName).toBe("본원305");
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

describe("SEATING_PERIOD_COLS", () => {
  it("한 강의실 가로는 교시 4칸", () => {
    expect(SEATING_PERIOD_COLS).toBe(4);
  });
});

describe("seatingHeaderClass", () => {
  it("대기(시작 전·유예)는 회색, 출결이 열린 뒤는 네이비", () => {
    expect(seatingHeaderClass("before")).toContain("bg-att-weekend");
    expect(seatingHeaderClass("before")).not.toContain("bg-primary");
    expect(seatingHeaderClass("grace")).toContain("bg-att-weekend");
    expect(seatingHeaderClass("due")).toContain("bg-primary");
    expect(seatingHeaderClass("ended")).toContain("bg-primary");
  });
});

describe("foldSeating phase", () => {
  it("카드 국면은 첫 교시 — 시작 전 저녁 반이 오전 종료로 네이비가 되지 않는다", () => {
    const [klass] = foldSeating([
      slot({
        key: "eve",
        classId: "bs4f",
        className: "고등M 개별 BS4F",
        slotStart: "20:10",
        slotEnd: "22:00",
        phase: "before",
      }),
    ]);
    expect(klass?.phase).toBe("before");
    expect(seatingHeaderClass(klass!.phase)).toContain("bg-att-weekend");
  });
});

describe("spanAdjacentEnd", () => {
  it("끝이 다음에 닿지 않으면 앞 블록만", () => {
    expect(
      spanAdjacentEnd([
        { slotStart: "10:00", slotEnd: "10:50" },
        { slotStart: "16:20", slotEnd: "17:10" },
      ]),
    ).toBe("10:50");
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

describe("groupAdjacentSlots", () => {
  const kids = [student("곽민주"), student("김소은")];

  it("끝이 다음에 닿는 같은 반·같은 강사는 한 장 — 14:30~15:25 + 15:25~16:20", () => {
    const a = slot({
      key: "p1",
      classId: "bs1j",
      className: "초등M 초4 BS1J",
      teacherId: "kim",
      slotStart: "14:30",
      slotEnd: "15:25",
      saveSlot: null,
      subject: "math",
      phase: "ended",
      students: kids,
    });
    const b = slot({
      key: "p2",
      classId: "bs1j",
      className: "초등M 초4 BS1J",
      teacherId: "kim",
      slotStart: "15:25",
      slotEnd: "16:20",
      saveSlot: null,
      subject: "math",
      phase: "ended",
      students: kids,
    });
    expect(isAdjacentSlot(a, b)).toBe(true);
    const grouped = groupAdjacentSlots([b, a]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.slotStart).toBe("14:30");
    expect(grouped[0]?.slotEnd).toBe("16:20");
    expect(grouped[0]?.students).toHaveLength(2);
    expect(grouped[0]?.saveSlot).toBeNull(); // 수학 하루 한 행
  });

  it("같은 반이어도 시간이 안 이어지면 묶지 않는다", () => {
    const grouped = groupAdjacentSlots([
      slot({ key: "am", classId: "c", teacherId: "t", slotStart: "10:00", slotEnd: "10:50", students: kids }),
      slot({ key: "pm", classId: "c", teacherId: "t", slotStart: "16:20", slotEnd: "17:10", students: kids }),
    ]);
    expect(grouped).toHaveLength(2);
  });

  it("강사가 다르면 묶지 않는다", () => {
    const grouped = groupAdjacentSlots([
      slot({ key: "a", classId: "c", teacherId: "t1", slotStart: "14:30", slotEnd: "15:25" }),
      slot({ key: "b", classId: "c", teacherId: "t2", slotStart: "15:25", slotEnd: "16:20" }),
    ]);
    expect(grouped).toHaveLength(2);
  });

  it("세 교시 연강도 한 장", () => {
    const grouped = groupAdjacentSlots([
      slot({
        key: "1",
        classId: "c",
        teacherId: "t",
        subject: "math",
        saveSlot: null,
        slotStart: "14:00",
        slotEnd: "14:50",
        students: kids,
      }),
      slot({
        key: "2",
        classId: "c",
        teacherId: "t",
        subject: "math",
        saveSlot: null,
        slotStart: "14:50",
        slotEnd: "15:40",
        students: kids,
      }),
      slot({
        key: "3",
        classId: "c",
        teacherId: "t",
        subject: "math",
        saveSlot: null,
        slotStart: "15:40",
        slotEnd: "16:30",
        students: kids,
      }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.slotStart).toBe("14:00");
    expect(grouped[0]?.slotEnd).toBe("16:30");
  });

  it("영어 연속 교시는 묶지 않는다 — 교시마다 다른 행·다른 교재", () => {
    const grouped = groupAdjacentSlots([
      slot({
        key: "e1",
        classId: "e",
        teacherId: "t",
        subject: "english",
        saveSlot: "14:30",
        slotStart: "14:30",
        slotEnd: "15:25",
      }),
      slot({
        key: "e2",
        classId: "e",
        teacherId: "t",
        subject: "english",
        saveSlot: "15:25",
        slotStart: "15:25",
        slotEnd: "16:20",
      }),
    ]);
    expect(grouped).toHaveLength(2);
  });

  it("사이에 다른 반이 끼어도 수학 연강은 붙는다", () => {
    const grouped = groupAdjacentSlots([
      slot({
        key: "a1",
        classId: "a",
        className: "A",
        teacherId: "t",
        subject: "math",
        saveSlot: null,
        slotStart: "14:30",
        slotEnd: "15:25",
        students: kids,
      }),
      slot({
        key: "b",
        classId: "b",
        className: "B",
        teacherId: "t",
        subject: "math",
        saveSlot: null,
        slotStart: "14:40",
        slotEnd: "15:20",
      }),
      slot({
        key: "a2",
        classId: "a",
        className: "A",
        teacherId: "t",
        subject: "math",
        saveSlot: null,
        slotStart: "15:25",
        slotEnd: "16:20",
        students: kids,
      }),
    ]);
    expect(grouped.filter((s) => s.classId === "a")).toHaveLength(1);
    expect(grouped.find((s) => s.classId === "a")?.slotEnd).toBe("16:20");
    expect(grouped.filter((s) => s.classId === "b")).toHaveLength(1);
  });
});
