import { describe, expect, it } from "vitest";
import { findNavGroup, findNavItem, navPresentation, subTabsForMenu, NAV_GROUPS } from "./navigation";

describe("navigation presentation", () => {
  it("운영실은 데스크톱 작업면으로 표시한다", () => {
    const dashboard = findNavItem("/dashboard");
    expect(dashboard).toBeTruthy();
    expect(dashboard!.label).toBe("운영실");
    expect(navPresentation(dashboard!)).toBe("desktop");
  });

  it("등록상담은 별도 권한을 가진 탐색 메뉴로 노출한다", () => {
    const enrollment = findNavItem("/enrollment");
    // 라벨 = 페이지 metadata.title("등록상담 — eywa")과 동일 — 창 타이틀바가 문서 제목을 보여주므로.
    expect(enrollment).toMatchObject({ label: "등록상담", menuKey: "enrollment" });
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
    expect(findNavGroup("/billing?tab=expenses#pending")?.label).toBe("운영");
  });
});

describe("하위 카테고리(subOf)", () => {
  it("English Class Sheet는 시간표의 하부탭으로 나오고 자기 menuKey를 갖는다(자기 창으로 열림)", () => {
    const subs = subTabsForMenu("timetable");
    expect(subs).toContainEqual({ label: "English Class Sheet", href: "/ecs", menuKey: "ecs" });
  });

  it("subOf 항목은 창 해석(findNavItem)에 그대로 남는다 — 지우면 WindowLink가 창을 못 연다", () => {
    expect(findNavItem("/ecs")).toMatchObject({ menuKey: "ecs", subOf: "timetable" });
    expect(findNavItem("/ecs/abc-123")?.menuKey).toBe("ecs");
  });

  it("subOf는 hidden이 아니다 — 검색 팰릿·모바일 내비에서 계속 찾을 수 있어야 한다", () => {
    expect(findNavItem("/ecs")?.hidden).not.toBe(true);
    const inNav = NAV_GROUPS.flatMap((g) => g.items).some((i) => i.href === "/ecs");
    expect(inNav).toBe(true);
  });

  // 🔴 원장 2026-08-03: 직원관리가 '직원 목록' 하나만 남자 사이드바의 그 한 줄이 노이즈가 됐다.
  //    "면 하나 = 하부탭 아님". 단 독립 메뉴는 하나여도 남는다(지우면 갈 길이 사라진다).
  it("면이 하나뿐인 메뉴는 하부탭을 내지 않는다(직원관리)", () => {
    expect(subTabsForMenu("staff")).toEqual([]);
  });

  it("독립 메뉴(menuKey)는 하나여도 남는다 — 최상위에서 빠져 있어 유일한 진입로다", () => {
    const subs = subTabsForMenu("timetable");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.some((s) => s.menuKey === "ecs")).toBe(true);
  });

  it("면(?tab=)만 있는 메뉴는 menuKey 없이 그대로 — 부모 창에서 면 전환", () => {
    const subs = subTabsForMenu("billing");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((s) => s.menuKey === undefined)).toBe(true);
  });
});
