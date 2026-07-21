import { describe, it, expect } from "vitest";
import { splitComment, joinComment } from "./comment-paragraphs";

describe("splitComment", () => {
  it("빈 줄이 없으면 전부 P1(모드 A 텍스트를 B로 열어도 안 깨짐)", () => {
    expect(splitComment("오늘은 이차함수를 학습했습니다.")).toEqual({
      p1: "오늘은 이차함수를 학습했습니다.",
      p2: "",
    });
  });

  it("첫 빈 줄이 경계", () => {
    expect(splitComment("수업 내용입니다.\n\n태도가 좋았습니다.")).toEqual({
      p1: "수업 내용입니다.",
      p2: "태도가 좋았습니다.",
    });
  });

  it("빈 줄이 여러 번이면 첫 경계만 — 나머지는 P2에 보존(3문단 이상 유실 금지)", () => {
    expect(splitComment("A\n\nB\n\nC")).toEqual({ p1: "A", p2: "B\n\nC" });
  });

  it("선행 빈 줄 = P1 비고 P2만 입력한 상태", () => {
    expect(splitComment("\n\n태도만 적었습니다.")).toEqual({ p1: "", p2: "태도만 적었습니다." });
  });

  it("빈 초안", () => {
    expect(splitComment("")).toEqual({ p1: "", p2: "" });
  });

  it("한 줄 개행은 경계가 아님(문단 내 줄바꿈 보존)", () => {
    expect(splitComment("한 줄\n다음 줄")).toEqual({ p1: "한 줄\n다음 줄", p2: "" });
  });
});

describe("joinComment", () => {
  it("P2가 비면 구분자 없이 P1만", () => {
    expect(joinComment("수업 내용", "")).toBe("수업 내용");
  });

  it("둘 다 있으면 빈 줄로 잇는다", () => {
    expect(joinComment("수업 내용", "태도")).toBe("수업 내용\n\n태도");
  });

  it("P1이 비어도 구분자를 유지(타이핑 중 P2가 P1칸으로 튀는 것 방지)", () => {
    expect(joinComment("", "태도만")).toBe("\n\n태도만");
  });
});

describe("라운드트립 불변식 — split(join(p1,p2)) === {p1,p2}", () => {
  const cases: [string, string][] = [
    ["", ""],
    ["수업 내용", ""],
    ["", "태도"],
    ["수업 내용", "태도"],
    ["수업 내용", "태도\n\n추가"],
    ["줄1\n줄2", "태도"],
  ];
  it.each(cases)("p1=%j p2=%j", (p1, p2) => {
    expect(splitComment(joinComment(p1, p2))).toEqual({ p1, p2 });
  });
});
