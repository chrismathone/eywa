import { describe, expect, it } from "vitest";
import { isCanonicalRouteKey, menuKeyOfRoute, normalizeSegment, routeKeyOf } from "./route-key";

describe("routeKeyOf — 주소를 화면으로 접는다", () => {
  it("id·날짜 칸은 자리 표시로, 라우트 이름은 그대로", () => {
    expect(routeKeyOf("/students/3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6")).toBe("/students/[id]");
    expect(routeKeyOf("/attendance/2026-09-28/abc12345-0000-4000-8000-000000000001")).toBe("/attendance/[date]/[id]");
    expect(routeKeyOf("/attendance/live")).toBe("/attendance/live");
    expect(routeKeyOf("/help/posts/42")).toBe("/help/posts/[id]");
  });

  it("탭·보기 파라미터만 남기고 나머지(검색어·embed·페이지)는 버린다", () => {
    expect(routeKeyOf("/billing", "tab=sessions&embed=1&q=김")).toBe("/billing?tab=sessions");
    expect(routeKeyOf("/enrollment", "view=table&tab=x")).toBe("/enrollment?tab=x&view=table");
    expect(routeKeyOf("/students", "page=3")).toBe("/students");
  });

  it("값이 이상한 파라미터(한글·긴 값)는 싣지 않는다 — 개인 정보가 식별자에 새지 않게", () => {
    expect(routeKeyOf("/students", "tab=홍길동")).toBe("/students");
    expect(routeKeyOf("/students", `tab=${"a".repeat(40)}`)).toBe("/students");
  });

  it("한글·인코딩된 칸, 숫자가 섞인 긴 토큰은 id로", () => {
    expect(routeKeyOf("/documents/%ED%95%99%EC%83%9D")).toBe("/documents/[id]");
    expect(normalizeSegment("a1b2c3d4e5f6a7b8")).toBe("[id]");
    expect(normalizeSegment("lesson-reports")).toBe("lesson-reports");
    expect(normalizeSegment("%zz")).toBe("[id]");
    expect(routeKeyOf("/documents/%zz")).toBe("/documents/[id]");
  });

  it("깊이는 4칸까지, 루트는 /", () => {
    expect(routeKeyOf("/a/b/c/d/e/f")).toBe("/a/b/c/d");
    expect(routeKeyOf("/")).toBe("/");
    expect(routeKeyOf("")).toBe("/");
  });
});

describe("isCanonicalRouteKey — 서버 관문", () => {
  it("다시 접어도 같은 값만 통과", () => {
    for (const k of ["/", "/students/[id]", "/attendance/[date]", "/billing?tab=sessions", "/enrollment?tab=x&view=table"]) {
      expect(isCanonicalRouteKey(k), k).toBe(true);
    }
  });

  it("정규형이 아닌 값은 거절", () => {
    for (const k of [
      "students",
      "/students/3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6",
      "/billing?view=a&tab=b",
      "/billing?q=홍길동",
      "/학생",
      `/${"a".repeat(200)}`,
    ]) {
      expect(isCanonicalRouteKey(k), k).toBe(false);
    }
  });
});

describe("menuKeyOfRoute", () => {
  it("첫 칸으로 메뉴를 찾고, 없으면 other", () => {
    expect(menuKeyOfRoute("/lesson-reports")).toBe("lesson_reports");
    expect(menuKeyOfRoute("/billing?tab=sessions")).toBe("billing");
    expect(menuKeyOfRoute("/onescreen")).toBe("teacher_onescreen");
    expect(menuKeyOfRoute("/me")).toBe("other");
    expect(menuKeyOfRoute("/")).toBe("other");
  });
});
