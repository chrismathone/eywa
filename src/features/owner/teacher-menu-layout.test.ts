/**
 * 탭 및 메뉴 구성 — **강사뷰**(원장 2026-09-22 *"'관리자뷰' '강사뷰' 메뉴를 따로 구성할 수 있게"*).
 * 적용 규칙 · 저장 페이로드(sparse) · 스키마 · 옛 화면 저장 보호를 잠근다.
 */
import { describe, expect, it } from "vitest";

import { applyTeacherMenuLayout, moveInList, sparseLayoutRows, type MenuLayout } from "./menu-layout";
import { prepareSectionForSave } from "./preset";
import { navigationSchema } from "./settings-types";
import { DEFAULT_SETTINGS } from "./defaults";
import { GENERIC_SETTINGS } from "./generic-defaults";
import { diffSettingsSection, formatSettingChange } from "./settings-diff";
import { TEACHER_MENU_LINKS } from "@/lib/teacher-menu-links";

const d = (href: string) => ({ href });
const hrefs = (xs: { href: string }[]) => xs.map((x) => x.href);

describe("applyTeacherMenuLayout", () => {
  const items = [d("/attendance/quick"), d("/onescreen"), d("/ecs"), d("/students")];

  it("설정이 비면 받은 순서 + 홈만 맨 위(이 기능 이전과 같다)", () => {
    expect(hrefs(applyTeacherMenuLayout(items, [], "/onescreen"))).toEqual(["/onescreen", "/attendance/quick", "/ecs", "/students"]);
    expect(hrefs(applyTeacherMenuLayout(items, undefined, null))).toEqual(hrefs(items));
  });

  it("감춘 항목은 빠지고 정한 순서로 선다", () => {
    const layout: MenuLayout = [
      { href: "/students", order: 0 },
      { href: "/attendance/quick", order: 1, hidden: true },
      { href: "/onescreen", order: 2 },
      { href: "/ecs", order: 3 },
    ];
    expect(hrefs(applyTeacherMenuLayout(items, layout, null))).toEqual(["/students", "/onescreen", "/ecs"]);
  });

  it("🔴 홈은 감춰도 남고 늘 맨 위다(영어 선생님이 ECS로 돌아갈 입구를 잃지 않게)", () => {
    const layout: MenuLayout = [{ href: "/ecs", hidden: true }, { href: "/students", order: 0 }];
    expect(hrefs(applyTeacherMenuLayout(items, layout, "/ecs"))[0]).toBe("/ecs");
    expect(hrefs(applyTeacherMenuLayout(items, layout, "/onescreen"))).not.toContain("/ecs");
  });
});

describe("저장 페이로드 = 바뀐 줄만", () => {
  const code = ["/a", "/b", "/c"];
  it("안 건드리면 한 줄도 안 적는다", () => {
    expect(sparseLayoutRows(code, code, new Set())).toEqual([]);
  });
  it("감춤만 바꾸면 그 줄만, 순서를 바꾸면 전체 순서", () => {
    expect(sparseLayoutRows(code, code, new Set(["/b"]))).toEqual([{ href: "/b", hidden: true }]);
    expect(sparseLayoutRows(["/b", "/a", "/c"], code, new Set())).toEqual([
      { href: "/b", order: 0 },
      { href: "/a", order: 1 },
      { href: "/c", order: 2 },
    ]);
  });
  it("moveInList — 범위 밖이면 그대로", () => {
    expect(moveInList(code, 0, -1)).toEqual(code);
    expect(moveInList(code, 0, 1)).toEqual(["/b", "/a", "/c"]);
  });
});

describe("스키마·기본값", () => {
  it("옛 화면(강사뷰 칸 없음)의 저장도 받는다 — 기본값 []", () => {
    const r = navigationSchema.safeParse({ menus: [] });
    expect(r.success && r.data.teacherMenus).toEqual([]);
  });
  it("강사뷰에 같은 주소가 두 번이면 거절", () => {
    expect(navigationSchema.safeParse({ menus: [], teacherMenus: [{ href: "/ecs" }, { href: "/ecs", hidden: true }] }).success).toBe(false);
  });
  it("기본값 두 벌 모두 강사뷰 칸이 비어 있다(설정이 비면 지금과 같다)", () => {
    expect(DEFAULT_SETTINGS.navigation.teacherMenus).toEqual([]);
    expect(GENERIC_SETTINGS.navigation.teacherMenus).toEqual([]);
  });
  it("항목 표의 주소는 겹치지 않는다(판정 단위가 주소다)", () => {
    const all = TEACHER_MENU_LINKS.map((l) => l.href);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("옛 화면이 강사뷰 칸 없이 저장해도 정해 둔 구성이 안 지워진다", () => {
  const stored = { menus: [], teacherMenus: [{ href: "/ecs", hidden: true }] };
  it("요청에 칸이 없으면 저장돼 있던 값", () => {
    const out = prepareSectionForSave("chinsan", "navigation", { menus: [] }, { menus: [], teacherMenus: [] }, stored) as Record<string, unknown>;
    expect(out.teacherMenus).toEqual(stored.teacherMenus);
  });
  it("요청에 칸이 있으면 요청 값(비우기도 존중)", () => {
    const raw = { menus: [], teacherMenus: [] };
    expect((prepareSectionForSave("generic", "navigation", raw, raw, stored) as Record<string, unknown>).teacherMenus).toEqual([]);
  });
  it("저장돼 있던 값도 없으면 칸을 비운다(읽을 때 기본값 [])", () => {
    const out = prepareSectionForSave("chinsan", "navigation", { menus: [] }, { menus: [], teacherMenus: [] }, { menus: [] }) as Record<string, unknown>;
    expect("teacherMenus" in out).toBe(false);
  });
});

describe("감사로그 변경 목록(settings-diff)", () => {
  const diff = (before: unknown, after: unknown) => diffSettingsSection("navigation", before, after);

  it("옛 행(키 없음)에 관리자뷰만 고쳐 저장 — 빈 강사뷰 목록이 처음 실리는 것은 변경이 아니다", () => {
    const out = diff({ menus: [] }, { menus: [{ href: "/students", hidden: true }], teacherMenus: [] });
    expect(out.changes.map((c) => c.label)).toEqual(["관리자뷰 메뉴 표시·순서"]);
    expect(out.others).toBe(0);
  });

  it("강사뷰를 처음 정하면 '0개 → N개'로 적힌다", () => {
    const out = diff({ menus: [] }, { menus: [], teacherMenus: [{ href: "/ecs", hidden: true }, { href: "/mcs", hidden: true }] });
    expect(out.changes.map(formatSettingChange)).toEqual(["강사뷰 메뉴 표시·순서 0개 → 2개"]);
  });

  it("같은 목록이면 변경 0건", () => {
    const rows = [{ href: "/ecs", hidden: true }];
    expect(diff({ menus: [], teacherMenus: rows }, { menus: [], teacherMenus: rows })).toEqual({ changes: [], others: 0 });
  });
});
