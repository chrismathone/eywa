import { describe, expect, it } from "vitest";
import {
  applyUserOverrides,
  canWrite,
  canAccess,
  CONNECTED_APP_MENU_KEYS,
  isConnectedAppMenu,
  isPermissionLocked,
  MENU_ACCESS,
  MENU_KEYS,
  menuKeyForPath,
  mergeMostPermissive,
  openOwnGrantsInTeacherView,
  resolveMatrix,
  SYSTEM_ROLES,
  roleHome,
  type MenuKey,
  type UserPermissionOverride,
} from "./permissions";

describe("기본 대시보드 착지", () => {
  it("사무실 계정은 대시보드, 강사와 학생은 기존 전용 홈을 사용한다", () => {
    expect(roleHome("master")).toBe("/dashboard");
    expect(roleHome("admin")).toBe("/dashboard");
    expect(roleHome("teacher")).toBe("/onescreen");
    expect(roleHome("student")).toBe("/my-learning");
  });
  it("대시보드 권한을 제거한 계정은 순환 리다이렉트 없이 안내 화면으로 간다", () => {
    const matrix = { ...MENU_ACCESS, dashboard: { ...MENU_ACCESS.dashboard, admin: "none" as const } };
    expect(roleHome("admin", matrix)).toBe("/menu");
    expect(canAccess("admin", "dashboard", matrix)).toBe(false);
  });
});

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
  it("영어이름 개인 권한은 해당 강사의 이름 편집만 열고 원생목록 전체 관리를 부여하지 않는다", () => {
    const matrix = applyUserOverrides(MENU_ACCESS, "teacher-one", "teacher", [
      { userId: "teacher-one", menu: "student_english_name", access: "full" },
    ]);
    expect(matrix.student_english_name.teacher).toBe("full");
    expect(matrix.students.teacher).toBe("scoped");
    for (const menu of MENU_KEYS.filter((key) => key !== "student_english_name")) {
      expect(matrix[menu]).toEqual(MENU_ACCESS[menu]);
    }
    const other = applyUserOverrides(MENU_ACCESS, "teacher-two", "teacher", [
      { userId: "teacher-one", menu: "student_english_name", access: "full" },
    ]);
    expect(other.student_english_name.teacher).toBe("none");
  });
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

// 2026-08-13 회귀: super_admin이 되자 수업 평가·학원 설정이 사이드바에서 사라졌다.
// 원인은 super_admin 우회가 override를 통째로 버린 것 — "잠금 무시"와 "부여 폐기"를 구분하지 않았다.
describe("mergeMostPermissive — super_admin은 잠금만 무시하고 부여는 보존", () => {
  it("원장이 연 셀이 보존된다 (예전 구현이 버렸던 쪽)", () => {
    // 실제 사고 재현: class_review는 코드 기본값이 전 역할 none이고 개방은 override로만 한다.
    expect(MENU_ACCESS.class_review.master).toBe("none");
    const granted = resolveMatrix([{ menu: "class_review", role: "master", access: "full" }]);
    expect(mergeMostPermissive(MENU_ACCESS, granted).class_review.master).toBe("full");
    // 학원 설정도 같은 모양(admin 기본 none + override full)이라 함께 사라졌다.
    const ownerGrant = resolveMatrix([{ menu: "owner", role: "admin", access: "full" }]);
    expect(mergeMostPermissive(MENU_ACCESS, ownerGrant).owner.admin).toBe("full");
  });

  it("원장이 닫은 셀은 무시된다 (락아웃 방지 — 기존 성질 유지)", () => {
    const locked = resolveMatrix([
      { menu: "staff", role: "admin", access: "none" },
      { menu: "retention", role: "admin", access: "none" },
    ]);
    expect(locked.staff.admin).toBe("none"); // 일반 admin은 잠긴다
    const merged = mergeMostPermissive(MENU_ACCESS, locked);
    expect(merged.staff.admin).toBe(MENU_ACCESS.staff.admin); // super_admin은 기본값 유지
    expect(merged.retention.admin).toBe(MENU_ACCESS.retention.admin);
  });

  it("개인 예외의 부여도 보존된다 (수업 평가 실종의 나머지 절반)", () => {
    const plain = resolveMatrix([]);
    const applied = applyUserOverrides(plain, "u-lsy", "admin", [
      { userId: "u-lsy", menu: "class_review", access: "full" },
    ]);
    expect(mergeMostPermissive(plain, applied).class_review.admin).toBe("full");
  });

  it("병합은 항상 올라가는 방향 — 어떤 셀도 낮아지지 않는다", () => {
    const arbitrary = resolveMatrix([
      { menu: "timetable", role: "viewer", access: "none" },
      { menu: "students", role: "counselor", access: "readonly" },
    ]);
    const merged = mergeMostPermissive(MENU_ACCESS, arbitrary);
    const rank = { none: 0, readonly: 1, scoped: 2, full: 3 } as const;
    for (const menu of MENU_KEYS) {
      for (const role of SYSTEM_ROLES) {
        expect(rank[merged[menu][role]]).toBeGreaterThanOrEqual(rank[MENU_ACCESS[menu][role]]);
      }
    }
  });
});

describe("새 권한의 기본값 = 원장 '전체' · 나머지 '없음'(원장 2026-10-06)", () => {
  // 이 규칙 전에 정해진 권한 — 기본값이 그 모양이 아니다(바꾸면 쓰고 있는 학원의 접근이 바뀐다).
  // 🔴 여기에 새 키를 더하지 말 것. 새 권한은 원장만 '전체'로 시작하고, 다른 역할에게는 원장이 역할·권한 면에서 연다.
  const BEFORE_RULE: readonly string[] = [
    "dashboard", "timetable", "attendance", "makeups", "seat_attendance", "classes", "students", "exams", "enrollment",
    "consultations", "withdrawals", "retention", "newcomers", "ecs", "mcs", "lesson_reports", "attendance_salary_settings",
    "staff", "billing", "textbook_requests", "expense_requests", "meetings", "documents", "class_review", "approvals",
    "calendar", "shuttle", "inventory", "textbooks", "integrations", "sheet_sync", "help", "support", "teacher_onescreen", "my_learning",
  ];
  const expected = Object.fromEntries(SYSTEM_ROLES.map((role) => [role, role === "master" ? "full" : "none"]));
  // 규칙 **뒤에** 그 기능의 결정 문서가 기본값을 따로 정한 권한 — 근거를 적고 **정해진 값 그대로** 고정한다(더 넓어지면 실패).
  // 🔴 근거 문서 없이 더하지 말 것. 위 BEFORE_RULE과 섞지 않는다(규칙 전에 정해진 것이 아니다).
  const DECIDED_AFTER_RULE: Readonly<Record<string, { why: string; access: Record<string, string> }>> = {
    // 2026-10-22 추가: docs/decisions/withdrawal-reports.md(2026-10-13 사용자 요청) "기본 역할 권한은 관리자·원장 전체, 강사 본인 배정 건".
    // 매니저 '전체'는 같은 커밋(6a76be7a3)의 요청 자격 canRequestReport(원장·관리자·매니저)와 짝이다. 실험실 메뉴라 실험실을 켠 지점만 열린다.
    withdrawal_reports: {
      why: "퇴원보고서 결정 문서 2026-10-13 — 관리자 요청 → 담임 작성 → 관리자 승인 흐름이 기본값으로 돈다",
      access: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
    },
    // 2026-11-05 추가: docs/decisions/tenant.md 연결 앱 — 원장 "지금 하나 있는 '오늘 수학'은 강사 이상에게 열림"
    // (권한을 만들기 전엔 모든 직원에게 보였다 — 강사 이상 = 표의 강사 왼쪽 칸 · 오늘 수학 쪽 로그인 자격과 같은 네 역할만 남겼다).
    app_todays_math: {
      why: "연결 앱 결정(tenant.md 2026-11-05) — 오늘 수학은 강사 이상(원장·관리자·매니저·강사)에게 열린 채 시작한다",
      access: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
    },
  };
  // 새 연결 앱은 원장도 '없음'으로 시작한다(원장 2026-11-05 *"새 연동앱은 전부 꺼짐으로 기본값"*) — 켜는 것은 '연결 앱 권한' 표에서.
  const allNone = Object.fromEntries(SYSTEM_ROLES.map((role) => [role, "none"]));

  it("🔴 목록 밖의 권한은 원장만 '전체'로 시작한다 — 새 권한을 다른 역할에게 코드 기본값으로 열어 두지 않는다", () => {
    for (const menu of MENU_KEYS) {
      if (BEFORE_RULE.includes(menu)) continue;
      expect(MENU_ACCESS[menu], menu).toEqual(DECIDED_AFTER_RULE[menu]?.access ?? (isConnectedAppMenu(menu) ? allNone : expected));
    }
  });

  it("🔴 연결 앱 권한은 전체·없음만 — 담당·읽기는 잠그고, 연결 앱 키는 permissions.ts 목록과 MENU_KEYS가 같은 것을 가리킨다", () => {
    for (const menu of CONNECTED_APP_MENU_KEYS) {
      expect(MENU_KEYS as readonly string[], menu).toContain(menu);
      for (const role of SYSTEM_ROLES) {
        expect(isPermissionLocked(menu, role, "scoped"), `${menu}·${role}`).toBe(true);
        expect(isPermissionLocked(menu, role, "readonly"), `${menu}·${role}`).toBe(true);
      }
      // 강사 칸은 전체 ↔ 없음으로 돈다(학생 칸은 역할 전체가 잠겨 있다).
      expect(isPermissionLocked(menu, "teacher", "none")).toBe(false);
      expect(isPermissionLocked(menu, "teacher", "full")).toBe(false);
    }
  });

  it("목록은 지금 있는 권한만 가리키고, 규칙대로인 권한은 들지 않는다(목록이 면제 자리로 자라지 않게)", () => {
    for (const menu of BEFORE_RULE) {
      expect(MENU_KEYS as readonly string[], menu).toContain(menu);
      expect(MENU_ACCESS[menu as MenuKey], menu).not.toEqual(expected);
    }
    expect(new Set(BEFORE_RULE).size).toBe(BEFORE_RULE.length);
    for (const [menu, { why, access }] of Object.entries(DECIDED_AFTER_RULE)) {
      expect(MENU_KEYS as readonly string[], menu).toContain(menu);
      expect(BEFORE_RULE, menu).not.toContain(menu);
      expect(access, menu).not.toEqual(expected);
      expect(why.trim().length, `${menu} 근거`).toBeGreaterThan(0);
    }
  });
});

describe("openOwnGrantsInTeacherView — 겸직 본인 강사뷰도 개인 메뉴 권한을 따른다(원장 2026-10-30)", () => {
  const grants: UserPermissionOverride[] = [{ userId: "admin-1", menu: "before_class_checklist", access: "full" }];
  const actor = applyUserOverrides(MENU_ACCESS, "admin-1", "admin", grants);

  it("관리자에게 준 개인 권한이 강사 행에도 열린다 — 다른 메뉴·다른 역할 줄은 그대로", () => {
    const m = openOwnGrantsInTeacherView(actor, "admin-1", "admin", grants);
    expect(m.before_class_checklist.teacher).toBe("full");
    expect(m.before_class_checklist.manager).toBe("none");
    for (const menu of MENU_KEYS.filter((k) => k !== "before_class_checklist")) expect(m[menu]).toEqual(actor[menu]);
  });

  it("다른 사람의 개인 권한·실 강사·이미 넓은 강사 행은 건드리지 않는다(올리기만)", () => {
    expect(openOwnGrantsInTeacherView(actor, "admin-2", "admin", grants)).toBe(actor);
    expect(openOwnGrantsInTeacherView(MENU_ACCESS, "t-1", "teacher", [{ userId: "t-1", menu: "before_class_checklist", access: "full" }])).toBe(MENU_ACCESS);
    const lock: UserPermissionOverride[] = [{ userId: "admin-1", menu: "students", access: "none" }];
    const narrow = openOwnGrantsInTeacherView(applyUserOverrides(MENU_ACCESS, "admin-1", "admin", lock), "admin-1", "admin", lock);
    expect(narrow.students.teacher).toBe(MENU_ACCESS.students.teacher);
  });

  it("강사 '내 메뉴'에 없는 관리자 화면(직원관리)은 개인 예외가 있어도 강사 행을 열지 않는다", () => {
    const staff: UserPermissionOverride[] = [{ userId: "admin-1", menu: "staff", access: "full" }];
    const m = openOwnGrantsInTeacherView(applyUserOverrides(MENU_ACCESS, "admin-1", "manager", staff), "admin-1", "manager", staff);
    expect(m.staff.teacher).toBe(MENU_ACCESS.staff.teacher);
  });

  it("값은 실제 역할 칸 그대로 — 읽기로 준 권한은 강사뷰에서도 읽기", () => {
    const ro: UserPermissionOverride[] = [{ userId: "admin-1", menu: "before_class_checklist", access: "readonly" }];
    const m = openOwnGrantsInTeacherView(applyUserOverrides(MENU_ACCESS, "admin-1", "admin", ro), "admin-1", "admin", ro);
    expect(m.before_class_checklist.teacher).toBe("readonly");
  });
});
