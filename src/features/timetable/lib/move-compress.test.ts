import { describe, expect, it } from "vitest";
import { compressMoves, type PendingMove } from "./move-compress";

const mv = (enrollmentId: string, from: string, to: string, studentId = "s1"): PendingMove => ({
  enrollmentId,
  studentId,
  fromClassId: from,
  toClassId: to,
});

describe("compressMoves", () => {
  it("빈 배열은 빈 배열", () => {
    expect(compressMoves([])).toEqual([]);
  });
  it("단일 이동은 그대로", () => {
    expect(compressMoves([mv("e1", "A", "B")])).toEqual([mv("e1", "A", "B")]);
  });
  it("A→B→C를 A→C로 압축(최초 출발 유지)", () => {
    const out = compressMoves([mv("e1", "A", "B"), mv("e1", "B", "C")]);
    expect(out).toEqual([mv("e1", "A", "C")]);
  });
  it("원점 복귀 A→B→A는 제거", () => {
    expect(compressMoves([mv("e1", "A", "B"), mv("e1", "B", "A")])).toEqual([]);
  });
  it("여러 enrollment 독립 압축 + 입력 순서 보존", () => {
    const out = compressMoves([
      mv("e1", "A", "B"),
      mv("e2", "X", "Y"),
      mv("e1", "B", "C"),
      mv("e2", "Y", "X"), // e2는 원점 복귀 → 제거
    ]);
    expect(out).toEqual([mv("e1", "A", "C")]);
  });
  it("학생이 둘 다 있어도 enrollment 단위로 분리", () => {
    const out = compressMoves([
      mv("eMath", "M1", "M2", "stu"),
      mv("eEng", "E1", "E2", "stu"),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.enrollmentId)).toEqual(["eMath", "eEng"]);
  });
  it("입력을 변형하지 않음(불변)", () => {
    const input = [mv("e1", "A", "B"), mv("e1", "B", "C")];
    const snapshot = JSON.stringify(input);
    compressMoves(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
