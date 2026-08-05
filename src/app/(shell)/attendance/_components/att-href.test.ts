import { describe, expect, it } from "vitest";
import { attHref, resolveViewMode } from "./att-href";

describe("resolveViewMode — 기본 보기", () => {
  it("강사는 자기 전체 시트로 바로 들어온다(파라미터 없이 메뉴 클릭)", () => {
    expect(resolveViewMode({ isTeacher: true })).toBe("teacher");
  });

  it("관리자는 종전대로 반 선택 허브 — 반 108개를 한 번에 열지 않는다", () => {
    expect(resolveViewMode({ isTeacher: false })).toBe("class");
  });

  it("🔴 URL에 적힌 뜻이 이긴다 — mode=class를 무시하면 '반별' 탈출구가 죽는다", () => {
    expect(resolveViewMode({ isTeacher: true, modeParam: "class" })).toBe("class");
    expect(resolveViewMode({ isTeacher: false, modeParam: "teacher" })).toBe("teacher");
  });

  it("반을 명시한 링크(원스크린·바로 열기)는 그 반만 연다", () => {
    expect(resolveViewMode({ isTeacher: true, classParam: "c1" })).toBe("class");
  });

  it("반을 명시했어도 mode=teacher면 전체(전체 보기에서 반 강조는 하지 않는다)", () => {
    expect(resolveViewMode({ isTeacher: true, classParam: "c1", modeParam: "teacher" })).toBe("teacher");
  });
});

describe("attHref", () => {
  it("🔴 mode=class도 URL에 적는다 — 안 적으면 강사의 기본값(전체)에 먹힌다", () => {
    const url = attHref({ classId: null, month: "2026-07", range: "month", mode: "class" });
    expect(url).toContain("mode=class");
    // 왕복이 성립해야 한다: 이 링크를 다시 해석하면 반별이어야 한다.
    const modeParam = new URL(url, "http://x").searchParams.get("mode") ?? undefined;
    expect(resolveViewMode({ isTeacher: true, modeParam })).toBe("class");
  });

  it("mode를 안 넘기면 URL에도 안 적는다(기본값에 맡긴다)", () => {
    expect(attHref({ classId: "c1", month: "2026-07", range: "month" })).not.toContain("mode=");
  });

  it("2주 보기·과목·강사·반 파라미터", () => {
    const url = attHref({
      classId: "c1",
      month: "2026-07",
      range: "2w",
      teacherId: "t1",
      subjectId: "math",
      mode: "teacher",
    });
    expect(url).toBe("/attendance?subject=math&teacher=t1&class=c1&month=2026-07&range=2w&mode=teacher");
  });
});
