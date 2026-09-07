/**
 * '출결 모드' 카드 목록 — 정렬·자리 제외·일괄 대상·접기·낙관 반영.
 *
 * 🔴 여기서 잠그는 것은 **좌석표와 같은 값을 쓴다**는 사실이다. 특히 `bulkPlan.slot`(저장 축)이
 *    카드 머리 시각(`firstStart`, 지금 교시)이 아니라 학생의 `writeSlot`(하루 첫 교시)이어야 한다 —
 *    둘이 갈리면 영어 반이 조용히 다른 교시에 저장돼 시수(→ 급여)가 두 벌이 된다.
 */
import { describe, expect, it } from "vitest";
import type { LiveBoard, LiveBoardSlot, LiveStudent } from "../live/types";
import {
  applyQuickMarks,
  bulkPlan,
  initiallyCollapsed,
  isFullyMarked,
  noteOnStatusChange,
  quickCellKey,
  quickClasses,
  quickSummary,
} from "./board";

const student = (name: string, over: Partial<LiveStudent> = {}): LiveStudent => ({
  studentId: name,
  studentName: name,
  englishName: null,
  schoolGrade: "경명여중2",
  parentPhone: null,
  studentPhone: null,
  status: null,
  note: null,
  signal: null,
  ...over,
});

const slot = (over: Partial<LiveBoardSlot> & { classId: string; className: string }): LiveBoardSlot => ({
  key: `${over.classId}@${over.slotStart ?? "16:20"}`,
  subject: "math",
  slotStart: "16:20",
  saveSlot: null,
  slotEnd: "17:20",
  periodLabel: null,
  teacherId: "t1",
  teacherName: "김강사",
  slotTeacherLabel: null,
  roomName: "601호",
  students: [],
  hasAnyRecord: false,
  recordedCount: 0,
  phase: "due",
  band: "now",
  ownedByMe: true,
  ...over,
});

const board = (slots: LiveBoardSlot[]): LiveBoard => ({
  date: "2026-08-20",
  isToday: true,
  scopedToSelf: true,
  canEdit: true,
  totals: { expected: 0, recorded: 0, slots: slots.length },
  teachers: [
    {
      teacherId: "t1",
      seatLabel: null,
      teacherName: "김강사",
      teacherPhone: null,
      slots,
      expected: 0,
      recorded: 0,
    },
  ],
});

describe("quickClasses", () => {
  it("교시 시각 순으로 나열한다(같은 시각이면 반 이름 순)", () => {
    const classes = quickClasses(
      board([
        slot({ classId: "c2", className: "나반", slotStart: "18:20", slotEnd: "19:20", students: [student("가")] }),
        slot({ classId: "c1", className: "가반", slotStart: "15:25", slotEnd: "16:20", students: [student("나")] }),
      ]),
    );
    expect(classes.map((c) => c.className)).toEqual(["가반", "나반"]);
    expect(classes[0]!.firstStart).toBe("15:25");
  });

  it("자리(LAB·JJ) 교시는 뺀다 — 그 칸은 자리 담당이 찍는다", () => {
    const classes = quickClasses(
      board([
        slot({ classId: "c1", className: "가반", students: [student("나")] }),
        slot({
          classId: "cLab",
          className: "랩실반",
          slotStart: "19:00",
          teacherId: null,
          slotTeacherLabel: "LAB",
          students: [student("다")],
        }),
      ]),
    );
    expect(classes.map((c) => c.className)).toEqual(["가반"]);
  });

  it("한 반의 연강 교시는 한 카드로 접힌다 — 학생이 두 번 나오지 않는다", () => {
    const classes = quickClasses(
      board([
        slot({ classId: "c1", className: "가반", slotStart: "15:25", slotEnd: "16:20", students: [student("나")] }),
        slot({ classId: "c1", className: "가반", slotStart: "16:20", slotEnd: "17:15", students: [student("나")] }),
      ]),
    );
    expect(classes).toHaveLength(1);
    expect(classes[0]!.students.map((s) => s.studentName)).toEqual(["나"]);
  });
});

describe("bulkPlan — '일괄 출결 N'", () => {
  it("미입력 칸만 대상이고, 라벨 숫자와 보내는 칸 수가 같다", () => {
    const [klass] = quickClasses(
      board([
        slot({
          classId: "c1",
          className: "가반",
          students: [student("가"), student("나", { status: "absent" }), student("다")],
        }),
      ]),
    );
    const plan = bulkPlan(klass!);
    expect(plan.cells.map((c) => c.studentId)).toEqual(["가", "다"]);
    expect(plan.cells).toHaveLength(2);
  });

  it("수학(day-level)의 저장 축은 null — '그날 전체' 한 행", () => {
    const [klass] = quickClasses(
      board([slot({ classId: "c1", className: "가반", subject: "math", students: [student("가")] })]),
    );
    expect(bulkPlan(klass!).slot).toBeNull();
  });

  it("🔴 영어(교시별)의 저장 축은 **하루 첫 교시** — 카드 머리 시각(지금 교시)이 아니다", () => {
    // 14:20 교시는 이미 끝났고(ended) 15:00 교시가 열려 있다 → 카드 머리는 15:00, 저장 축은 14:20.
    const [klass] = quickClasses(
      board([
        slot({
          classId: "e1",
          className: "DP6",
          subject: "english",
          slotStart: "14:20",
          slotEnd: "15:00",
          saveSlot: "14:20",
          band: "past",
          phase: "ended",
          students: [student("가")],
        }),
        slot({
          classId: "e1",
          className: "DP6",
          subject: "english",
          slotStart: "15:00",
          slotEnd: "15:40",
          saveSlot: "15:00",
          roomName: "랩실",
          band: "now",
          phase: "due",
          students: [student("가")],
        }),
      ]),
    );
    expect(klass!.firstStart).toBe("15:00"); // 그리는 자리 = 지금 교시
    expect(bulkPlan(klass!).slot).toBe("14:20"); // 저장 축 = 하루 첫 교시
    expect(klass!.students[0]!.writeSlot).toBe("14:20");
  });

  it("다 찍은 반은 대상이 0 — 버튼이 비활성이 되는 근거", () => {
    const [klass] = quickClasses(
      board([
        slot({ classId: "c1", className: "가반", students: [student("가", { status: "present" })] }),
      ]),
    );
    expect(bulkPlan(klass!).cells).toHaveLength(0);
  });
});

describe("접기", () => {
  it("다 찍은 반만 처음부터 접힌다", () => {
    const classes = quickClasses(
      board([
        slot({ classId: "c1", className: "가반", students: [student("가", { status: "present" })] }),
        slot({ classId: "c2", className: "나반", slotStart: "18:20", students: [student("나")] }),
      ]),
    );
    expect([...initiallyCollapsed(classes)]).toEqual(["c1"]);
    expect(isFullyMarked(classes[0]!)).toBe(true);
    expect(isFullyMarked(classes[1]!)).toBe(false);
  });

  it("학생이 0명인 반은 '다 찍음'이 아니다 — 빈 카드가 조용히 접히지 않게", () => {
    const classes = quickClasses(board([slot({ classId: "c1", className: "가반", students: [] })]));
    expect(isFullyMarked(classes[0]!)).toBe(false);
  });
});

describe("applyQuickMarks — 낙관 반영", () => {
  const classes = quickClasses(
    board([
      slot({ classId: "c1", className: "가반", students: [student("가"), student("나")] }),
    ]),
  );

  it("덮은 칸은 상태·메모·표시색이 함께 바뀐다", () => {
    const next = applyQuickMarks(classes, {
      [quickCellKey("c1", "가")]: { status: "absent", note: "여행" },
    });
    const 가 = next[0]!.students.find((s) => s.studentId === "가")!;
    expect(가.status).toBe("absent");
    expect(가.note).toBe("여행");
    expect(가.mark).toBe("absent");
    // 안 덮은 칸은 그대로.
    expect(next[0]!.students.find((s) => s.studentId === "나")!.status).toBeNull();
  });

  it("🔴 요약 숫자는 덮은 목록에서 나온다 — 방금 찍은 학생이 '미출결'에 남지 않는다", () => {
    expect(quickSummary(classes).unmarked).toBe(2);
    const next = applyQuickMarks(classes, {
      [quickCellKey("c1", "가")]: { status: "present", note: null },
    });
    expect(quickSummary(next).unmarked).toBe(1);
    expect(quickSummary(next).recorded).toBe(1);
  });

  it("덮을 게 없으면 원본을 그대로 돌려준다(불필요한 리렌더 방지)", () => {
    expect(applyQuickMarks(classes, {})).toBe(classes);
  });
});

describe("noteOnStatusChange — 상태를 바꿀 때 사유 메모", () => {
  it("결석 → 출석이면 사유를 비운다('여행'이 출석 칸에 남지 않게)", () => {
    expect(noteOnStatusChange("absent", "present")).toBeNull();
  });

  it("지각 → 결석이면 등원 메모를 비운다('17:05 등원'이 결석 사유가 되지 않게)", () => {
    expect(noteOnStatusChange("late", "absent")).toBeNull();
  });

  it("같은 상태를 다시 찍으면 메모를 건드리지 않는다(사유 유지)", () => {
    expect(noteOnStatusChange("absent", "absent")).toBeUndefined();
    expect(noteOnStatusChange("excused", "absent")).toBeUndefined();
  });

  it("빈 칸·출석 칸의 메모는 건드리지 않는다 — 보강 연결 흔적 등 남의 기록 보호", () => {
    expect(noteOnStatusChange(null, "absent")).toBeUndefined();
    expect(noteOnStatusChange("present", "absent")).toBeUndefined();
    expect(noteOnStatusChange("makeup", "absent")).toBeUndefined();
  });
});
