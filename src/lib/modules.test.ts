/**
 * 기능 묶음(모듈) — 원장 2026-09-22 방향 B. 순수 규칙 + 침산 불변.
 *   ① 꺼진 게 없으면(침산) 권한 매트릭스·메뉴 목록이 **받은 그 객체 그대로** 돌아온다
 *   ② 꺼진 모듈의 메뉴는 전 역할 none — 다른 메뉴는 안 건드린다
 *   ③ 모듈이 가리키는 메뉴키는 실제 권한 표에 있는 키다(오타면 조용히 안 닫힌다)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MENU_ACCESS, type AccessMatrix } from "@/lib/permissions";
import {
  MODULES,
  MODULE_BASELINE_V1,
  MODULE_IDS,
  capDisabledModules,
  disabledMenuKeysOf,
  isModuleEnabled,
  isModuleTurningOff,
  menuLayoutWithModules,
  moduleOfMenuKey,
  normalizeDisabledModules,
  normalizeKnownModuleIds,
  effectiveDisabledModulesFromStored,
  type ModuleId,
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

describe("모듈 저장 기준 목록", () => {
  it("v1 기준 20개는 글자와 순서를 고정한다", () => {
    expect(MODULE_BASELINE_V1).toEqual([
      "ecs", "mcs", "makeups", "seat_attendance", "textbooks", "shuttle", "inventory", "kiosk", "newcomers", "retention",
      "approvals", "class_review", "calendar", "classnote", "makeedu", "sheet_sync", "eie", "session_billing", "payroll", "staff_leaves",
    ]);
  });

  it("일반판 옛 저장 행과 섹션 없는 행은 나중에 추가된 모듈을 끄고, 침산은 그대로다", () => {
    const futureIds = [...MODULE_IDS, "future_module"];
    expect(effectiveDisabledModulesFromStored(
      { preset: "generic", modules: { disabled: ["shuttle"] } },
      futureIds,
    )).toEqual(["shuttle", "future_module"]);
    expect(effectiveDisabledModulesFromStored({ preset: "generic" }, futureIds)).toEqual(
      futureIds.filter((id) => id !== "makeups"),
    );
    expect(effectiveDisabledModulesFromStored({}, futureIds)).toEqual([]);
    expect(effectiveDisabledModulesFromStored(
      { modules: { disabled: ["shuttle"], known: [] } },
      futureIds,
    )).toEqual(["shuttle"]);
  });

  it("known 누락·변조가 보강을 실효 목록에만 끼워 넣지 못한다", () => {
    expect(effectiveDisabledModulesFromStored({ preset: "generic", modules: { disabled: [], known: ["bogus"] } }))
      .not.toContain("makeups");
    expect(effectiveDisabledModulesFromStored({ preset: "generic", modules: { disabled: [] } }))
      .not.toContain("makeups");
  });

  it("옛 폼이 모르는 새 모듈은 disabled에 없어도 저장 뒤 꺼짐을 유지한다", () => {
    const futureIds = [...MODULE_IDS, "future_module"];
    const oldFormKnown = normalizeKnownModuleIds(MODULE_BASELINE_V1, futureIds);
    const saved = {
      preset: "generic",
      modules: { disabled: [], known: oldFormKnown },
    };

    expect(oldFormKnown).not.toContain("future_module");
    expect(effectiveDisabledModulesFromStored(saved, futureIds)).toContain("future_module");
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
    expect(isModuleTurningOff([], ["eie"], "eie")).toBe(true);
    expect(isModuleTurningOff(["eie"], ["eie"], "eie")).toBe(false);
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

describe("모듈 이름 타입 — 선언 파일이 무시되면 string으로 무너져 오타가 '켜짐'으로 샌다(2026-11-12 검토)", () => {
  it("선언 파일(.d.mts)의 기준 목록 = 실제 목록", () => {
    const decl = readFileSync("src/lib/module-state.d.mts", "utf8");
    const block = decl.slice(decl.indexOf("MODULE_BASELINE_V1"), decl.indexOf("];"));
    expect([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual([...MODULE_BASELINE_V1]);
  });
  it("없는 모듈 이름은 타입 오류다(타입 검사가 이 줄을 잡는다)", () => {
    // @ts-expect-error — ModuleId가 리터럴 합집합이면 오류, string으로 무너지면 이 지시가 '쓰이지 않음'으로 실패한다.
    const typo: ModuleId = "classnot_typo";
    expect(typo).toBe("classnot_typo");
  });
});
