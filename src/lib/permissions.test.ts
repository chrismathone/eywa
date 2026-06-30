import { describe, expect, it } from "vitest";
import { canWrite, canAccess, MENU_ACCESS } from "./permissions";

describe("canWrite — 쓰기 게이트(full|scoped만 통과, readonly/none 차단)", () => {
  it("full/scoped는 통과", () => {
    expect(canWrite("master", "billing")).toBe(true); // full
    expect(canWrite("accountant", "billing")).toBe(true); // full
    expect(canWrite("teacher", "attendance")).toBe(true); // scoped
    expect(canWrite("teacher", "retention")).toBe(true); // scoped
    expect(canWrite("teacher", "consultations")).toBe(true); // scoped
  });

  it("readonly/none은 차단 — canAccess와 달리 readonly를 막는다(누수 방지)", () => {
    // billing: manager=readonly → 읽기는 통과하나 쓰기는 차단
    expect(canAccess("manager", "billing")).toBe(true);
    expect(canWrite("manager", "billing")).toBe(false);
    // meetings: viewer=readonly → 회의록 쓰기 차단
    expect(canAccess("viewer", "meetings")).toBe(true);
    expect(canWrite("viewer", "meetings")).toBe(false);
    // students: accountant=readonly → care AI/메모 쓰기 차단
    expect(canWrite("accountant", "students")).toBe(false);
    expect(canWrite("viewer", "students")).toBe(false);
    // none
    expect(canWrite("student", "billing")).toBe(false);
    expect(canWrite("teacher", "enrollment")).toBe(false); // teacher enrollment=none
  });

  it("MENU_ACCESS의 모든 셀에서 canWrite ⟺ (full|scoped)", () => {
    for (const menu of Object.keys(MENU_ACCESS) as (keyof typeof MENU_ACCESS)[]) {
      for (const role of Object.keys(MENU_ACCESS[menu]) as (keyof (typeof MENU_ACCESS)[typeof menu])[]) {
        const lvl = MENU_ACCESS[menu][role];
        expect(canWrite(role, menu)).toBe(lvl === "full" || lvl === "scoped");
      }
    }
  });
});
