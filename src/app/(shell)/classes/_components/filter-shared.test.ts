import { describe, expect, it } from "vitest";
import {
  buildClassHref,
  CLASS_STATUS_DEFAULT,
  parseClassStatus,
  type ClassFilterState,
} from "./filter-shared";

const base: ClassFilterState = {
  subject: "all",
  teacher: "all",
  days: [],
  q: "",
  view: "table",
  sort: "name",
  status: CLASS_STATUS_DEFAULT,
};

describe("parseClassStatus (상태 필터 해석 — 서버·필터바 단일 소스)", () => {
  it("미지정·모르는 값은 기본값 '운영'", () => {
    expect(parseClassStatus(undefined)).toBe("operating");
    expect(parseClassStatus(null)).toBe("operating");
    expect(parseClassStatus("")).toBe("operating");
    expect(parseClassStatus("closed")).toBe("operating"); // 옛 축(active) 어휘도 안 받는다
  });

  it("아는 값은 그대로", () => {
    expect(parseClassStatus("all")).toBe("all");
    expect(parseClassStatus("ended")).toBe("ended");
    expect(parseClassStatus("retired")).toBe("retired");
  });
});

describe("buildClassHref (기본값은 URL에 안 싣는다)", () => {
  it("전부 기본이면 맨 주소 — /classes = 운영 중만", () => {
    expect(buildClassHref(base, {})).toBe("/classes");
  });

  it("상태를 바꾸면 URL에 실린다(왕복해도 같은 값)", () => {
    const href = buildClassHref(base, { status: "all" });
    expect(href).toBe("/classes?status=all");
    expect(parseClassStatus(new URL(href, "https://x").searchParams.get("status"))).toBe("all");
  });

  it("'운영'으로 되돌리면 파라미터가 사라진다(기본값 생략)", () => {
    expect(buildClassHref({ ...base, status: "retired" }, { status: "operating" })).toBe("/classes");
  });

  it("다른 필터와 함께 실린다", () => {
    expect(buildClassHref(base, { subject: "english", status: "ended" })).toBe(
      "/classes?subject=english&status=ended",
    );
  });
});
