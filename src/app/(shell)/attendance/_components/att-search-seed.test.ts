import { describe, expect, it } from "vitest";
import { SEARCH_SEED_MAX, readSearchSeed, urlWithSearchSeed } from "./att-search-seed";

describe("readSearchSeed — URL에서 읽은 씨앗 정리", () => {
  it("없으면 빈 문자열", () => {
    expect(readSearchSeed(undefined)).toBe("");
    expect(readSearchSeed(null)).toBe("");
  });

  it("앞뒤 공백을 떼고 상한으로 자른다", () => {
    expect(readSearchSeed("  윤현소 ")).toBe("윤현소");
    expect(readSearchSeed("가".repeat(SEARCH_SEED_MAX + 10))).toHaveLength(SEARCH_SEED_MAX);
  });
});

describe("urlWithSearchSeed — 주소창 씨앗 갱신", () => {
  it("씨앗을 붙이면서 다른 파라미터는 보존한다", () => {
    expect(urlWithSearchSeed("http://x/attendance?teacher=t1&month=2026-08", "윤현소")).toBe(
      "/attendance?teacher=t1&month=2026-08&q=%EC%9C%A4%ED%98%84%EC%86%8C",
    );
  });

  it("🔴 비우면 뗀다 — 안 지우면 새로고침에 옛 검색어가 되살아난다", () => {
    expect(urlWithSearchSeed("http://x/attendance?month=2026-08&q=윤현소", "")).toBe(
      "/attendance?month=2026-08",
    );
    expect(urlWithSearchSeed("http://x/attendance?q=윤현소", "   ")).toBe("/attendance");
  });

  it("바뀔 게 없으면 null — 주소창에 손대지 않는다(불필요한 replaceState 금지)", () => {
    expect(urlWithSearchSeed("http://x/attendance?q=%EC%9C%A4", "윤")).toBeNull();
    expect(urlWithSearchSeed("http://x/attendance?month=2026-08", "")).toBeNull();
  });

  it("씨앗만 바뀌고 값은 정리된 문자열로 들어간다", () => {
    expect(urlWithSearchSeed("http://x/attendance?q=%EA%B9%80", " 박 ")).toBe("/attendance?q=%EB%B0%95");
  });
});
