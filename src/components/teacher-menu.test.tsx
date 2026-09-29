/**
 * 강사 '내 메뉴'가 **누르면 튕기는 항목**을 세우지 않는다 (2026-09-11 메뉴·창 이동 전수검사).
 *
 * 이 드롭다운은 강사 미니셸의 **유일한 입구**다 — 실 강사뿐 아니라 강사뷰로 전환한 겸직(관리자 계열)과
 * '다른 강사 뷰'(열람 전용)도 이 메뉴를 쓴다. 그런데 항목은 **강사 행**으로 세우고 페이지(`requireAccess`)는
 * **실제 역할**로 열어서, 상담사로 강사뷰를 보면 '출석부'를 눌렀는데 원스크린이 떴다(강사 홈으로 튕김).
 * 원장 결정: 실제 역할로 못 여는 항목은 **숨긴다**.
 *
 * 같은 자리의 둘째 결함 — 메뉴에서 뺀 캘린더(원장 2026-09-10)가 이 드롭다운에만 남아 있었다.
 *
 * 판정은 레이아웃이 한 번 계산해 내려보낸다 — 여기서는 그 값이 화면에 그대로 반영되는지(배선)와,
 * 기본 권한표에서 어떤 역할도 튕기는 항목을 못 보는지(성질)를 잠근다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NAV_GROUPS, navItemByKey, teacherMenuKeysFor } from "@/lib/navigation";
import {
  canAccess,
  menuKeyForPath,
  resolveMatrix,
  TEACHER_MENU_KEYS,
  type AccessMatrix,
  type SystemRole,
} from "@/lib/permissions";
import { TeacherMenu } from "./teacher-menu";

// 드롭다운은 평평하게 — base-ui 팝업은 열려야 그려지는데, 여기서 보려는 건 '무엇이 서는가'뿐이다.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuSub: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuSubContent: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ render, children }: { render?: ReactElement; children?: ReactNode }) =>
      render ? React.cloneElement(render, undefined, children) : <div>{children}</div>,
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/shell/view-actions", () => ({ switchToAdminView: vi.fn() }));
vi.mock("@/features/teacher-view/lang-switch", () => ({ TeacherLangSwitch: () => null }));

const DEFAULTS = resolveMatrix([]);
const FULL_SHELL: SystemRole[] = ["master", "admin", "manager", "counselor", "accountant", "viewer"];

/**
 * 레이아웃이 강사 미니셸에서 `TeacherMenu`에 넘기는 값을 그대로 흉내 낸다. 담당 과목 축(ECS·MCS)은 이 테스트의
 * 관심사가 아니라 영어·수학을 둘 다 맡은 것으로 두고, 레이아웃처럼 실제 역할을 함께 본다.
 */
function layoutProps(role: SystemRole, matrix: AccessMatrix) {
  return {
    menus: teacherMenuKeysFor(role, matrix),
    showEcs: canAccess(role, "ecs", matrix),
    showMcs: canAccess(role, "mcs", matrix),
  };
}

/** 그 역할로 강사뷰를 볼 때 '내 메뉴'에 서는 링크(맨 아래 '내 정보'는 권한과 무관해 뺀다). */
function menuHrefs(role: SystemRole, matrix: AccessMatrix): string[] {
  const { container } = render(<TeacherMenu {...layoutProps(role, matrix)} />);
  const hrefs = [...container.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h !== "/me");
  cleanup();
  return hrefs;
}

/**
 * 누르면 그 화면이 **실제로 열리는가** — 페이지 `requireAccess(menu)`와 같은 판정(실제 역할 × 사용자 매트릭스).
 * 원스크린만 예외: 그 페이지는 역할이 아니라 뷰(강사 미니셸인가)로 연다.
 */
function opens(role: SystemRole, matrix: AccessMatrix, href: string): boolean {
  const key = menuKeyForPath(href);
  if (!key || key === "teacher_onescreen") return true;
  return canAccess(role, key, matrix);
}

describe("강사 '내 메뉴' — 누르면 튕기는 항목이 없다", () => {
  it.each([...FULL_SHELL, "teacher" as const])(
    "기본 권한표 · %s로 강사뷰를 봐도 모든 항목이 실제로 열린다",
    (role) => {
      const bounced = menuHrefs(role, DEFAULTS).filter((h) => !opens(role, DEFAULTS, h));
      expect(bounced, `${role}에게 누르면 강사 홈으로 튕기는 항목이 선다`).toEqual([]);
    },
  );

  it("상담사 — 못 여는 다섯(출결 모드·출석부·내 수업·교재 요청·지출결의서)은 빠지고, 여는 메뉴는 남는다", () => {
    const hrefs = menuHrefs("counselor", DEFAULTS);
    for (const h of ["/attendance/quick", "/attendance", "/classes", "/textbook-requests", "/expense-requests"]) {
      expect(hrefs).not.toContain(h);
    }
    for (const h of ["/onescreen", "/students", "/timetable", "/exams", "/consultations", "/documents"]) {
      expect(hrefs).toContain(h);
    }
  });

  it("수업 평가를 강사 행으로만 연 학원 — 실 강사에겐 서고, 겸직 관리자에겐 안 선다(관리자 행은 닫혀 있다)", () => {
    const m = resolveMatrix([{ menu: "class_review", role: "teacher", access: "scoped" }]);
    expect(menuHrefs("teacher", m)).toContain("/class-review");
    expect(menuHrefs("admin", m)).not.toContain("/class-review");
  });

  it("실 강사는 달라지는 게 없다 — 강사 행이 연 메뉴가 원래 순서대로 선다(메뉴에서 뺀 캘린더만 빠진다)", () => {
    expect(menuHrefs("teacher", DEFAULTS)).toEqual([
      "/attendance/quick",
      "/onescreen",
      "/ecs",
      "/mcs",
      "/students",
      "/attendance",
      "/classes",
      "/timetable",
      "/exams",
      "/consultations",
      "/textbook-requests",
      "/expense-requests",
      "/documents",
    ]);
  });
});

describe("메뉴에서 뺀 항목 — 강사 '내 메뉴'도 같은 입구 정책을 따른다", () => {
  it("🔴 캘린더(원장 2026-09-10 '메뉴에서 제외')는 강사 행이 열람이어도 안 선다", () => {
    // 전제: 권한은 그대로다 — 닫는 것은 사람이 드나드는 입구뿐이고 주소로는 여전히 열린다.
    expect(DEFAULTS.calendar.teacher).not.toBe("none");
    expect(menuHrefs("teacher", DEFAULTS)).not.toContain("/calendar");
    expect(menuHrefs("master", DEFAULTS)).not.toContain("/calendar");
  });

  it("사이드바엔 숨겼지만 이 드롭다운이 유일한 입구인 교재 요청·지출결의서는 그대로 선다", () => {
    const hrefs = menuHrefs("teacher", DEFAULTS);
    expect(hrefs).toContain("/textbook-requests");
    expect(hrefs).toContain("/expense-requests");
  });
});

describe("배선 — 레이아웃이 계산하고, 메뉴는 받은 것만 그린다", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
  const layout = read("src", "app", "(shell)", "layout.tsx");
  const menu = read("src", "components", "teacher-menu.tsx");
  const resolver = read("src", "lib", "teacher-navigation.ts");

  it("레이아웃이 **실제 역할**과 사용자 매트릭스로 계산해 넘긴다", () => {
    expect(layout).toMatch(/teacherMenuKeysFor\(user\.systemRole, permMatrix\)/);
    expect(layout).toMatch(/menus=\{teacherMenus\}/);
  });

  it("🔴 메뉴가 강사 행만으로 다시 거르지 않는다 — 그러면 튕기는 항목이 되살아난다", () => {
    expect(menu).not.toMatch(/canAccess\("teacher"/);
    expect(resolver).not.toMatch(/canAccess\("teacher"/);
    expect(menu).toMatch(/teacherNavigationFor\(\{ menus,/);
    expect(resolver).toMatch(/menus\.includes\(key\)/);
  });
});

describe("입구 정책은 NAV 표 한 곳 — `hidden`이면 강사 '내 메뉴'도 닫힌다(예외는 `teacherMenuEntry`)", () => {
  // 강사에게 전부 연 매트릭스 — 권한 축을 지우고 입구 정책만 본다.
  const OPEN = resolveMatrix(
    TEACHER_MENU_KEYS.map((menu) => ({ menu, role: "teacher" as const, access: "full" as const })),
  );

  it("강사 메뉴 키마다 — NAV 항목이 hidden이고 teacherMenuEntry가 아니면 빠지고, 나머지는 선다", () => {
    const shown = new Set(teacherMenuKeysFor("teacher", OPEN));
    for (const menu of TEACHER_MENU_KEYS) {
      const item = navItemByKey(menu);
      const closed = !!item?.hidden && !item.teacherMenuEntry;
      expect(shown.has(menu), menu).toBe(!closed);
    }
  });

  it("teacherMenuEntry는 hidden 항목에만 단다 — 없는 데 달면 아무 뜻이 없어 오해만 남는다", () => {
    const stray = NAV_GROUPS.flatMap((g) => g.items)
      .filter((i) => i.teacherMenuEntry && !i.hidden)
      .map((i) => i.href);
    expect(stray).toEqual([]);
  });
});

describe("학원 설정 '탭 및 메뉴 구성 → 강사뷰'가 '내 메뉴'를 바꾼다(원장 2026-09-22)", () => {
  const OPEN_ALL = resolveMatrix([]);
  const base = layoutProps("teacher", OPEN_ALL);
  const hrefsOf = () => Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));

  it("감춘 항목은 빠지고 정한 순서로 선다", () => {
    cleanup();
    render(
      <TeacherMenu
        {...base}
        home={null}
        layout={[
          { href: "/students", order: 0 },
          { href: "/attendance/quick", order: 1, hidden: true },
        ]}
      />,
    );
    const hs = hrefsOf();
    expect(hs[0]).toBe("/students");
    expect(hs).not.toContain("/attendance/quick");
  });

  it("홈은 감춰도 맨 위에 남는다", () => {
    cleanup();
    render(<TeacherMenu {...base} home="/onescreen" layout={[{ href: "/onescreen", hidden: true }]} />);
    expect(hrefsOf()[0]).toBe("/onescreen");
  });
  it("강사 폴더와 내부 메뉴에 정한 이름·아이콘을 실제로 그린다", () => {
    cleanup();
    const { container } = render(<TeacherMenu {...base} home="/onescreen"
      groups={[{ id: "custom-lesson", label: "수업 준비", icon: "folder" }]}
      layout={[{ href: "/timetable", label: "우리 일정", icon: "star", groupId: "custom-lesson" }]} />);
    expect(container.textContent).toContain("수업 준비");
    const link = container.querySelector('a[href="/timetable"]');
    expect(link?.textContent).toContain("우리 일정");
    expect(link?.querySelector("img")).toHaveAttribute("src", "/icons/star.png");
    expect(hrefsOf().filter((href) => href === "/timetable")).toHaveLength(1);
    expect(hrefsOf()[0]).toBe("/onescreen");
  });

  it("레이아웃이 학원 설정 값을 내려 준다(배선)", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/(shell)/layout.tsx"), "utf8");
    expect(layout).toMatch(/layout=\{settings\.navigation\.teacherMenus\}/);
  });
});
