import { describe, expect, it } from "vitest";
import { foldAbsentStudents, scopeAbsentDay, type AbsentRecordRow } from "./absent-students";

const DAY = "2026-09-11";
let seq = 0;
function row(over: Partial<AbsentRecordRow> = {}): AbsentRecordRow {
  seq += 1;
  return {
    id: `r${String(seq).padStart(3, "0")}`,
    student_id: "s1",
    class_id: "c1",
    session_date: DAY,
    slot_start: null,
    status: "absent",
    // KST 14시 = 수업 당일 기록(사전 통보 아님)
    recorded_at: "2026-09-11T05:00:00Z",
    note: null,
    student: { name: "김하늘" },
    class: { subject: "math", class_name: "M1" },
    ...over,
  };
}
const ids = (list: { studentId: string }[]) => list.map((s) => s.studentId);

describe("foldAbsentStudents — 결석 학생 = 한 교시도 안 온 학생", () => {
  it("결석·공결은 결석, 지각·출석·조퇴·보강은 결석이 아니다", () => {
    const day = foldAbsentStudents([
      row({ student_id: "a", status: "absent" }),
      row({ student_id: "b", status: "excused" }),
      row({ student_id: "c", status: "late" }),
      row({ student_id: "d", status: "present" }),
      row({ student_id: "e", status: "early_leave" }),
      row({ student_id: "f", status: "makeup" }),
    ]);
    expect(ids(day.absent)).toEqual(["a", "b"]);
    expect(day.partial).toEqual([]);
    expect(day.absent.find((s) => s.studentId === "b")?.statuses).toEqual(["excused"]);
  });

  it("🔴 일부 교시만 결석하고 다른 교시엔 온 학생은 세지 않고 '일부 교시 결석'으로 간다", () => {
    const day = foldAbsentStudents([
      row({ slot_start: "16:00", status: "present" }),
      row({ slot_start: "18:00", status: "absent" }),
      // 다른 반에서 출석
      row({ student_id: "s2", class_id: "c1", status: "absent" }),
      row({ student_id: "s2", class_id: "c9", status: "late", class: { subject: "english", class_name: "E9" } }),
    ]);
    expect(day.absent).toEqual([]);
    expect(ids(day.partial)).toEqual(["s1", "s2"]);
    // 반 목록은 결석한 반만
    expect(day.partial.find((s) => s.studentId === "s2")?.classes.map((c) => c.name)).toEqual(["M1"]);
  });

  it("🔴 결석을 출석으로 고친 칸은 결석이 아니다(같은 칸의 최신 정정만)", () => {
    const day = foldAbsentStudents([
      row({ status: "absent", recorded_at: "2026-09-11T05:00:00Z" }),
      row({ status: "present", recorded_at: "2026-09-11T06:00:00Z" }),
    ]);
    expect(day).toEqual({ absent: [], partial: [] });
  });

  it("두 반 모두 결석이면 한 명, 반은 모두, 과목은 처음 기록된 칸", () => {
    const day = foldAbsentStudents([
      row({ class_id: "c2", class: { subject: "english", class_name: "E1" }, recorded_at: "2026-09-11T07:00:00Z" }),
      row({ class_id: "c1", class: { subject: "math", class_name: "M1" }, recorded_at: "2026-09-11T05:00:00Z" }),
    ]);
    expect(day.absent).toHaveLength(1);
    expect(day.absent[0]).toMatchObject({ subject: "math", statuses: ["absent"] });
    expect(day.absent[0]?.classes.map((c) => c.name)).toEqual(["M1", "E1"]);
  });

  it("사전 통보(데스크 접수 표식 · 수업일 전 기록)는 숫자에서 빼지 않고 표식만 — AND로 접는다", () => {
    const day = foldAbsentStudents([
      row({ student_id: "a", note: "가족여행 (데스크 접수)" }),
      row({ student_id: "b", recorded_at: "2026-09-09T05:00:00Z" }),
      row({ student_id: "c" }),
      row({ student_id: "d", class_id: "c1", note: "(데스크 접수)" }),
      row({ student_id: "d", class_id: "c2", note: null }),
    ]);
    expect(day.absent.map((s) => [s.studentId, s.preNotified])).toEqual([
      ["b", true],
      ["a", true],
      ["c", false],
      ["d", false],
    ]);
  });

  it("결석과 공결이 섞이면 둘 다 표식에 남는다 · 이름이 비면 대체 문구", () => {
    const day = foldAbsentStudents([
      row({ class_id: "c1", status: "absent" }),
      row({ class_id: "c2", status: "excused" }),
      row({ student_id: "x", student: null }),
    ]);
    expect(day.absent[0]?.statuses).toEqual(["absent", "excused"]);
    expect(day.absent.find((s) => s.studentId === "x")?.name).toBe("(학생)");
  });
});

describe("scopeAbsentDay — 강사 스코프", () => {
  it("그 강사 반의 결석이 있는 학생만, 반 목록도 그 반만 — 판정(결석/일부)은 하루 전체 기준 그대로", () => {
    const day = foldAbsentStudents([
      row({ student_id: "a", class_id: "mine", class: { subject: "math", class_name: "내 반" } }),
      row({ student_id: "a", class_id: "other", class: { subject: "english", class_name: "남의 반" } }),
      row({ student_id: "b", class_id: "other", class: { subject: "english", class_name: "남의 반" } }),
      row({ student_id: "p", class_id: "mine", class: { subject: "math", class_name: "내 반" } }),
      row({ student_id: "p", class_id: "other", status: "present" }),
    ]);
    const scoped = scopeAbsentDay(day, new Set(["mine"]));
    expect(ids(scoped.absent)).toEqual(["a"]);
    expect(scoped.absent[0]?.classes.map((c) => c.name)).toEqual(["내 반"]);
    expect(ids(scoped.partial)).toEqual(["p"]);
  });
});
