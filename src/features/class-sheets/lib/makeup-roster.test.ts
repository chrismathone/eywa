import { describe, expect, it } from "vitest";
import { appendMakeupStudents, attendanceOrMakeup, makeupStudentIds } from "./makeup-roster";

describe("appendMakeupStudents", () => {
  const row = (studentId: string, name: string) => ({ studentId, name });

  it("정규 뒤에 보강을 붙이고 가나다 정렬", () => {
    const out = appendMakeupStudents([row("a", "김정규")], [row("c", "최보강"), row("b", "박보강")]);
    expect(out.map((s) => s.name)).toEqual(["김정규", "박보강", "최보강"]);
  });

  it("이미 정규에 있는 id는 보강으로 중복하지 않는다", () => {
    const out = appendMakeupStudents([row("a", "김정규")], [row("a", "김정규"), row("b", "박보강")]);
    expect(out.map((s) => s.studentId)).toEqual(["a", "b"]);
  });

  it("보강이 없으면 정규를 그대로(새 배열)", () => {
    const regular = [row("a", "김정규")];
    const out = appendMakeupStudents(regular, []);
    expect(out).toEqual(regular);
    expect(out).not.toBe(regular);
  });
});

describe("makeupStudentIds — 출석부와 같은 집합", () => {
  it("기록만 있는 학생이 보강", () => {
    expect(makeupStudentIds(["a", "b"], ["a"])).toEqual(["b"]);
  });
});

describe("attendanceOrMakeup", () => {
  it("로컬 칸이 있으면 그대로", () => {
    const att = { status: "present", note: "병결", units: 1, slot: "16:20" };
    expect(attendanceOrMakeup(att, true)).toBe(att);
  });

  it("보강인데 칸이 없으면 makeup으로 보여 덮어쓰기를 막는다", () => {
    expect(attendanceOrMakeup(null, true)).toEqual({
      status: "makeup",
      note: null,
      units: null,
      slot: null,
    });
  });

  it("보강 아닌 빈 칸은 빈 칸", () => {
    expect(attendanceOrMakeup(undefined, false)).toBeNull();
  });
});
