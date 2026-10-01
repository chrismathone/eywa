import { describe, expect, it } from "vitest";
import { entryUrl, isHomePath, renderedPathOf, stripEmbedUrl, visibleId, visibleUrl } from "./keepalive-url";
import type { Win } from "./window-store";

describe("renderedPathOf — 바탕이 실제로 그리는 경로(라우터 트리)", () => {
  it("셸 레이아웃 아래 세그먼트를 경로로 잇고 라우트 그룹은 뺀다", () => {
    expect(renderedPathOf(["dashboard"])).toBe("/dashboard");
    expect(renderedPathOf(["students", "abc"])).toBe("/students/abc");
    expect(renderedPathOf(["(admin)", "owner"])).toBe("/owner");
  });

  it("라우터 밖(null)·빈 세그먼트는 루트 — 첫 화면으로 읽는다", () => {
    expect(renderedPathOf(null)).toBe("/");
    expect(renderedPathOf([])).toBe("/");
    expect(isHomePath(renderedPathOf(null), "/dashboard")).toBe(true);
  });
});

const win = (id: string, href: string, minimized = false, kind: Win["kind"] = "route", paramId = id): Win => ({
  id,
  kind,
  params: { id: paramId, title: id, href },
  rect: { x: 0, y: 0, w: 1, h: 1 },
  minimized,
  maximized: false,
});

describe("stripEmbedUrl — 창 iframe 주소와 주소창 주소를 같은 눈금으로", () => {
  it("embed=1만 뗀다(다른 쿼리·순서는 보존)", () => {
    expect(stripEmbedUrl("/students?embed=1")).toBe("/students");
    expect(stripEmbedUrl("/students?tab=a&embed=1&page=2")).toBe("/students?tab=a&page=2");
    expect(stripEmbedUrl("/students")).toBe("/students");
  });

  it("🔴 다른 쿼리는 원문 그대로 둔다 — 다시 직렬화하면 %20이 +로 바뀌어 같은 주소가 달라진다", () => {
    expect(stripEmbedUrl("/a?q=%20b&embed=1")).toBe("/a?q=%20b");
    expect(stripEmbedUrl("/a?embed=1&x=a%2Fb")).toBe("/a?x=a%2Fb");
    expect(stripEmbedUrl("/a?q=%ED%95%9C")).toBe("/a?q=%ED%95%9C");
    expect(stripEmbedUrl("/a?")).toBe("/a");
  });

  it("해시는 뗀다(같은 문서의 스크롤일 뿐)", () => {
    expect(stripEmbedUrl("/dashboard?embed=1#daily")).toBe("/dashboard");
  });
});

describe("isHomePath — 첫 화면(바탕)이 직접 그리는 주소", () => {
  it("운영실·메뉴·루트·권한을 본 홈", () => {
    expect(isHomePath("/dashboard", "/dashboard")).toBe(true);
    expect(isHomePath("/menu", "/dashboard")).toBe(true);
    expect(isHomePath("/", "/dashboard")).toBe(true);
    expect(isHomePath("/menu", "/menu")).toBe(true);
  });

  it("다른 화면은 아니다", () => {
    expect(isHomePath("/students", "/dashboard")).toBe(false);
    expect(isHomePath("/dashboard/briefing", "/dashboard")).toBe(false);
  });
});

describe("보이는 화면 ↔ 주소창", () => {
  const windows = {
    a: win("a", "/students", false),
    b: win("b", "/classes", true),
  };

  it("보이는 화면은 포커스된 숨지 않은 하나", () => {
    expect(visibleId({ windows, focusedId: "a", nav: {} })).toBe("a");
    expect(visibleId({ windows, focusedId: "b", nav: {} })).toBeNull(); // 숨은 화면이 포커스면 보이는 것 없음
    expect(visibleId({ windows, focusedId: null, nav: {} })).toBeNull();
    expect(visibleId({ windows, focusedId: "ghost", nav: {} })).toBeNull();
  });

  it("주소창은 보이는 화면의 지금 주소를 따라간다 — 창 안 이동(드릴인)이면 그 주소", () => {
    expect(visibleUrl({ windows, focusedId: "a", nav: {} }, "/dashboard")).toBe("/students");
    expect(visibleUrl({ windows, focusedId: "a", nav: { a: ["/students?embed=1", "/students/abc?embed=1"] } }, "/dashboard")).toBe(
      "/students/abc",
    );
  });

  it("보이는 화면이 없으면 첫 화면 주소", () => {
    expect(visibleUrl({ windows, focusedId: null, nav: {} }, "/dashboard")).toBe("/dashboard");
    expect(visibleUrl({ windows, focusedId: null, nav: {} }, "/menu")).toBe("/menu");
  });

  it("원생 요약 창(peek)은 원생 상세 주소로 읽는다", () => {
    const w = win("student:s1", "", false, "student", "s1");
    expect(entryUrl(w, undefined)).toBe("/students/s1");
  });
});
