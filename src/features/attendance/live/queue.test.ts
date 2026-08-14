import { describe, expect, it } from "vitest";
import {
  buildQueue,
  compareStudents,
  isSettled,
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
  slotStart: "16:20",
  teacherName: "김강사",
  signal: "unmarked" as LiveSignal,
  phase: "due",
  note: null,
  parentPhone: "010-0000-0000",
  studentPhone: null,
  followup: null,
  ...over,
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
      followup: { id: "f1", state: "resolved", outcome: "sick", note: null, handledByName: "김데스크", handledAt: null },
    });
    const q = buildQueue([settled, student({ studentId: "open1" })], []);
    expect(q.lanes.students.map((s) => s.studentId)).toEqual(["open1"]);
    expect(q.done.map((s) => s.studentId)).toEqual(["done1"]);
    expect(q.counts).toEqual({ classes: 0, students: 1, done: 1 });
  });

  it("진행 중(open) 조치는 아직 큐에 남는다 — 전화 걸다 만 것은 끝난 게 아니다", () => {
    const calling = student({
      studentId: "x",
      followup: { id: "f", state: "open", outcome: null, note: null, handledByName: null, handledAt: null },
    });
    expect(buildQueue([calling], []).lanes.students).toHaveLength(1);
  });

  it("반 레인은 교시 이른 순, 같으면 인원 많은 순", () => {
    const c = (over: Partial<QueueClass>): QueueClass => ({
      classId: "c",
      className: "A",
      subject: "math",
      slotStart: "16:20",
      teacherId: null,
      teacherName: null,
      teacherPhone: null,
      slotTeacherLabel: null,
      expected: 5,
      phase: "due",
      ...over,
    });
    const q = buildQueue(
      [],
      [c({ className: "늦은", slotStart: "18:20" }), c({ className: "작은", expected: 3 }), c({ className: "큰", expected: 12 })],
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
  const f = (state: string) => ({ id: "f", state, outcome: null, note: null, handledByName: null, handledAt: null });
  it("resolved·dismissed만 매듭", () => {
    expect(isSettled(f("resolved"))).toBe(true);
    expect(isSettled(f("dismissed"))).toBe(true);
    expect(isSettled(f("open"))).toBe(false);
    expect(isSettled(null)).toBe(false);
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
