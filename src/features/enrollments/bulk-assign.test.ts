import { describe, expect, it } from "vitest";
import { candidateMeta, filterBulkCandidates, toggleVisible } from "./bulk-assign";

const OPTS = [
  { id: "a", name: "김담희", grade: "고1", school: "경명여고" },
  { id: "b", name: "이서준", grade: "고1", school: "대구고" },
  { id: "c", name: "박하늘", grade: "중3", school: "경명여중" },
  { id: "d", name: "최민", grade: null, school: null },
];

describe("단체 배정 검색", () => {
  it("빈 검색어면 전부 보인다", () => {
    expect(filterBulkCandidates(OPTS, "  ")).toHaveLength(4);
  });

  it("학년으로 좁힌다 — 특강의 주 흐름('고1' → 모두 선택)", () => {
    expect(filterBulkCandidates(OPTS, "고1").map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("학교·이름도 같은 칸에서 찾고, 띄어 쓴 낱말은 모두 맞아야 한다", () => {
    expect(filterBulkCandidates(OPTS, "경명").map((o) => o.id)).toEqual(["a", "c"]);
    expect(filterBulkCandidates(OPTS, "경명 고1").map((o) => o.id)).toEqual(["a"]);
    expect(filterBulkCandidates(OPTS, "하늘").map((o) => o.id)).toEqual(["c"]);
  });

  it("표기는 앱 전역 규약(학교+학년 압축)이고 없으면 빈 문자열", () => {
    expect(candidateMeta(OPTS[0]!)).toBe("경명여고1");
    expect(candidateMeta(OPTS[3]!)).toBe("");
  });
});

describe("보이는 학생 모두 선택", () => {
  it("하나라도 빠져 있으면 보이는 학생을 모두 더한다(이미 고른 건 그대로)", () => {
    expect(toggleVisible(["c"], ["a", "b"])).toEqual(["c", "a", "b"]);
    expect(toggleVisible(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("보이는 학생이 전부 골라져 있으면 그들만 뺀다 — 🔴 검색에 가려진 선택은 남는다", () => {
    expect(toggleVisible(["c", "a", "b"], ["a", "b"])).toEqual(["c"]);
  });

  it("보이는 학생이 없으면 아무것도 안 바뀐다", () => {
    expect(toggleVisible(["a"], [])).toEqual(["a"]);
  });
});
