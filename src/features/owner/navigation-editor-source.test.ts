/**
 * '탭 및 메뉴 구성' — 내부 탭·없는 메뉴는 메뉴로 세우지 않는다(원장 2026-10-14
 * *"내부 탭에 있는 메뉴는 따로 탭 및 메뉴 구성에 넣지 말것. 없는 메뉴 (접근할 수 없는)"*).
 */
import { describe, expect, it } from "vitest";
import { HUB_GROUPS, INNER_TABS, SUPPORT_GROUPS, hubGroupsFor, innerTabsOf } from "@/lib/menu-hub";
import { SUBTABS_BY_MENU } from "@/lib/navigation";
import { resolveMatrix } from "@/lib/permissions";
import { TEACHER_NAV_GROUPS, TEACHER_SETTINGS_GROUP } from "@/lib/teacher-navigation";
import { adminEditorSource, personallyOpenedMenus, teacherEditorSource } from "./navigation-editor-source";

const menuHrefs = (groups: { items: { href: string }[] }[]) => groups.flatMap((g) => g.items.map((d) => d.href));

describe("내부 탭은 메뉴가 아니다", () => {
  it("🔴 수납·셔틀·수업보고서의 화면 위 탭은 메뉴 목록에 없고, 부모 화면은 메뉴에 있다", () => {
    const hrefs = new Set(menuHrefs([...HUB_GROUPS, ...SUPPORT_GROUPS]));
    for (const tab of INNER_TABS) {
      expect(hrefs.has(tab.parent), tab.parent).toBe(true);
      for (const d of tab.items) expect(hrefs.has(d.href), d.href).toBe(false);
    }
    for (const href of ["/billing?tab=refunds", "/billing?tab=sessions", "/shuttle/today", "/lesson-reports?tab=report", "/lesson-reports?tab=ai_ment"]) {
      expect(hrefs.has(href), href).toBe(false);
    }
  });

  it("내부 탭 목록 = 그 화면의 탭 그대로(사이드바 하부탭 표와 같은 면) — 부모 자신과 메뉴 버튼인 면(교재·지출)은 넣지 않는다", () => {
    const menu = new Set(menuHrefs([...HUB_GROUPS, ...SUPPORT_GROUPS]));
    const facesOf = (key: "billing" | "shuttle") => (SUBTABS_BY_MENU[key] ?? []).map((f) => f.href).filter((h) => !menu.has(h));
    expect(INNER_TABS.find((t) => t.parent === "/billing")!.items.map((d) => d.href).sort()).toEqual(facesOf("billing").sort());
    expect(INNER_TABS.find((t) => t.parent === "/shuttle")!.items.map((d) => d.href).sort()).toEqual(facesOf("shuttle").sort());
  });

  it("🔴 수납관리 = 수납 · 교재 · 지출 버튼(원장 2026-10-15 *\"교재와 지출은 … 이전처럼\"*) — 나머지 면은 화면 위 탭으로만", () => {
    const billing = HUB_GROUPS.find((g) => g.id === "billing")!;
    expect(billing.kind).toBe("hub");
    expect(billing.items.map((d) => d.href)).toEqual(["/billing", "/billing?tab=textbooks", "/billing?tab=expenses"]);
    expect(INNER_TABS.find((t) => t.parent === "/billing")!.items.map((d) => d.href)).toEqual(["/billing?tab=refunds", "/billing?tab=calculator", "/billing?tab=sessions"]);
  });

  it("오늘 출결·출결 모드는 출석부 화면 위 탭이 아니라 따로 선 화면이라 메뉴에 남는다(빼면 갈 길이 없다)", () => {
    const hrefs = menuHrefs(HUB_GROUPS);
    expect(hrefs).toContain("/attendance/live");
    expect(hrefs).toContain("/attendance/quick");
  });

  it("🔴 부모 메뉴 권한 없이 탭 권한만 받은 사람에게는 그 탭이 부모 자리에 대신 선다(보고서 설정만 맡은 상담 직원)", () => {
    const matrix = resolveMatrix([{ menu: "report_settings", role: "counselor", access: "full" }]);
    const groups = hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], { systemRole: "counselor", permMatrix: matrix });
    const hrefs = menuHrefs(groups);
    expect(hrefs).toContain("/lesson-reports?tab=report");
    expect(hrefs).not.toContain("/lesson-reports");
    expect(hrefs).not.toContain("/lesson-reports?tab=ai_ment");
    // 부모를 볼 수 있으면 대신 세우지 않는다(원장 = 수업보고서 하나).
    expect(menuHrefs(hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], { systemRole: "master", isMaster: true }))).not.toContain("/lesson-reports?tab=report");
    // 부모를 메뉴 구성에서 감췄으면 대신 입구도 없다.
    const hidden = hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], { systemRole: "counselor", permMatrix: matrix, menuLayout: [{ href: "/lesson-reports", hidden: true }] });
    expect(menuHrefs(hidden)).not.toContain("/lesson-reports?tab=report");
  });

  it("검색은 내부 탭도 찾는다 — 부모 메뉴가 보일 때만, 면마다의 권한으로", () => {
    const master = { systemRole: "master" as const, isMaster: true };
    expect(innerTabsOf("/billing", master).map((d) => d.label)).toEqual(["환불 요청서", "수강료 계산기", "회차 확정"]);
    expect(innerTabsOf("/lesson-reports", master).map((d) => d.href)).toEqual(["/lesson-reports?tab=report", "/lesson-reports?tab=ai_ment"]);
    // 관리자 역할은 보고서 설정·AI 멘트 권한이 기본 '없음' — 수업보고서는 보여도 그 탭은 검색에 안 선다.
    expect(innerTabsOf("/lesson-reports", { systemRole: "admin" })).toEqual([]);
    // 부모가 안 보이는 사람에게는 호출부가 부르지 않는다(메뉴 목록에서 부모를 찾은 뒤 부른다).
    const teacher = hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], { systemRole: "teacher", permMatrix: resolveMatrix([]) });
    expect(menuHrefs(teacher)).not.toContain("/billing");
  });
});

describe("관리자뷰 편집기 — 지점에서 닫힌 메뉴 · 역할 전용 화면은 세우지 않는다", () => {
  it("닫힌 게 없으면 메뉴 목록 그대로 — 선생님 원스크린(강사 전용 홈)만 빠진다", () => {
    expect(menuHrefs(adminEditorSource())).toEqual(menuHrefs([...HUB_GROUPS, ...SUPPORT_GROUPS]).filter((h) => h !== "/onescreen"));
  });
  it("🔴 역할 권한으로는 거르지 않는다 — 기본값이 전 역할 '없음'인 직원 평가·전자결재도 남는다(개인별 권한으로 연다)", () => {
    expect(menuHrefs(adminEditorSource())).toEqual(expect.arrayContaining(["/class-review", "/approvals"]));
  });
  it("셔틀·재고가 닫힌 지점이면 그 메뉴가 빠지고 탭(업무군)은 남는다", () => {
    const source = adminEditorSource(["shuttle", "inventory"]);
    expect(menuHrefs(source)).not.toContain("/shuttle");
    expect(menuHrefs(source)).not.toContain("/inventory");
    expect(source.find((g) => g.id === "operation")!.items.map((d) => d.href)).toEqual(["/staff"]);
    expect(source.map((g) => g.id)).toEqual([...HUB_GROUPS, ...SUPPORT_GROUPS].map((g) => g.id));
  });
});

describe("강사뷰 편집기 — '설정' 폴더와 선생님이 열 수 없는 메뉴는 세우지 않는다", () => {
  it("🔴 '설정' 폴더(학원 설정 등의 내부 탭)는 편집기에 없다 — 실제 '내 메뉴'에는 맡은 선생님에게 그대로 선다", () => {
    const all = TEACHER_NAV_GROUPS.flatMap((g) => g.items.map((d) => d.menuKey));
    const source = teacherEditorSource(all);
    expect(source.some((g) => g.id === TEACHER_SETTINGS_GROUP)).toBe(false);
    expect(TEACHER_NAV_GROUPS.some((g) => g.id === TEACHER_SETTINGS_GROUP)).toBe(true);
  });
  it("강사 역할로 열리거나 개인별로 연 메뉴만 남는다", () => {
    const source = teacherEditorSource(["teacher_onescreen", "attendance"], ["approvals"]);
    const keys = source.flatMap((g) => g.items.map((d) => d.menuKey));
    expect(new Set(keys)).toEqual(new Set(["teacher_onescreen", "attendance", "approvals"]));
    expect(menuHrefs(source)).toEqual(expect.arrayContaining(["/onescreen", "/attendance/quick", "/attendance", "/approvals"]));
  });
  it("개인별로 연 메뉴 = 접근 '없음'이 아닌 줄 · 꺼 둔 기능은 개인 예외로도 안 열린다", () => {
    const rows = [
      { menu: "approvals" as const, access: "full" as const },
      { menu: "class_review" as const, access: "none" as const },
      { menu: "shuttle" as const, access: "readonly" as const },
      { menu: "approvals" as const, access: "readonly" as const },
    ];
    expect(personallyOpenedMenus(rows)).toEqual(["approvals", "shuttle"]);
    expect(personallyOpenedMenus(rows, ["shuttle"])).toEqual(["approvals"]);
  });
});
