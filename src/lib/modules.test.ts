/**
 * 기능 묶음(모듈) — 원장 2026-09-22 방향 B. 순수 규칙 + 침산 불변.
 *   ① 꺼진 게 없으면(침산) 권한 매트릭스·메뉴 목록이 **받은 그 객체 그대로** 돌아온다
 *   ② 꺼진 모듈의 메뉴는 전 역할 none — 다른 메뉴는 안 건드린다
 *   ③ 모듈이 가리키는 메뉴키는 실제 권한 표에 있는 키다(오타면 조용히 안 닫힌다)
 */
import { describe, expect, it } from "vitest";
import { MENU_ACCESS, type AccessMatrix } from "@/lib/permissions";
import {
  MODULES,
  MODULE_IDS,
  capDisabledModules,
  disabledMenuKeysOf,
  isModuleEnabled,
  menuLayoutWithModules,
  moduleOfMenuKey,
  normalizeDisabledModules,
} from "./modules";

const MATRIX = MENU_ACCESS as unknown as AccessMatrix;

describe("normalizeDisabledModules", () => {
  it("아는 id만, 중복 없이", () => {
    expect(normalizeDisabledModules(["shuttle", "nope", "shuttle", 3, null, "eie"])).toEqual(["shuttle", "eie"]);
  });
  it("배열이 아니면 빈 목록", () => {
    expect(normalizeDisabledModules(undefined)).toEqual([]);
    expect(normalizeDisabledModules("shuttle")).toEqual([]);
    expect(normalizeDisabledModules({})).toEqual([]);
  });
});

describe("capDisabledModules", () => {
  it("꺼진 게 없으면 같은 매트릭스(침산 = 복사도 안 한다)", () => {
    expect(capDisabledModules(MATRIX, [])).toBe(MATRIX);
    expect(capDisabledModules(MATRIX, undefined)).toBe(MATRIX);
  });

  it("꺼진 모듈의 메뉴는 전 역할 none, 다른 메뉴는 그대로", () => {
    const capped = capDisabledModules(MATRIX, ["shuttle", "inventory"]);
    for (const role of Object.keys(capped.shuttle)) {
      expect(capped.shuttle[role as keyof typeof capped.shuttle]).toBe("none");
      expect(capped.inventory[role as keyof typeof capped.inventory]).toBe("none");
    }
    expect(capped.students).toBe(MATRIX.students);
    expect(capped.timetable).toBe(MATRIX.timetable);
    // 받은 매트릭스를 변형하지 않는다
    expect(MATRIX.shuttle).not.toEqual(capped.shuttle);
  });

  it("메뉴 없는 모듈(ClassNote·EiE·회차 정산)은 권한을 안 건드린다", () => {
    const capped = capDisabledModules(MATRIX, ["classnote", "eie", "session_billing"]);
    expect(capped).toBe(MATRIX);
  });
});

describe("모듈 정의", () => {
  it("모듈이 가리키는 메뉴키는 권한 표에 있다", () => {
    for (const id of MODULE_IDS) {
      for (const k of MODULES[id].menuKeys) expect(Object.keys(MENU_ACCESS), `${id} → ${k}`).toContain(k);
    }
  });
  it("한 메뉴키는 한 모듈에만 속한다", () => {
    const seen = new Map<string, string>();
    for (const id of MODULE_IDS) {
      for (const k of MODULES[id].menuKeys) {
        expect(seen.get(k), `${k}가 ${seen.get(k)}·${id} 둘에 속함`).toBeUndefined();
        seen.set(k, id);
      }
    }
  });
  it("moduleOfMenuKey · disabledMenuKeysOf · isModuleEnabled", () => {
    expect(moduleOfMenuKey("shuttle")).toBe("shuttle");
    expect(moduleOfMenuKey("students")).toBeNull();
    expect([...disabledMenuKeysOf(["kiosk"])]).toEqual(["kiosk_settings"]);
    expect(isModuleEnabled([], "shuttle")).toBe(true);
    expect(isModuleEnabled(["shuttle"], "shuttle")).toBe(false);
    expect(isModuleEnabled(undefined, "eie")).toBe(true);
  });
});

describe("menuLayoutWithModules", () => {
  const menus = [{ href: "/students", order: 1 }, { href: "/billing?tab=sessions", order: 3 }];

  it("꺼진 면이 없으면 받은 배열 그대로(침산 = 같은 참조)", () => {
    expect(menuLayoutWithModules(menus, [])).toBe(menus);
    expect(menuLayoutWithModules(menus, undefined)).toBe(menus);
    // 면이 없는 모듈이 꺼져도 그대로
    expect(menuLayoutWithModules(menus, ["shuttle"])).toBe(menus);
  });

  it("회차 정산이 꺼지면 세 면 입구를 숨김으로 얹는다(같은 주소의 기존 줄은 대체)", () => {
    const out = menuLayoutWithModules(menus, ["session_billing"]);
    expect(out).toEqual([
      { href: "/students", order: 1 },
      { href: "/billing?tab=sessions", hidden: true },
      { href: "/billing?tab=verify", hidden: true },
      { href: "/billing?tab=payroll", hidden: true },
    ]);
  });
});
