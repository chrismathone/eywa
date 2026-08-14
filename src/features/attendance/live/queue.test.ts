import { describe, expect, it } from "vitest";
import {
  buildQueue,
  compareStudents,
  isSettled,
  orderQueueSubjects,
  suggestedStatus,
  type QueueClass,
  type QueueStudent,
} from "./queue";
import type { LiveSignal } from "./signals";

const student = (over: Partial<QueueStudent> & { studentId: string }): QueueStudent => ({
  studentName: over.studentId,
  schoolGrade: null,
  classId: "c1",
  className: "CR1A",
  subject: "english",
  slotStart: "16:20",
  saveSlot: null,
  teacherName: "김강사",
  signal: "unmarked" as LiveSignal,
  phase: "due",
  note: null,
  parentPhone: "010-0000-0000",
  studentPhone: null,
  followup: null,
  ...over,
});

const klass = (over: Partial<QueueClass> & { classId: string; slotStart: string }): QueueClass => ({
  className: over.classId,
  subject: "math",
  teacherId: "t1",
  teacherName: "김강사",
  teacherPhone: null,
  slotTeacherLabel: null,
  expected: 10,
  phase: "due",
  saveSlot: null,
  requested: false,
  slotCount: 1,
  slotEnd: over.slotStart,
  ...over,
});

describe("buildQueue — 레인 A 접기", () => {
  it("🔴 수학 연강 3교시는 한 장이다(저장축이 하루 한 행) — 배지가 3배로 부풀지 않게", () => {
    const q = buildQueue(
      [],
      [
        klass({ classId: "m1", slotStart: "17:20" }),
        klass({ classId: "m1", slotStart: "16:20" }),
        klass({ classId: "m1", slotStart: "18:20" }),
      ],
    );
    expect(q.lanes.classes).toHaveLength(1);
    expect(q.counts.classes).toBe(1);
    const card = q.lanes.classes[0];
    expect(card.slotStart).toBe("16:20"); // 가장 이른 교시가 대표
    expect(card.slotEnd).toBe("18:20");
    expect(card.slotCount).toBe(3);
  });

  it("영어는 교시마다 진짜 빈 칸이라 접지 않는다(saveSlot이 다르다)", () => {
    const q = buildQueue(
      [],
      [
        klass({ classId: "e1", slotStart: "16:20", saveSlot: "16:20", subject: "english" }),
        klass({ classId: "e1", slotStart: "17:20", saveSlot: "17:20", subject: "english" }),
      ],
    );
    expect(q.lanes.classes).toHaveLength(2);
    expect(q.counts.classes).toBe(2);
  });

  it("다른 반은 접히지 않는다", () => {
    const q = buildQueue([], [klass({ classId: "a", slotStart: "16:20" }), klass({ classId: "b", slotStart: "16:20" })]);
    expect(q.lanes.classes).toHaveLength(2);
  });

  it("접힌 카드의 '예정 인원'은 가장 많은 교시를 따른다(적게 보여 넘기지 않게)", () => {
    const q = buildQueue(
      [],
      [klass({ classId: "m", slotStart: "16:20", expected: 4 }), klass({ classId: "m", slotStart: "17:20", expected: 11 })],
    );
    expect(q.lanes.classes[0].expected).toBe(11);
  });
});

describe("buildQueue", () => {
  it("class_unmarked 학생은 레인 B에 절대 넣지 않는다 — 반 카드로 접힌다", () => {
    const q = buildQueue(
      [student({ studentId: "a", signal: "class_unmarked" }), student({ studentId: "b", signal: "unmarked" })],
      [],
    );
    expect(q.lanes.students.map((s) => s.studentId)).toEqual(["b"]);
  });

  it("매듭지은 건은 큐에서 내리되 사라지지 않는다(done으로)", () => {
    const settled = student({
      studentId: "done1",
      followup: { id: "f1", state: "resolved", signal: "unmarked", outcome: "sick", note: null, handledByName: "김데스크", handledAt: null },
    });
    const q = buildQueue([settled, student({ studentId: "open1" })], []);
    expect(q.lanes.students.map((s) => s.studentId)).toEqual(["open1"]);
    expect(q.done.map((s) => s.studentId)).toEqual(["done1"]);
    expect(q.counts).toEqual({ classes: 0, students: 1, done: 1 });
  });

  it("진행 중(open) 조치는 아직 큐에 남는다 — 전화 걸다 만 것은 끝난 게 아니다", () => {
    const calling = student({
      studentId: "x",
      followup: { id: "f", state: "open", signal: "unmarked", outcome: null, note: null, handledByName: null, handledAt: null },
    });
    expect(buildQueue([calling], []).lanes.students).toHaveLength(1);
  });

  it("반 레인은 교시 이른 순, 같으면 인원 많은 순", () => {
    // ⚠️ classId를 서로 다르게 둔다 — 같은 반이면 저장축으로 **접히는 게 맞다**(위 '레인 A 접기').
    const c = (over: Partial<QueueClass> & { classId: string }): QueueClass => ({
      className: "A",
      subject: "math",
      slotStart: "16:20",
      teacherId: null,
      teacherName: null,
      teacherPhone: null,
      slotTeacherLabel: null,
      expected: 5,
      phase: "due",
      saveSlot: null,
      requested: false,
      slotCount: 1,
      slotEnd: over.slotStart ?? "16:20",
      ...over,
    });
    const q = buildQueue(
      [],
      [
        c({ classId: "c3", className: "늦은", slotStart: "18:20" }),
        c({ classId: "c2", className: "작은", expected: 3 }),
        c({ classId: "c1", className: "큰", expected: 12 }),
      ],
    );
    expect(q.lanes.classes.map((x) => x.className)).toEqual(["큰", "작은", "늦은"]);
  });
});

describe("compareStudents", () => {
  it("결석(사실)이 미확인(의심)보다 먼저", () => {
    const rows = [student({ studentId: "unk" }), student({ studentId: "abs", signal: "absent" })];
    expect([...rows].sort(compareStudents).map((s) => s.studentId)).toEqual(["abs", "unk"]);
  });

  it("같은 신호면 교시가 이른 순 — 가장 오래 방치된 것부터 손댄다", () => {
    const rows = [student({ studentId: "late", slotStart: "19:20" }), student({ studentId: "early", slotStart: "14:20" })];
    expect([...rows].sort(compareStudents).map((s) => s.studentId)).toEqual(["early", "late"]);
  });
});

describe("isSettled", () => {
  const f = (state: string, signal: string | null = "unmarked") =>
    ({ id: "f", state, signal, outcome: null, note: null, handledByName: null, handledAt: null });
  it("resolved·dismissed만 매듭", () => {
    expect(isSettled(f("resolved"))).toBe(true);
    expect(isSettled(f("dismissed"))).toBe(true);
    expect(isSettled(f("open"))).toBe(false);
    expect(isSettled(null)).toBe(false);
  });

  it("🔴 내렸던 건이 나중에 결석으로 올라서면 다시 연다 — 결석의 42.5%가 익일 기록이다", () => {
    expect(isSettled(f("dismissed", "unmarked"), "absent")).toBe(false);
    expect(isSettled(f("resolved", "unmarked"), "absent")).toBe(false);
  });

  it("이미 결석을 보고 매듭지은 건은 다시 열지 않는다 — 같은 사실이다", () => {
    expect(isSettled(f("resolved", "absent"), "absent")).toBe(true);
  });

  it("미확인인 채로는 매듭이 유지된다", () => {
    expect(isSettled(f("dismissed", "unmarked"), "unmarked")).toBe(true);
  });
});

describe("suggestedStatus", () => {
  it("이미 와 있으면 출석 제안", () => {
    expect(suggestedStatus("already_here")).toBe("present");
  });

  it("확인된 결석·병결은 결석 제안", () => {
    expect(suggestedStatus("absent_today")).toBe("absent");
    expect(suggestedStatus("sick")).toBe("absent");
  });

  it("🔴 연락이 안 됐다는 사실은 결석의 근거가 아니다", () => {
    expect(suggestedStatus("no_answer")).toBeNull();
  });

  it("곧 온다·기타는 아무 것도 제안하지 않는다", () => {
    expect(suggestedStatus("coming")).toBeNull();
    expect(suggestedStatus("other")).toBeNull();
    expect(suggestedStatus("모르는값")).toBeNull();
  });
});

describe("orderQueueSubjects", () => {
  it("학원설정 순 — 가나다가 아니다", () => {
    expect(orderQueueSubjects(["english", "math"], ["math", "english", "korean"])).toEqual([
      "math",
      "english",
    ]);
  });

  it("설정에 없는 과목은 뒤에", () => {
    expect(orderQueueSubjects(["art", "math"], ["math", "english"])).toEqual(["math", "art"]);
  });
});
