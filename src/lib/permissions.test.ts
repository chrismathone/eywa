import { describe, expect, it } from "vitest";
import {
  applyUserOverrides,
  canWrite,
  canAccess,
  MENU_ACCESS,
  menuKeyForPath,
  resolveMatrix,
  type UserPermissionOverride,
} from "./permissions";

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

describe("applyUserOverrides — 개인 예외(직원관리 4인 좁히기의 메커니즘, 2026-08-01)", () => {
  // 실제 시나리오: staff를 역할 override로 admin=none 잠근 뒤, 설현·이승엽에게만 개인 full.
  const base = resolveMatrix([
    { menu: "staff", role: "admin", access: "none" },
    { menu: "staff", role: "manager", access: "none" },
    { menu: "staff", role: "accountant", access: "none" },
  ]);
  const grants: UserPermissionOverride[] = [
    { userId: "u-sh", menu: "staff", access: "full" },
    { userId: "u-lsy", menu: "staff", access: "full" },
  ];

  it("허용된 사용자는 자기 역할 행이 열린다", () => {
    const m = applyUserOverrides(base, "u-sh", "admin", grants);
    expect(m.staff.admin).toBe("full");
    expect(canWrite("admin", "staff", m)).toBe(true);
  });

  it("허용 목록 밖 사용자는 그대로 잠긴다(같은 admin이어도)", () => {
    const m = applyUserOverrides(base, "u-other", "admin", grants);
    expect(m.staff.admin).toBe("none");
    expect(canAccess("admin", "staff", m)).toBe(false);
  });

  it("자기 역할 행만 패치 — 다른 역할·다른 메뉴 행은 불변(강사뷰 가드 등 보호)", () => {
    const m = applyUserOverrides(base, "u-sh", "admin", grants);
    expect(m.staff.manager).toBe("none");
    expect(m.staff.master).toBe("full");
    expect(m.billing).toEqual(base.billing);
  });

  it("입력 매트릭스를 변형하지 않는다(요청 캐시 오염 방지) + 예외 없으면 같은 참조", () => {
    const before = base.staff.admin;
    applyUserOverrides(base, "u-sh", "admin", grants);
    expect(base.staff.admin).toBe(before);
    expect(applyUserOverrides(base, "u-none", "admin", grants)).toBe(base);
    expect(applyUserOverrides(base, "u-sh", "admin", [])).toBe(base);
  });

  it("잠긴 셀은 개인 예외로도 못 연다(역할 전용 화면·student 컬럼)", () => {
    const evil: UserPermissionOverride[] = [
      { userId: "u-x", menu: "teacher_onescreen", access: "full" },
      { userId: "u-x", menu: "my_learning", access: "full" },
      { userId: "u-x", menu: "dashboard", access: "full" },
    ];
    // 관리자에게 원스크린/내 학습을 열려는 시도 → 무시
    const m1 = applyUserOverrides(base, "u-x", "admin", evil);
    expect(m1.teacher_onescreen.admin).toBe("none");
    expect(m1.my_learning.admin).toBe("none");
    // 학생 컬럼 전체 잠금 → 학생에게 일반 메뉴 부여 시도는 무시
    const m2 = applyUserOverrides(base, "u-x", "student", [
      { userId: "u-x", menu: "billing", access: "full" },
    ]);
    expect(m2.billing.student).toBe("none");
    // 강사 대시보드 잠금도 유지
    const m3 = applyUserOverrides(base, "u-x", "teacher", evil);
    expect(m3.dashboard.teacher).toBe("none");
  });

  it("개인 예외가 역할 override를 이긴다(내리는 방향도 동작)", () => {
    const narrowed = applyUserOverrides(base, "u-view", "viewer", [
      { userId: "u-view", menu: "timetable", access: "none" },
    ]);
    expect(narrowed.timetable.viewer).toBe("none"); // 기본 readonly → 개인 none
  });
});
