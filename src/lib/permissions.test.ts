import { describe, expect, it } from "vitest";
import { canWrite, canAccess, MENU_ACCESS, menuKeyForPath } from "./permissions";

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

describe("menuKeyForPath — 경로→MenuKey (뷰-경로 가드용)", () => {
  it("최상위 세그먼트로 매핑, 하위 경로/쿼리 무관", () => {
    expect(menuKeyForPath("/dashboard")).toBe("dashboard");
    expect(menuKeyForPath("/students/123")).toBe("students"); // 상세 페이지도 상위 메뉴로
    expect(menuKeyForPath("/onescreen")).toBe("teacher_onescreen"); // x-pathname=nextUrl.pathname(쿼리 없음)
    expect(menuKeyForPath("/lesson-reports")).toBe("lesson_reports"); // 하이픈→언더스코어
    expect(menuKeyForPath("/expense-requests")).toBe("expense_requests");
    expect(menuKeyForPath("/my-learning")).toBe("my_learning");
    expect(menuKeyForPath("/kiosk-settings")).toBe("kiosk_settings");
  });

  it("모르는/비메뉴 경로는 null (fail-open — 페이지 requireAccess가 판정)", () => {
    expect(menuKeyForPath("/")).toBeNull();
    expect(menuKeyForPath("")).toBeNull();
    expect(menuKeyForPath("/nonexistent")).toBeNull();
    expect(menuKeyForPath("/integrations")).toBeNull(); // 액션 권한 키(라우트 아님)
  });

  it("가드 시나리오: 강사 뷰에서 관리자 전용 경로는 canAccess(teacher)=false로 걸린다", () => {
    // 겸직이 강사뷰에서 뒤로가기로 이 경로들에 오면 /onescreen으로 되돌려야 함
    for (const p of ["/dashboard", "/owner", "/billing", "/meetings", "/staff", "/withdrawals"]) {
      const menu = menuKeyForPath(p)!;
      expect(canAccess("teacher", menu)).toBe(false);
    }
    // 강사 접근 가능 경로는 통과(가드가 되돌리지 않음)
    for (const p of ["/onescreen", "/students", "/attendance", "/classes", "/timetable", "/exams", "/consultations"]) {
      const menu = menuKeyForPath(p)!;
      expect(canAccess("teacher", menu)).toBe(true);
    }
  });
});
