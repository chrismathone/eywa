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
import { teacherNavigationFor } from "@/lib/teacher-navigation";
import {
  canAccess,
  menuKeyForPath,
  resolveMatrix,
  TEACHER_MENU_KEYS,
  type AccessMatrix,
  type SystemRole,
} from "@/lib/permissions";
import { TeacherMenu } from "./teacher-menu";
import { TEACHER_MENU_LINKS } from "@/lib/teacher-menu-links";
import { capMakeupMode } from "@/features/makeups/config";

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
 * 예외 = 역할이 아니라 뷰(강사 미니셸인가)로 여는 화면 — 원스크린 · 영상 제출 현황(둘 다 `getShellView()==="teacher"` 게이트).
 * 🔴 menuKey(`teacher_onescreen`)로 통째로 빼지 말 것 — 같은 키를 쓰는 새 화면이 역할 게이트로 열리면 여기서 못 잡는다.
 */
const VIEW_GATED_HREFS = new Set(["/onescreen", "/onescreen/video-homework"]);
function opens(role: SystemRole, matrix: AccessMatrix, href: string): boolean {
  const key = menuKeyForPath(href);
  if (!key || VIEW_GATED_HREFS.has(href)) return true;
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

  it("뷰로 여는 두 화면은 실제로 뷰 게이트다(역할 requireAccess로 바뀌면 겸직이 튕긴다)", () => {
    for (const file of ["src/app/(shell)/onescreen/page.tsx", "src/app/(shell)/onescreen/video-homework/page.tsx"]) {
      const code = readFileSync(join(process.cwd(), file), "utf8");
      expect(code, file).toContain('(await getShellView()) !== "teacher"');
      expect(code, file).not.toContain('requireAccess("teacher_onescreen")');
    }
  });

  it("강사 행이 연 메뉴가 기존 순서대로 서고 출석부 뒤에 보강관리가 선다", () => {
    expect(menuHrefs("teacher", DEFAULTS)).toEqual([
      "/attendance/quick",
      "/onescreen",
      "/onescreen/video-homework",
      "/ecs",
      "/mcs",
      "/students",
      "/attendance",
      "/makeups",
      "/classes",
      "/timetable",
      "/exams",
      "/consultations",
      "/textbook-requests",
      "/expense-requests",
      "/withdrawal-reports",
      "/documents",
    ]);
  });
  it("보강 운영이 꺼져 있으면 기존 강사 메뉴 순서를 유지한다", () => {
    expect(menuHrefs("teacher", capMakeupMode(DEFAULTS, "off")))
      .toEqual(menuHrefs("teacher", DEFAULTS).filter(href => href !== "/makeups"));
  });
});

/**
 * 신규생 관리 · 업무 작성센터 · 조직·OKR 입구(2026-11-11 — Claude·Codex 합의안 · 원장 위임).
 * 세 메뉴의 코드 기본값은 강사 '없음' 그대로다 — 입구(항목 표)만 미리 두고, 원장이 역할·권한에서 연 학원에서만 선다.
 * 침산이 배포 뒤 저장할 값 = 신규생 관리 × 강사 '담당' · 조직·OKR·업무 작성센터 × 관리자·매니저 '전체'(강사에게는 아직 안 연다).
 */
describe("신규생 관리 · 업무 작성센터 · 조직·OKR 입구 — 권한이 없으면 서지 않는다(2026-11-11)", () => {
  const NEW = ["/newcomers", "/work-records", "/organization/okr"] as const;
  const NEW_KEYS = ["newcomers", "work_records", "okr"] as const;
  const CHINSAN = resolveMatrix([
    { menu: "newcomers", role: "teacher", access: "scoped" },
    ...(["okr", "work_records"] as const).flatMap((menu) => (["admin", "manager"] as const).map((role) => ({ menu, role, access: "full" as const }))),
  ]);

  it("🔴 코드 기본값은 그대로 강사 '없음' — 어느 역할로 강사뷰를 봐도 세 줄은 서지 않는다", () => {
    for (const menu of NEW_KEYS) expect(DEFAULTS[menu].teacher, menu).toBe("none");
    for (const role of [...FULL_SHELL, "teacher" as const]) {
      const hrefs = menuHrefs(role, DEFAULTS);
      for (const h of NEW) expect(hrefs, `${role} · ${h}`).not.toContain(h);
    }
  });

  it("침산이 저장할 값 — 강사에겐 신규생 관리만 서고(상담 다음 자리), 조직·OKR·업무 작성센터는 강사뷰에 서지 않는다", () => {
    const teacher = menuHrefs("teacher", CHINSAN);
    expect(teacher).toContain("/newcomers");
    expect(teacher.indexOf("/newcomers")).toBe(teacher.indexOf("/consultations") + 1);
    expect(teacher).not.toContain("/work-records");
    expect(teacher).not.toContain("/organization/okr");
    // 겸직(관리자 + 담당 반)의 강사뷰 — 신규생 관리는 강사 행 ∧ 실제 역할이 열려 서고, 두 화면은 강사 행이 닫혀 안 선다(관리자뷰에서 연다).
    for (const role of ["admin", "manager"] as const) {
      const hrefs = menuHrefs(role, CHINSAN);
      expect(hrefs, role).toContain("/newcomers");
      expect(hrefs, role).not.toContain("/work-records");
      expect(hrefs, role).not.toContain("/organization/okr");
    }
    // 세운 항목은 실제로 열린다(강사 홈으로 튕기지 않는다).
    for (const role of ["teacher", "admin", "manager"] as const) expect(menuHrefs(role, CHINSAN).filter((h) => !opens(role, CHINSAN, h)), role).toEqual([]);
  });

  /**
   * 세 줄이 **자기 권한 키로** 열리는가 — 위 `opens()`는 경로 → 권한 표(`menuKeyForPath`)로 키를 찾는데 `/work-records` · `/organization`은
   * 그 표에 없어 늘 '열린다'로 지나간다(적대 리뷰 2026-11-11). 줄에 적힌 키(`TEACHER_MENU_LINKS[].menu` — 아래 시험이 페이지 문의 키와 맞춘다)로 직접 본다.
   */
  const opensByOwnKey = (role: (typeof FULL_SHELL)[number] | "teacher", matrix: ReturnType<typeof resolveMatrix>, href: string) => {
    const link = TEACHER_MENU_LINKS.find((l) => l.href === href);
    return !!link && canAccess(role, link.menu, matrix);
  };

  it("원장이 강사에게 두 화면을 열면('담당') 그때 선다 — 전자결재 다음 · 직원 평가 앞", () => {
    const m = resolveMatrix((["okr", "work_records"] as const).map((menu) => ({ menu, role: "teacher" as const, access: "scoped" as const })));
    const hrefs = menuHrefs("teacher", m);
    expect(hrefs).toContain("/work-records");
    expect(hrefs.indexOf("/organization/okr")).toBe(hrefs.indexOf("/work-records") + 1);
    // 🔴 선 줄은 그 사람의 실제 역할로 열린다 · 서지 않은 줄은 안 열리는 줄이다(어느 역할로 강사뷰를 봐도 — 겸직 포함).
    const both = resolveMatrix((["okr", "work_records", "newcomers"] as const).flatMap((menu) => (["teacher", "admin"] as const).map((role) => ({ menu, role, access: "scoped" as const }))));
    for (const matrix of [m, both, CHINSAN, DEFAULTS]) {
      for (const role of [...FULL_SHELL, "teacher" as const]) {
        const shown = menuHrefs(role, matrix);
        for (const h of NEW) {
          if (shown.includes(h)) expect(opensByOwnKey(role, matrix, h), `${role} · ${h} 섰는데 안 열림`).toBe(true);
          // 강사 행이 열렸는데도 서지 않았다면 그 사람의 실제 역할이 못 여는 줄이다(거짓 항목을 세우지 않는다).
          else if (opensByOwnKey("teacher", matrix, h)) expect(opensByOwnKey(role, matrix, h), `${role} · ${h} 열리는데 안 섬`).toBe(false);
        }
      }
    }
    // 강사 행만 열고 관리자 행은 닫힌 학원 — 겸직 관리자에겐 안 선다(눌러도 페이지 문이 실제 역할로 막는다).
    expect(menuHrefs("admin", m)).not.toContain("/work-records");
    expect(menuHrefs("admin", m)).not.toContain("/organization/okr");
  });

  it("세 줄의 권한 키는 강사 메뉴 키 목록에 있고, 페이지 문과 같은 키다", () => {
    const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", "app", "(shell)", ...p), "utf8");
    for (const menu of NEW_KEYS) expect(TEACHER_MENU_KEYS as readonly string[], menu).toContain(menu);
    expect(read("newcomers", "page.tsx")).toContain('requireAccess("newcomers")');
    expect(read("work-records", "page.tsx")).toContain('requireAccess("work_records")');
    expect(read("organization", "okr", "page.tsx")).toContain("requireOkrViewer()");
    expect(readFileSync(join(process.cwd(), "src", "features", "organization-okr", "access.ts"), "utf8")).toContain('requireAccess("okr")');
  });

  it("영어 화면에는 세우지 않는다 — 세 화면 모두 문구가 한국어뿐이다", () => {
    const menus = teacherMenuKeysFor("teacher", resolveMatrix(NEW_KEYS.map((menu) => ({ menu, role: "teacher" as const, access: "scoped" as const }))));
    const hrefsIn = (lang: "ko" | "en") => teacherNavigationFor({ menus, lang }).groups.flatMap((g) => g.items.map((d) => d.href));
    for (const h of NEW) {
      expect(hrefsIn("ko"), h).toContain(h);
      expect(hrefsIn("en"), h).not.toContain(h);
    }
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

  it("레이아웃이 **실제 역할**과 사용자 매트릭스(본인 강사뷰는 개인 메뉴 권한을 강사 행에도 얹은 것)로 계산해 넘긴다", () => {
    expect(layout).toMatch(/teacherMenuKeysFor\(user\.systemRole, teacherViewMatrix\)/);
    expect(layout).toMatch(/teacherViewMatrix = viewAs \? permMatrix : openOwnGrantsInTeacherView\(permMatrix, user\.id, user\.systemRole,/);
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
