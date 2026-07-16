import { describe, expect, it } from "vitest";
import { findNavGroup, findNavItem, navPresentation } from "./navigation";

describe("navigation presentation", () => {
  it("운영실은 데스크톱 작업면으로 표시한다", () => {
    const dashboard = findNavItem("/dashboard");
    expect(dashboard).toBeTruthy();
    expect(dashboard!.label).toBe("운영실");
    expect(navPresentation(dashboard!)).toBe("desktop");
  });

  it("등록 상담은 별도 권한을 가진 탐색 메뉴로 노출한다", () => {
    const enrollment = findNavItem("/enrollment");
    expect(enrollment).toMatchObject({ label: "등록 상담", menuKey: "enrollment" });
    expect(enrollment!.hidden).not.toBe(true);
  });

  it("presentation을 생략한 기존 메뉴는 플로팅 창이 기본값이다", () => {
    const students = findNavItem("/students");
    expect(students).toBeTruthy();
    expect(students!.presentation).toBeUndefined();
    expect(navPresentation(students!)).toBe("window");
  });

  it("query와 hash가 붙은 창 경로도 메뉴와 그룹을 유지한다", () => {
    expect(findNavItem("/billing?tab=expenses")?.menuKey).toBe("billing");
    expect(findNavGroup("/billing?tab=expenses#pending")?.label).toBe("경영");
  });
});
