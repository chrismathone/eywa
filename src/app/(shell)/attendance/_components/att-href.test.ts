import { describe, expect, it } from "vitest";
import { attHref, resolveViewMode } from "./att-href";

describe("resolveViewMode — 기본 보기", () => {
  it("강사는 자기 전체 시트로 바로 들어온다(파라미터 없이 메뉴 클릭)", () => {
    expect(resolveViewMode({ isTeacher: true })).toBe("teacher");
  });

  it("관리자도 기본은 강사 전체 — 강사를 고르면 바로 전체 출석부(원장 2026-08-10), 강사 미선택은 호출부가 요약 허브로 폴백", () => {
    expect(resolveViewMode({ isTeacher: false })).toBe("teacher");
  });

  it("🔴 강사에겐 mode가 없다 — 반 미지정은 언제나 자기 전체(사진 허브로 보내지 않는다)", () => {
    expect(resolveViewMode({ isTeacher: true, modeParam: "class" })).toBe("teacher");
  });

  it("관리자의 명시적 '반별'(mode=class)은 존중한다", () => {
    expect(resolveViewMode({ isTeacher: false, modeParam: "class" })).toBe("class");
    expect(resolveViewMode({ isTeacher: false, modeParam: "teacher" })).toBe("teacher");
  });

  it("반을 명시한 링크(원스크린·바로 열기)는 그 반만 연다", () => {
    expect(resolveViewMode({ isTeacher: true, classParam: "c1" })).toBe("class");
  });

  it("🔴 반 선택이 mode를 이긴다 — URL에 남은 mode=teacher가 드롭다운 선택을 먹으면 안 된다(강사·관리자 공통, 2026-08-10 버그)", () => {
    expect(resolveViewMode({ isTeacher: true, classParam: "c1", modeParam: "teacher" })).toBe("class");
    expect(resolveViewMode({ isTeacher: false, classParam: "c1", modeParam: "teacher" })).toBe("class");
  });
});

describe("attHref", () => {
  it("🔴 mode 왕복이 성립한다 — 관리자의 '반별/강사 전체' 토글이 이 링크로 동작한다", () => {
    const url = attHref({ classId: null, month: "2026-07", mode: "teacher" });
    expect(url).toContain("mode=teacher");
    // 이 링크를 다시 해석하면 강사 전체여야 한다(관리자 기준 — 강사는 mode를 보지 않는다).
    const modeParam = new URL(url, "http://x").searchParams.get("mode") ?? undefined;
    expect(resolveViewMode({ isTeacher: false, modeParam })).toBe("teacher");
  });

  it("mode를 안 넘기면 URL에도 안 적는다(기본값에 맡긴다)", () => {
    expect(attHref({ classId: "c1", month: "2026-07" })).not.toContain("mode=");
  });

  it("과목·강사·반 파라미터", () => {
    const url = attHref({
      classId: "c1",
      month: "2026-07",
      teacherId: "t1",
      subjectId: "math",
      mode: "teacher",
    });
    expect(url).toBe("/attendance?subject=math&teacher=t1&class=c1&month=2026-07&mode=teacher");
  });

  it("🔴 범위(range) 파라미터는 폐기 — 어떤 링크에도 안 붙는다(항상 그달 전체)", () => {
    expect(attHref({ classId: "c1", month: "2026-07", mode: "teacher" })).not.toContain("range");
  });
});
