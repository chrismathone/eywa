import { describe, expect, it } from "vitest";
import { canAccess, accessLevel, resolveMatrix, MENU_ACCESS } from "@/lib/permissions";

describe("permissions matrix", () => {
  it("master can access every menu", () => {
    const menus = [
      "dashboard",
      "timetable",
      "attendance",
      "classes",
      "students",
      "enrollment",
      "consultations",
      "withdrawals",
      "staff",
      "billing",
      "meetings",
      "help",
    ] as const;

    for (const menu of menus) {
      expect(canAccess("master", menu)).toBe(true);
      expect(accessLevel("master", menu)).toBe("full");
    }
  });

  it("teacher cannot access enrollment or billing", () => {
    expect(canAccess("teacher", "enrollment")).toBe(false);
    expect(canAccess("teacher", "billing")).toBe(false);
  });

  it("accountant has full billing access but no enrollment", () => {
    expect(accessLevel("accountant", "billing")).toBe("full");
    expect(canAccess("accountant", "enrollment")).toBe(false);
  });

  it("counselor leads enrollment pipeline", () => {
    expect(accessLevel("counselor", "enrollment")).toBe("full");
    expect(accessLevel("counselor", "consultations")).toBe("full");
  });
});

describe("resolveMatrix — 테넌트 권한 override (sparse)", () => {
  it("빈 override = 하드코딩 MENU_ACCESS", () => {
    const m = resolveMatrix([]);
    expect(m).toEqual(MENU_ACCESS);
    expect(canAccess("teacher", "enrollment", m)).toBe(false);
  });

  it("셀 단위 sparse override 적용 — 다른 셀은 기본값 유지", () => {
    const m = resolveMatrix([{ menu: "enrollment", role: "teacher", access: "full" }]);
    expect(canAccess("teacher", "enrollment", m)).toBe(true);
    expect(accessLevel("teacher", "enrollment", m)).toBe("full");
    expect(accessLevel("teacher", "billing", m)).toBe(MENU_ACCESS.billing.teacher);
  });

  it("readonly 다운그레이드가 accessLevel에 반영(쓰기 차단용)", () => {
    const m = resolveMatrix([{ menu: "exams", role: "manager", access: "readonly" }]);
    expect(accessLevel("manager", "exams", m)).toBe("readonly");
  });

  it("가드레일 무시 — master는 owner/admin/대시보드 자기잠금 불가", () => {
    const m = resolveMatrix([
      { menu: "owner", role: "master", access: "none" },
      { menu: "admin", role: "master", access: "none" },
      { menu: "dashboard", role: "master", access: "none" },
    ]);
    expect(canAccess("master", "owner", m)).toBe(true);
    expect(canAccess("master", "admin", m)).toBe(true);
    expect(canAccess("master", "dashboard", m)).toBe(true);
  });

  it("가드레일 무시 — 역할 전용 화면(원스크린/내 학습)은 override 무효", () => {
    const m = resolveMatrix([
      { menu: "my_learning", role: "teacher", access: "full" },
      { menu: "teacher_onescreen", role: "master", access: "full" },
    ]);
    expect(m.my_learning.teacher).toBe(MENU_ACCESS.my_learning.teacher);
    expect(m.teacher_onescreen.master).toBe(MENU_ACCESS.teacher_onescreen.master);
  });

  it("가드레일 무시 — student 컬럼은 일반 메뉴 부여 불가('내 학습' 전용)", () => {
    const m = resolveMatrix([
      { menu: "billing", role: "student", access: "full" },
      { menu: "dashboard", role: "student", access: "full" },
    ]);
    // student override는 전부 무시되어 코드 기본값(none) 유지 → 직접 URL 진입(requireAccess) 차단.
    expect(canAccess("student", "billing", m)).toBe(false);
    expect(m.billing.student).toBe(MENU_ACCESS.billing.student);
    expect(m.dashboard.student).toBe(MENU_ACCESS.dashboard.student);
  });

  it("MENU_ACCESS 원본을 변형하지 않음", () => {
    resolveMatrix([{ menu: "billing", role: "teacher", access: "full" }]);
    expect(MENU_ACCESS.billing.teacher).toBe("none");
  });
});
