import { describe, it, expect } from "vitest";
import { applyStudentOrder, moveInOrder } from "./student-order";

type S = { id: string; classId?: string | null; name?: string };
const s = (id: string, classId: string | null): S => ({ id, classId });

describe("applyStudentOrder", () => {
  it("저장 순서가 없으면 원본 그대로", () => {
    const students = [s("a", "c1"), s("b", "c1")];
    expect(applyStudentOrder(students, new Map())).toEqual(students);
  });

  it("반 그룹 내부만 저장 순서로 재배열 — 다른 반·반 순서는 불변", () => {
    const students = [s("a", "c1"), s("b", "c1"), s("c", "c2"), s("d", "c2")];
    const out = applyStudentOrder(students, new Map([["c2", ["d", "c"]]]));
    expect(out.map((x) => x.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("저장 목록에 없는 신규 학생은 기존 순서대로 뒤에 붙는다", () => {
    const students = [s("a", "c1"), s("b", "c1"), s("c", "c1"), s("d", "c1")];
    const out = applyStudentOrder(students, new Map([["c1", ["c", "a"]]]));
    expect(out.map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("저장 목록에만 있고 로스터에 없는 id는 무시된다(퇴원 등)", () => {
    const students = [s("a", "c1"), s("b", "c1")];
    const out = applyStudentOrder(students, new Map([["c1", ["x", "b", "y", "a"]]]));
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("classId 없는 학생(보강 등)은 재배열 대상이 아니다", () => {
    const students = [s("a", null), s("b", null)];
    const out = applyStudentOrder(students, new Map([["c1", ["b", "a"]]]));
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("moveInOrder", () => {
  it("한 칸 위/아래로 이동한다", () => {
    expect(moveInOrder(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("경계 밖·미존재 id는 그대로", () => {
    expect(moveInOrder(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveInOrder(["a", "b"], "b", 1)).toEqual(["a", "b"]);
    expect(moveInOrder(["a", "b"], "x", 1)).toEqual(["a", "b"]);
  });
});
