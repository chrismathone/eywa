/**
 * 역할·권한 면의 줄 구성 = 왼쪽 탭과 그 내부 메뉴의 차례 (원장 2026-10-06).
 *
 * 지키는 것:
 *  · 전체 목록(`permissionRowGroups`)에는 **모든 권한 키가 정확히 한 번** 선다 — 어떤 메뉴 구성에서도(감춤 · 옮김 · 새 탭).
 *    화면에 세우는 목록(`editablePermissionRowGroups`)은 거기서 메뉴에 없는 화면 · 감춘 메뉴 · 역할 전용 화면을 뺀다.
 *  · 차례·묶음·이름은 사이드바와 같은 해석에서 나온다 — 원장이 탭을 옮기면 표도 따라 바뀐다.
 *  · 메뉴 버튼이 없는 권한은 그 권한을 쓰는 화면 아래에 선다.
 */
import { describe, expect, it } from "vitest";
import { configuredHubGroups, HUB_GROUPS, SUPPORT_GROUPS } from "@/lib/menu-hub";
import { teacherMenuKeysFor } from "@/lib/navigation";
import { CONNECTED_APP_MENU_KEYS, MENU_KEYS, MENU_LABEL, resolveMatrix, TEACHER_MENU_KEYS, type MenuKey } from "@/lib/permissions";
import { SETTINGS_ROLE_HREF } from "@/lib/settings-role-catalog";
import { teacherNavigationSource } from "@/lib/teacher-navigation";
import { TEACHER_MENU_LINKS } from "@/lib/teacher-menu-links";
import { CONNECTED_APP_GROUP, editablePermissionRowGroups, NO_MENU_GROUP, permissionRowGroups, TEACHER_ONLY_GROUP, type PermissionNavigation } from "./permission-rows";
import { TEACHER_TOGGLE_KEYS, teacherToggleOnAccess, teacherToggleRows } from "./teacher-toggle-rows";

const keysOf = (nav?: PermissionNavigation, generic = false) => permissionRowGroups(nav, { generic }).flatMap((g) => g.rows.map((r) => r.menu));
const group = (id: string, nav?: PermissionNavigation) => permissionRowGroups(nav).find((g) => g.id === id);
const menusOf = (id: string, nav?: PermissionNavigation) => (group(id, nav)?.rows ?? []).map((r) => r.menu);

/** 옮기고 · 감추고 · 이름을 바꾸고 · 새 탭을 만든 구성 — 줄이 빠지거나 겹치기 쉬운 경우를 한데 모았다. */
const BUSY: PermissionNavigation = {
  groups: [
    { id: "custom-desk", label: "데스크", order: 0 },
    { id: "billing", hidden: true },
    { id: "counsel", label: "상담", order: 1 },
  ],
  menus: [
    // 같은 권한(출석부)의 면 하나만 새 탭으로 — 수납의 면은 2026-10-14부터 메뉴가 아니다(화면 안 탭).
    { href: "/attendance/quick", groupId: "custom-desk", order: 0 },
    { href: "/students", groupId: "custom-desk", order: 1, label: "학생 명부" },
    { href: "/classes", order: 0 },
    { href: "/timetable", hidden: true },
    { href: "/attendance/live", hidden: true },
  ],
  teacherMenus: [{ href: "/expense-requests", order: 0 }, { href: "/textbook-requests", hidden: true }],
};

describe("화면에 세우는 줄 — 탭 및 메뉴 구성에서 쓰고 있는 화면의 권한만(원장 2026-10-06)", () => {
  for (const [name, nav, generic, hiddenMenus] of [
    ["저장된 구성이 없을 때", undefined, false, []],
    ["일반판(기능 면 포함)", undefined, true, []],
    // 강사뷰에서 감춘 교재 요청 · 감춘 수납관리 탭(과 그 안의 급여 정책 설정)이 더 빠진다 — 시간표는 관리자뷰에서 감췄어도
    // 강사 '내 메뉴'에 보여 남는다. 수납관리는 화면이 하나라(2026-10-14) 탭을 감추면 입구가 없다.
    ["옮김 · 감춤 · 개명 · 새 탭이 섞인 구성", BUSY, false, ["textbook_requests", "billing", "payroll_settings"]],
  ] as const) {
    it(name, () => {
      const shown = editablePermissionRowGroups(nav, { generic }).flatMap((g) => g.rows.map((r) => r.menu));
      // 빠지는 것은 '메뉴에 없는 화면' 묶음 · 역할 전용 화면 둘 · 구성에서 감춘 메뉴 · 연결 앱(따로 '연결 앱 권한' 표)뿐이고, 차례는 그대로다.
      const dropped = new Set<MenuKey>([...menusOf(NO_MENU_GROUP.id, nav), ...menusOf(CONNECTED_APP_GROUP.id, nav), "teacher_onescreen", "my_learning", ...hiddenMenus]);
      expect(shown).toEqual(keysOf(nav, generic).filter((menu) => !dropped.has(menu)));
      expect([...dropped].filter((menu) => !(hiddenMenus as readonly string[]).includes(menu)).sort()).toEqual(["admin", "app_todays_math", "calendar", "my_learning", "teacher_onescreen"]);
      expect(shown).toHaveLength(MENU_KEYS.length - dropped.size);
      expect(editablePermissionRowGroups(nav, { generic }).some((g) => g.id === NO_MENU_GROUP.id || g.id === CONNECTED_APP_GROUP.id)).toBe(false);
      // 줄이 다 빠진 묶음은 세우지 않는다(이름만 남은 빈 띠).
      expect(editablePermissionRowGroups(nav, { generic }).every((g) => g.rows.length > 0)).toBe(true);
    });
  }

  const shownMenus = (nav: PermissionNavigation) => editablePermissionRowGroups(nav).flatMap((g) => g.rows.map((r) => r.menu));

  it("🔴 감춘 메뉴의 줄은 세우지 않는다 — 그 화면 안에서 쓰는 권한 줄도 함께 빠진다(원장 *\"감춘 메뉴 줄도 표에서 빼\"*)", () => {
    // 수납관리 탭을 통째로 감춘다(옮긴 면 없음) → 수납관리 줄과 그 아래 급여 정책 설정 줄이 함께 빠지고, 빈 탭 띠도 서지 않는다.
    const nav: PermissionNavigation = { groups: [{ id: "billing", hidden: true }] };
    expect(menusOf("billing", nav)).toEqual(["billing", "payroll_settings"]); // 전체 목록에는 그대로 있다(권한은 살아 있다)
    expect(shownMenus(nav)).not.toContain("billing");
    expect(shownMenus(nav)).not.toContain("payroll_settings");
    expect(editablePermissionRowGroups(nav).some((g) => g.id === "billing")).toBe(false);
    // 다른 줄은 그대로다.
    expect(shownMenus(nav)).toHaveLength(shownMenus({}).length - 2);
  });

  it("관리자뷰에서 감췄어도 강사 '내 메뉴'에 보이는 메뉴는 남긴다 — 양쪽에서 다 감춰야 빠진다", () => {
    // BUSY는 시간표를 관리자뷰에서만 감췄다 — 강사 '내 메뉴'가 쓰고 있으니 줄(과 그 아래 구글 시트 연동)이 남는다.
    expect(shownMenus(BUSY)).toEqual(expect.arrayContaining(["timetable", "sheet_sync"]));
    const both: PermissionNavigation = { ...BUSY, teacherMenus: [...(BUSY.teacherMenus ?? []), { href: "/timetable", hidden: true }] };
    expect(shownMenus(both)).not.toContain("timetable");
    expect(shownMenus(both)).not.toContain("sheet_sync");
  });

  it("면 하나만 감춘 권한은 남는다 — 다른 입구가 보이면 쓰고 있는 것이다", () => {
    // BUSY는 '오늘 출결' 면만 감췄다(출석부의 다른 면은 보인다).
    expect(shownMenus(BUSY)).toEqual(expect.arrayContaining(["attendance", "seat_attendance"]));
  });

  it("남긴 줄의 감춤 표식은 지우지 않는다 — 관리자뷰에서 감췄는데 왜 서 있는지 화면이 적는다", () => {
    const rows = editablePermissionRowGroups(BUSY).flatMap((g) => g.rows);
    expect(rows.find((r) => r.menu === "timetable")?.hiddenInMenu).toBe(true);
    // 표식이 달린 채 선 줄은 강사 '내 메뉴'가 쓰는 메뉴뿐이다.
    expect(rows.filter((r) => r.hiddenInMenu).map((r) => r.menu)).toEqual(["timetable"]);
    // 감춘 수납관리 탭은 입구가 하나도 없어 묶음째 서지 않는다(전체 목록에는 표식과 함께 남는다 — 아래 describe).
    expect(editablePermissionRowGroups(BUSY).some((g) => g.id === "billing")).toBe(false);
  });

  it("🔴 설정 권한은 관리자뷰만 따른다 — 강사뷰의 '설정' 묶음에 입구가 있어도 관리자뷰에서 감추면 빠진다", () => {
    const base = shownMenus({});
    expect(base).toEqual(expect.arrayContaining(["report_settings", "ai_ment"]));
    // 보고서 설정·AI 멘트는 수업보고서 화면 위 탭이라(2026-10-14) 수업보고서를 감추면 함께 빠진다.
    const nav: PermissionNavigation = { menus: [{ href: "/lesson-reports", hidden: true }] };
    expect(SETTINGS_ROLE_HREF.report_settings.startsWith("/lesson-reports")).toBe(true);
    for (const menu of ["lesson_reports", "report_settings", "ai_ment"]) expect(shownMenus(nav)).not.toContain(menu);
    expect(shownMenus(nav)).toHaveLength(base.length - 3);
  });
});

describe("모든 권한 키가 정확히 한 번 선다", () => {
  for (const [name, nav, generic] of [
    ["저장된 구성이 없을 때", undefined, false],
    ["일반판(기능 면 포함)", undefined, true],
    ["옮김 · 감춤 · 개명 · 새 탭이 섞인 구성", BUSY, false],
  ] as const) {
    it(name, () => {
      const keys = keysOf(nav, generic);
      expect([...keys].sort()).toEqual([...MENU_KEYS].sort());
      expect(new Set(keys).size).toBe(keys.length);
    });
  }
});

describe("차례 = 왼쪽 탭 → 그 탭의 내부 메뉴", () => {
  it("묶음의 차례와 이름이 사이드바의 탭 그대로다", () => {
    const tabs = configuredHubGroups([...HUB_GROUPS, ...SUPPORT_GROUPS], undefined, undefined, true);
    const groups = permissionRowGroups();
    expect(groups.slice(0, tabs.length).map((g) => [g.id, g.label])).toEqual(tabs.map((g) => [g.id, g.label]));
    expect(groups.slice(tabs.length).map((g) => g.id)).toEqual([TEACHER_ONLY_GROUP.id, NO_MENU_GROUP.id, CONNECTED_APP_GROUP.id]);
  });

  it("탭 안의 줄 차례 = 내부 메뉴 차례(같은 권한의 면은 한 줄로 접힌다)", () => {
    const tab = configuredHubGroups(HUB_GROUPS, undefined, undefined, true).find((g) => g.id === "class")!;
    const fromMenu = [...new Set(tab.items.map((d) => d.menuKey))];
    expect(menusOf("class").filter((menu) => fromMenu.includes(menu))).toEqual(fromMenu);
  });

  it("줄은 탭 이름 한 줄 — 같은 권한이 여는 면을 나열하지 않는다(원장 2026-11-05 *\"문구 특별한 일 없으면 나누지마\"*)", () => {
    // 수납(교재·지출·환불·계산기·회차 확정) · 셔틀(면 9개) · 출석부(오늘 출결·출결 모드) · 재고관리 — 모두 이름 한 줄.
    for (const [g, menu, label] of [["billing", "billing", "수납관리"], ["operation", "shuttle", "셔틀"], ["class", "attendance", "출석부"]] as const) {
      const r = group(g)!.rows.find((x) => x.menu === menu)!;
      expect(r.label).toBe(label);
      expect(r.covers).toEqual([]);
    }
    for (const g of permissionRowGroups()) for (const r of g.rows) expect(r.covers).toEqual([]);
    // 따로 권한이 있는 화면만 제 줄(└)로 선다 — 출석부 아래 랩실·JJ실 출석부.
    const rows = group("class")!.rows;
    const at = rows.findIndex((r) => r.menu === "attendance");
    expect(rows[at + 1]).toMatchObject({ menu: "seat_attendance", inner: true });
  });

  it("'학원 설정' 줄은 설정 묶음의 맨 위에 선다(그 메뉴 자신의 주소 자리) — 첫 면이 다른 권한(프로필·브랜드 설정)을 써도", () => {
    expect(menusOf("owner").slice(0, 2)).toEqual(["owner", "profile_settings"]);
  });

  it("'학원 설정' 줄도 이름 한 줄 — 역할·권한·데이터 정리·데이터 가져오기를 나열하지 않는다(원장 2026-11-05 *\"학원설정으로 통합\"*)", () => {
    const owner = (generic: boolean) => permissionRowGroups(undefined, { generic }).find((g) => g.id === "owner")!.rows.find((r) => r.menu === "owner")!;
    for (const generic of [false, true]) expect(owner(generic)).toMatchObject({ label: "학원 설정", covers: [] });
  });
});

describe("메뉴 버튼이 없는 권한은 그 권한을 쓰는 화면 아래에 선다", () => {
  const after = (id: string, parent: MenuKey) => {
    const rows = group(id)!.rows;
    const from = rows.findIndex((r) => r.menu === parent);
    const inner: MenuKey[] = [];
    for (const r of rows.slice(from + 1)) {
      if (!r.inner) break;
      inner.push(r.menu);
    }
    return inner;
  };

  it("수업보고서 ← 보고서 설정 · AI 멘트 — 수업보고서 화면 위 탭이라 메뉴 버튼이 없다(원장 2026-10-14)", () => {
    expect(after("class", "lesson_reports")).toEqual(["report_settings", "ai_ment"]);
  });
  it("출석부 ← 랩실·JJ실 출석부 · 출석부 급여 비율 설정", () => {
    expect(after("class", "attendance")).toEqual(["seat_attendance", "attendance_salary_settings"]);
  });
  it("원생목록 - 영어이름은 원생목록 아래에서 개별 부여할 수 있다", () => {
    expect(after("student", "students")).toContain("student_english_name");
  });
  it("시간표 ← 구글 시트 연동 · 수납관리 ← 급여 정책 설정 · 원생목록 ← makeedu 연동", () => {
    expect(after("class", "timetable")).toEqual(["sheet_sync"]);
    expect(after("billing", "billing")).toEqual(["payroll_settings"]);
    expect(after("student", "students")).toEqual(["student_english_name", "integrations"]);
  });

  it("🔴 강사 '내 메뉴'에만 입구가 있는 권한 · 어느 메뉴에도 없는 화면 — 이 목록이 늘면 새 권한의 자리를 정하지 않은 것이다", () => {
    expect(menusOf(TEACHER_ONLY_GROUP.id)).toEqual(["textbook_requests", "expense_requests"]);
    // 캘린더 = 메뉴에서 뺀 화면 · 관리자 도구 = 설정으로 옮겨진 옛 화면 · 내 학습 = 학생 전용.
    expect(menusOf(NO_MENU_GROUP.id)).toEqual(["calendar", "admin", "my_learning"]);
  });

  it("연결 앱 권한은 따로 묶이고(전체 목록) 역할별 메뉴 표에는 서지 않는다 — 그 아래 '연결 앱 권한' 표에 선다(원장 2026-11-05)", () => {
    expect(menusOf(CONNECTED_APP_GROUP.id)).toEqual([...CONNECTED_APP_MENU_KEYS]);
    const editable = editablePermissionRowGroups().flatMap((g) => g.rows.map((r) => r.menu));
    for (const key of CONNECTED_APP_MENU_KEYS) expect(editable, key).not.toContain(key);
    expect(editablePermissionRowGroups().map((g) => g.id)).not.toContain(CONNECTED_APP_GROUP.id);
  });
});

describe("원장이 메뉴 구성을 바꾸면 표도 따라 바뀐다", () => {
  it("탭 안 차례를 바꾸면 줄 차례가 바뀐다", () => {
    expect(menusOf("class", BUSY)[0]).toBe("classes");
    expect(menusOf("class")[0]).not.toBe("classes");
  });

  it("탭 이름을 바꾸면 묶음 이름이 바뀌고, 새 탭으로 옮긴 메뉴는 그 탭 아래에 선다", () => {
    expect(group("counsel", BUSY)!.label).toBe("상담");
    const desk = group("custom-desk", BUSY)!;
    expect(desk.label).toBe("데스크");
    expect(desk.rows.map((r) => r.menu)).toEqual(["students", "student_english_name", "integrations"]);
    // 이름을 바꾼 메뉴는 바꾼 이름을 함께 적는다(권한 이름은 그대로다).
    expect(desk.rows[0]).toMatchObject({ label: MENU_LABEL.students, covers: ["학생 명부"] });
  });

  it("면 하나만 다른 탭으로 옮겨도 그 권한의 줄은 대표 화면이 있는 탭에 남는다", () => {
    expect(menusOf("custom-desk", BUSY)).not.toContain("attendance");
    expect(menusOf("class", BUSY)).toContain("attendance");
  });

  it("🔴 감춘 메뉴·감춘 탭의 권한도 전체 목록에는 남는다(표식만 단다) — 감춤은 입구뿐이고 권한은 그대로다. 화면에 세울지는 위 describe", () => {
    expect(group("billing", BUSY)).toMatchObject({ hiddenInMenu: true });
    const timetable = group("class", BUSY)!.rows.find((r) => r.menu === "timetable")!;
    expect(timetable.hiddenInMenu).toBe(true);
    // 면 하나만 감춘 권한은 감춘 것이 아니다(다른 입구가 남아 있다).
    expect(group("class", BUSY)!.rows.find((r) => r.menu === "attendance")!.hiddenInMenu).toBe(false);
  });

  it("강사 전용 권한은 강사뷰 구성의 차례·감춤을 따른다", () => {
    const rows = group(TEACHER_ONLY_GROUP.id, BUSY)!.rows;
    expect(rows.map((r) => r.menu)).toEqual(["expense_requests", "textbook_requests"]);
    expect(rows.find((r) => r.menu === "textbook_requests")!.hiddenInMenu).toBe(true);
  });
});

describe("'강사 내 메뉴 표시' 칸 = 강사 '내 메뉴'가 실제로 세우는 것", () => {
  it("칸의 집합 = 강사에게 전부 열었을 때 '내 메뉴'가 세울 수 있는 권한", () => {
    const open = resolveMatrix(TEACHER_MENU_KEYS.map((menu) => ({ menu, role: "teacher" as const, access: "full" as const })));
    const menu = teacherMenuKeysFor("teacher", open).filter((k) => (TEACHER_MENU_KEYS as readonly MenuKey[]).includes(k));
    expect([...teacherToggleRows().map((r) => r.menu)].sort()).toEqual([...menu].sort());
    expect([...TEACHER_TOGGLE_KEYS].sort()).toEqual([...menu].sort());
  });

  it("🔴 모든 칸에 '내 메뉴'의 줄이 하나 이상 있다 — 줄이 없는 칸은 켜도 꺼도 메뉴가 안 바뀐다", () => {
    const linked = new Set(TEACHER_MENU_LINKS.map((l) => l.menu));
    expect(TEACHER_TOGGLE_KEYS.filter((menu) => !linked.has(menu))).toEqual([]);
  });

  it("차례 = '내 메뉴'가 서는 차례(홈이 맨 위, 나머지는 강사뷰 구성 순)", () => {
    const inMenu = [...new Set(teacherNavigationSource().flatMap((g) => g.items.map((d) => d.menuKey)))].filter((k) => TEACHER_TOGGLE_KEYS.includes(k));
    const expected = ["teacher_onescreen", ...inMenu.filter((k) => k !== "teacher_onescreen")];
    expect(teacherToggleRows().map((r) => r.menu)).toEqual(expected);
    expect(teacherToggleRows(BUSY).map((r) => r.menu).slice(0, 2)).toEqual(["teacher_onescreen", "expense_requests"]);
  });

  it("'내 메뉴'에 서는 이름이 권한 이름과 다르면 그 이름을 함께 적는다", () => {
    const row = (menu: MenuKey) => teacherToggleRows().find((r) => r.menu === menu)!;
    expect(row("attendance").covers).toEqual(["출결 모드", "출석부"]);
    expect(row("teacher_onescreen").covers).toEqual(["수업 마감 (원스크린)", "영상 제출 현황"]);
    expect(row("students").covers).toEqual(["내 학생"]);
    expect(row("timetable").covers).toEqual([]);
  });

  it("🔴 꺼져 있던 칸을 켜면 '없음'이 아닌 수준이 된다 — 기본값이 '없음'인 전자결재·직원 평가는 담당으로 켠다(안 그러면 체크가 안 눌린다)", () => {
    for (const menu of TEACHER_TOGGLE_KEYS) expect(teacherToggleOnAccess(menu), menu).not.toBe("none");
    expect(teacherToggleOnAccess("approvals")).toBe("scoped");
    expect(teacherToggleOnAccess("class_review")).toBe("scoped");
    expect(teacherToggleOnAccess("documents")).toBe("readonly");
  });

  it("강사뷰 구성에서 감춘 칸은 표식을 단다 — 홈은 감춰도 맨 위에 남으므로 달지 않는다", () => {
    const nav: PermissionNavigation = { teacherMenus: [{ href: "/textbook-requests", hidden: true }, { href: "/onescreen", hidden: true }, { href: "/onescreen/video-homework", hidden: true }] };
    const row = (menu: MenuKey) => teacherToggleRows(nav).find((r) => r.menu === menu)!;
    expect(row("textbook_requests").hiddenInMenu).toBe(true);
    expect(row("teacher_onescreen").hiddenInMenu).toBe(false);
    expect(row("timetable").hiddenInMenu).toBe(false);
  });
});
