import { describe, expect, it } from "vitest";
import { menuKeyForPath } from "./permissions";
import {
  activeSubTabHref,
  findNavGroup,
  findNavItem,
  navPresentation,
  subTabsForMenu,
  NAV_GROUPS,
} from "./navigation";

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

describe("영어 강사 시트(ECS) — 독립 사이드바 탭 (원장 2026-08-17 승격)", () => {
  // 2026-07-29~08-16엔 시간표의 subOf 하위 카테고리였다. 승격은 사이드바 위치만 바꾼다 —
  // 라우트(/ecs)·menuKey(권한)·창 크기·강사 미니셸 진입은 전부 그대로다.
  it("시간표와 같은 급의 최상위 항목이다 — subOf 없음, 수업 그룹 소속", () => {
    const ecs = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/ecs");
    expect(ecs).toMatchObject({ label: "영어 강사 시트", menuKey: "ecs" });
    expect(ecs!.subOf).toBeUndefined();
    expect(ecs!.hidden).not.toBe(true);
    expect(findNavGroup("/ecs")?.label).toBe("수업");
  });

  it("창 해석(findNavItem)은 불변 — 지우면 WindowLink가 창을 못 연다", () => {
    expect(findNavItem("/ecs")?.menuKey).toBe("ecs");
    expect(findNavItem("/ecs/abc-123")?.menuKey).toBe("ecs");
  });

  // 시간표 하부탭의 내력: ECS가 떠난 뒤 0면 → 2026-08-28 원장 지시로 3면(본 시간표 / 개발중 / 월별 비교)
  // → **08-31 원장 지시로 사이드바에서 숨김**(`TIMETABLE_DEV_NAV_VISIBLE=false`).
  // 🔴 숨김은 **잠금이 아니다** — 라우트·권한은 그대로 살아서 주소로는 지금도 들어간다(아래 두 번째 it).
  // 🔴 개발중 면은 **본 시간표와 같은 menuKey**를 쓴다 — 새 키를 만들면 auth_menu_access DEFAULTS에
  //    없어 master 빼고 전원 차단이 된다(#92). 다시 켤 때도 이 성질을 유지할 것.
  it("시간표 하부탭은 지금 숨김 — 사이드바에 줄이 서지 않는다", () => {
    expect(subTabsForMenu("timetable")).toEqual([]);
  });

  it("🔴 숨겨도 경로 권한은 살아 있다 — /timetable-dev는 시간표 메뉴 키로 판정된다", () => {
    // 이게 null이 되면 주소로 들어간 사람의 뷰-경로 가드가 판정을 못 한다(신규 라우트는 fail-open).
    expect(menuKeyForPath("/timetable-dev")).toBe("timetable");
    expect(menuKeyForPath("/timetable-dev/compare")).toBe("timetable");
  });

  it("다시 켤 때를 대비 — 긴 경로가 이기는 규약은 그대로다", () => {
    // 스위치를 true로 되돌리면 이 세 줄이 그대로 하부탭이 된다. 그때 '비교' 화면에서 '개발중'이 같이
    // 켜지면 지금 어디인지 알 수 없으므로, 활성 판정 규약을 미리 잠가 둔다.
    const tabs = [
      { label: "시간표", href: "/timetable" },
      { label: "시간표(개발중)", href: "/timetable-dev" },
      { label: "월별 비교", href: "/timetable-dev/compare" },
    ];
    expect(activeSubTabHref(tabs, "/timetable-dev/compare")).toBe("/timetable-dev/compare");
    expect(activeSubTabHref(tabs, "/timetable-dev")).toBe("/timetable-dev");
    expect(activeSubTabHref(tabs, "/timetable")).toBe("/timetable");
  });
});

describe("하위 카테고리·하부탭(subTabsForMenu)", () => {
  // 🔴 원장 2026-08-03: 직원관리가 '직원 목록' 하나만 남자 사이드바의 그 한 줄이 노이즈가 됐다.
  //    "면 하나 = 하부탭 아님". 단 독립 메뉴(subOf 자식)는 하나여도 남는다(지우면 갈 길이 사라진다) —
  //    현재 subOf 사용처는 0이라 이 분기는 다음 하위 카테고리 메뉴가 생길 때 다시 산다.
  it("면이 하나뿐인 메뉴는 하부탭을 내지 않는다(직원관리)", () => {
    expect(subTabsForMenu("staff")).toEqual([]);
  });

  it("면(?tab=)만 있는 메뉴는 menuKey 없이 그대로 — 부모 창에서 면 전환", () => {
    const subs = subTabsForMenu("billing");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((s) => s.menuKey === undefined)).toBe(true);
  });
});

describe("하부탭 활성 — 접두가 겹치면 긴 쪽이 이긴다", () => {
  const attendance = [
    { href: "/attendance/live" },
    { href: "/attendance" },
  ];

  it("오늘 출결에서는 월별이 같이 켜지지 않는다", () => {
    expect(activeSubTabHref(attendance, "/attendance/live")).toBe("/attendance/live");
    expect(activeSubTabHref(attendance, "/attendance/live?tab=seating")).toBe("/attendance/live");
  });

  it("월별 장부·날짜 칸만 월별이 켜진다", () => {
    expect(activeSubTabHref(attendance, "/attendance")).toBe("/attendance");
    expect(activeSubTabHref(attendance, "/attendance/2026-08-14")).toBe("/attendance");
  });

  it("출석부 부모 기본 착지는 월별이다 — 오늘 출결을 부모 href로 올리지 않는다", () => {
    expect(findNavItem("/attendance")?.href).toBe("/attendance");
    expect(NAV_GROUPS.flatMap((g) => g.items).find((i) => i.menuKey === "attendance")?.href).toBe(
      "/attendance",
    );
  });

  it("수납 ?tab= 면은 접두와 섞이지 않는다", () => {
    const billing = subTabsForMenu("billing");
    expect(activeSubTabHref(billing, "/billing")).toBe("/billing");
    expect(activeSubTabHref(billing, "/billing?tab=textbooks")).toBe("/billing?tab=textbooks");
  });
});
