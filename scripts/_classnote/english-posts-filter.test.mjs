import { describe, expect, it } from "vitest";
import { extractClassPostDays, isClassPost, kstDay } from "./english-posts-filter.mjs";

const row = (over = {}) => ({
  author: { type: "teacher" },
  class_name: "Elsa 초등 브릿지D (화수금)",
  created: "2026-07-22T05:00:00Z",
  ...over,
});

describe("isClassPost", () => {
  it("강사 글은 집계한다", () => {
    expect(isClassPost(row())).toBe(true);
  });

  it("기관(admin) 글도 집계한다 — 부원장·교수부장이 학원 계정으로 올린다", () => {
    expect(isClassPost(row({ author: { type: "admin" } }))).toBe(true);
  });

  it("학부모 글은 작성이 아니다", () => {
    expect(isClassPost(row({ author: { type: "parent" } }))).toBe(false);
  });

  it("수학 보드는 제외 — lesson_reports가 이미 진실이다", () => {
    expect(isClassPost(row({ class_name: "(수학)김이현" }))).toBe(false);
  });

  it("보드 이름이 없으면 집계 불가", () => {
    expect(isClassPost(row({ class_name: "" }))).toBe(false);
    expect(isClassPost(row({ class_name: undefined }))).toBe(false);
  });

  it("작성 시각이 없거나 깨졌으면 제외", () => {
    expect(isClassPost(row({ created: null }))).toBe(false);
    expect(isClassPost(row({ created: "어제" }))).toBe(false);
  });

  it("행이 비어도 안전하다", () => {
    expect(isClassPost(null)).toBe(false);
    expect(isClassPost({})).toBe(false);
  });
});

describe("kstDay — 분모가 KST라 분자도 KST여야 한다", () => {
  it("UTC 오후는 같은 날", () => {
    expect(kstDay("2026-07-22T05:00:00Z")).toBe("2026-07-22");
  });

  it("UTC 밤 = KST 다음날 새벽 → 날짜가 넘어간다", () => {
    // 2026-07-22T16:00Z = 2026-07-23 01:00 KST
    expect(kstDay("2026-07-22T16:00:00Z")).toBe("2026-07-23");
  });

  it("UTC 자정 직후 = KST 같은 날 오전", () => {
    expect(kstDay("2026-07-22T00:30:00Z")).toBe("2026-07-22");
  });
});

describe("extractClassPostDays", () => {
  it("보드×날짜로 접고 건수를 센다", () => {
    const got = extractClassPostDays([
      row(),
      row({ created: "2026-07-22T06:00:00Z" }), // 같은 보드·같은 날 → 한 행, count 2
      row({ class_name: "Jane 중1 정규A (화수금)" }),
    ]);
    expect(got).toEqual([
      { boardName: "Jane 중1 정규A (화수금)", postedOn: "2026-07-22", postCount: 1 },
      { boardName: "Elsa 초등 브릿지D (화수금)", postedOn: "2026-07-22", postCount: 2 },
    ].sort((a, b) => a.boardName.localeCompare(b.boardName)));
  });

  it("같은 보드라도 날짜가 다르면 별개 행", () => {
    const got = extractClassPostDays([row(), row({ created: "2026-07-21T05:00:00Z" })]);
    expect(got.map((r) => r.postedOn)).toEqual(["2026-07-21", "2026-07-22"]);
  });

  it("학부모·수학은 섞여 들어와도 걸러진다", () => {
    const got = extractClassPostDays([
      row(),
      row({ author: { type: "parent" } }),
      row({ class_name: "(수학)김이현" }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0].postCount).toBe(1);
  });

  it("빈 입력은 빈 배열", () => {
    expect(extractClassPostDays([])).toEqual([]);
    expect(extractClassPostDays(null)).toEqual([]);
  });
});
