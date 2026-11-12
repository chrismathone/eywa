import { describe, expect, it } from "vitest";
import {
  applyUserOverrides,
  canWrite,
  canAccess,
  CONNECTED_APP_MENU_KEYS,
  isConnectedAppMenu,
  isOnOffMenu,
  isPermissionLocked,
  MENU_ACCESS,
  MENU_KEYS,
  menuKeyForPath,
  mergeMostPermissive,
  openOwnGrantsInTeacherView,
  resolveMatrix,
  SYSTEM_ROLES,
  roleHome,
  SHUTTLE_ADMIN_ROLES,
  isStaffRecordLocked,
  STAFF_RECORD_MENUS,
  STAFF_RECORD_ROLES,
  TEACHER_MENU_KEYS,
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
    // 2026-11-10 추가: docs/decisions/staff.md — 원장 11-10 결정 '기존 동작 유지'. 셔틀 관리자 화면(학부모 관리 현황 · 탑승 학생 시간표 · 가까운 노선 찾기 ·
    // 실시간 위치)은 권한 줄을 만들기 전 코드가 원장·관리자에게 열었다. 원장·관리자 칸만 바꿀 수 있다(학부모 계정 DB 정책 0320a와 같은 두 역할).
    // (시안 넷 — management · okr · marketing · work_records — 은 같은 날 원장 결정으로 규칙대로(원장만) 확정돼 여기서 뺐다.)
    shuttle_admin: {
      why: "원장 11-10 결정: 기존 동작 유지 — 셔틀 관리자 화면은 원장·관리자 '전체'(셔틀 권한 위 조건 · 학부모 계정 DB 정책 0320a와 같은 두 역할)",
      access: { master: "full", admin: "full", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
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

describe("학원 비서 권한(assistant · 원장 2026-11-09 *\"기본 디폴트로 원장하고 나머지 비활성화\"*)", () => {
  it("기본값 = 원장 '전체' · 나머지 '없음'(새 키 규칙 그대로 — 위 가드의 면제 목록에 없다)", () => {
    expect(MENU_ACCESS.assistant).toEqual(Object.fromEntries(SYSTEM_ROLES.map((role) => [role, role === "master" ? "full" : "none"])));
  });

  it("🔴 칸은 전체·없음만 — 비서는 지점 자료 전부를 읽어 '담당'·'읽기'로 좁힐 수 없다(좁은 값이 적혀도 실제는 '전체'로 열린다)", () => {
    expect(isOnOffMenu("assistant")).toBe(true);
    for (const role of SYSTEM_ROLES) {
      expect(isPermissionLocked("assistant", role, "scoped"), role).toBe(true);
      expect(isPermissionLocked("assistant", role, "readonly"), role).toBe(true);
    }
    // 손으로 넣은 '읽기'·'담당'은 적용하지 않는다(기본값 그대로 — 넓어지지 않는다).
    expect(resolveMatrix([{ menu: "assistant", role: "admin", access: "readonly" }, { menu: "assistant", role: "viewer", access: "scoped" }]).assistant).toEqual(MENU_ACCESS.assistant);
    expect(applyUserOverrides(MENU_ACCESS, "u-1", "manager", [{ userId: "u-1", menu: "assistant", access: "readonly" }]).assistant.manager).toBe("none");
  });

  it("🔴 강사 칸은 잠근다 — 강사 화면엔 비서 단추가 없다(열어도 쓸 곳이 없는 칸) · 원장 아닌 사무실 역할은 원장이 연다", () => {
    for (const access of ["full", "none"] as const) expect(isPermissionLocked("assistant", "teacher", access), access).toBe(true);
    expect(resolveMatrix([{ menu: "assistant", role: "teacher", access: "full" }]).assistant.teacher).toBe("none");
    expect(applyUserOverrides(MENU_ACCESS, "t-1", "teacher", [{ userId: "t-1", menu: "assistant", access: "full" }]).assistant.teacher).toBe("none");
    for (const role of ["admin", "manager", "counselor", "accountant", "viewer", "parttime"] as const) {
      expect(isPermissionLocked("assistant", role, "full"), role).toBe(false);
      expect(resolveMatrix([{ menu: "assistant", role, access: "full" }]).assistant[role], role).toBe("full");
    }
    // 원장이 스스로 끌 수도 있다(설정·대시보드처럼 잠근 칸이 아니다 — 학원 설정은 계속 열려 다시 켤 수 있다).
    expect(isPermissionLocked("assistant", "master", "none")).toBe(false);
  });

  it("연결 앱의 전체·없음 규칙은 그대로다(같은 함수로 묶었다)", () => {
    for (const menu of CONNECTED_APP_MENU_KEYS) expect(isOnOffMenu(menu), menu).toBe(true);
    expect(MENU_KEYS.filter((menu) => isOnOffMenu(menu)).sort()).toEqual([...CONNECTED_APP_MENU_KEYS, "assistant", "shuttle_admin", "withdrawals_churn"].sort());
  });
});

describe("2026-11-09에 들어온 화면 넷(경영 분석·지식그래프 · 조직·OKR · 홍보·마케팅 · 업무 작성센터) = 원장만(원장 2026-11-10 결정) · 셔틀 관리자 화면 = 원장·관리자(기존 동작 유지)", () => {
  const masterOnly = Object.fromEntries(SYSTEM_ROLES.map((role) => [role, role === "master" ? "full" : "none"]));
  it("🔴 넷은 새 권한 규칙 그대로 — 원장 '전체' · 나머지 '없음'(관리자·매니저·상담·회계·열람에게 코드 기본값으로 안 열린다 · 지점이 여는 것은 역할·권한 면에서)", () => {
    for (const menu of ["management", "okr", "marketing", "work_records"] as const) {
      expect(MENU_ACCESS[menu], menu).toEqual(masterOnly);
      for (const role of ["admin", "manager", "counselor", "accountant", "viewer"] as const) expect(canAccess(role, menu), `${menu}·${role}`).toBe(false);
    }
  });

  it("셔틀 관리자 화면 = 원장·관리자 '전체' · 칸은 전체·없음만 · 원장·관리자 칸만 바꿀 수 있다(학부모 계정 DB 정책과 같은 두 역할)", () => {
    expect(MENU_ACCESS.shuttle_admin.master).toBe("full");
    expect(MENU_ACCESS.shuttle_admin.admin).toBe("full");
    expect(SHUTTLE_ADMIN_ROLES).toEqual(["master", "admin"]);
    for (const role of SYSTEM_ROLES) {
      expect(isPermissionLocked("shuttle_admin", role, "scoped"), role).toBe(true);
      expect(isPermissionLocked("shuttle_admin", role, "readonly"), role).toBe(true);
      const changeable = role === "master" || role === "admin";
      expect(isPermissionLocked("shuttle_admin", role, "full"), role).toBe(!changeable);
      if (!changeable) expect(MENU_ACCESS.shuttle_admin[role], role).toBe("none");
    }
    // 손으로 넣은 매니저 '전체'는 적용하지 않는다(DB 정책이 학부모 계정을 안 보여 줘 화면만 열리는 일이 없게).
    expect(resolveMatrix([{ menu: "shuttle_admin", role: "manager", access: "full" }]).shuttle_admin.manager).toBe("none");
    // 관리자 칸은 원장이 닫을 수 있다.
    expect(resolveMatrix([{ menu: "shuttle_admin", role: "admin", access: "none" }]).shuttle_admin.admin).toBe("none");
  });
});

/**
 * 조직·OKR · 업무 작성센터 — 열람·아르바이트 칸 잠금(2026-11-11 · Claude·Codex 합의안 · 원장 위임).
 * 서버(organization-okr/server.ts · work-records/server.ts · academy-knowledge/server-records.ts)는 직원 역할 여섯만 받는다 — 그 밖의 칸을 열면
 * 메뉴는 서는데 화면이 "불러오지 못했습니다"로 멈춘다(저장만 되는 칸). 서버 목록과의 일치는 permission-rows.test.ts가 소스로 잠근다.
 */
describe("조직·OKR · 업무 작성센터 — 직원 역할 여섯만(열람·아르바이트·학생 칸 잠금 · 2026-11-11)", () => {
  const OUTSIDE = SYSTEM_ROLES.filter((role) => !(STAFF_RECORD_ROLES as readonly string[]).includes(role));

  it("잠그는 것은 두 메뉴의 열람·아르바이트·학생 칸뿐이다", () => {
    expect([...STAFF_RECORD_MENUS]).toEqual(["okr", "work_records"]);
    expect([...STAFF_RECORD_ROLES]).toEqual(["master", "admin", "manager", "teacher", "counselor", "accountant"]);
    expect(OUTSIDE).toEqual(["viewer", "parttime", "student"]);
    for (const menu of MENU_KEYS) for (const role of SYSTEM_ROLES) {
      expect(isStaffRecordLocked(menu, role), `${menu}·${role}`).toBe((STAFF_RECORD_MENUS as readonly string[]).includes(menu) && OUTSIDE.includes(role));
    }
  });

  it("🔴 잠긴 칸은 어느 값으로도 못 연다 — 손으로 넣은 역할 칸 · 개인 줄 모두 적용하지 않는다(넓어지지 않는다)", () => {
    for (const menu of STAFF_RECORD_MENUS) for (const role of OUTSIDE) {
      for (const access of ["full", "scoped", "readonly", "none"] as const) expect(isPermissionLocked(menu, role, access), `${menu}·${role}·${access}`).toBe(true);
      expect(MENU_ACCESS[menu][role], `${menu}·${role}`).toBe("none");
      for (const access of ["full", "readonly"] as const) {
        expect(resolveMatrix([{ menu, role, access }])[menu][role], `${menu}·${role}·${access}`).toBe("none");
        expect(applyUserOverrides(MENU_ACCESS, "u-1", role, [{ userId: "u-1", menu, access }])[menu][role], `${menu}·${role}·${access}`).toBe("none");
      }
    }
  });

  it("직원 역할 여섯의 칸은 원장이 연다 — 침산이 여는 값(관리자·매니저 '전체')과 강사·상담의 '담당'이 그대로 적용된다", () => {
    const opened = resolveMatrix([
      ...STAFF_RECORD_MENUS.flatMap((menu) => (["admin", "manager"] as const).map((role) => ({ menu, role, access: "full" as const }))),
      { menu: "okr", role: "teacher", access: "scoped" }, { menu: "work_records", role: "counselor", access: "scoped" }, { menu: "work_records", role: "accountant", access: "readonly" },
    ]);
    for (const menu of STAFF_RECORD_MENUS) {
      expect(opened[menu].master, menu).toBe("full");
      expect(opened[menu].admin, menu).toBe("full");
      expect(opened[menu].manager, menu).toBe("full");
      for (const role of OUTSIDE) expect(opened[menu][role], `${menu}·${role}`).toBe("none");
    }
    expect(opened.okr.teacher).toBe("scoped");
    expect(opened.work_records.counselor).toBe("scoped");
    expect(opened.work_records.accountant).toBe("readonly");
    // 원장이 자기 칸을 닫을 수도 있다(잠근 칸이 아니다).
    for (const menu of STAFF_RECORD_MENUS) expect(isPermissionLocked(menu, "master", "none"), menu).toBe(false);
  });

  it("🔴 이미 저장된 설정을 막지 않는다 — 잠긴 칸이 섞여 있어도 던지지 않고, 다른 칸은 그대로 적용된다", () => {
    const stored = [
      { menu: "okr", role: "viewer", access: "readonly" }, { menu: "work_records", role: "parttime", access: "full" },
      { menu: "okr", role: "admin", access: "full" }, { menu: "newcomers", role: "teacher", access: "scoped" }, { menu: "documents", role: "teacher", access: "none" },
    ] as const;
    const matrix = resolveMatrix(stored);
    expect(matrix.okr.viewer).toBe("none");
    expect(matrix.work_records.parttime).toBe("none");
    expect(matrix.okr.admin).toBe("full");
    expect(matrix.newcomers.teacher).toBe("scoped");
    expect(matrix.documents.teacher).toBe("none");
    // 그 밖의 메뉴의 열람·아르바이트 칸은 종전대로 열린다.
    expect(resolveMatrix([{ menu: "documents", role: "parttime", access: "readonly" }]).documents.parttime).toBe("readonly");
  });
});

describe("강사 '내 메뉴' 키 — 신규생 관리 · 업무 작성센터 · 조직·OKR(2026-11-11 입구)", () => {
  it("입구만 둔다 — 세 권한의 코드 기본값은 바꾸지 않았다(강사 '없음' · 새 권한 규칙 그대로)", () => {
    for (const menu of ["newcomers", "work_records", "okr"] as const) {
      expect(TEACHER_MENU_KEYS as readonly string[], menu).toContain(menu);
      expect(MENU_ACCESS[menu].teacher, menu).toBe("none");
    }
    expect(MENU_ACCESS.newcomers).toEqual({ master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "none", viewer: "readonly", parttime: "none", student: "none" });
  });

  it("겸직의 본인 강사뷰 — 개인별로 받은 세 메뉴가 강사 행에도 열린다(강사 메뉴 키라서 · 올리기만)", () => {
    const grants: UserPermissionOverride[] = [{ userId: "manager-1", menu: "okr", access: "scoped" }, { userId: "manager-1", menu: "work_records", access: "full" }];
    const actor = applyUserOverrides(MENU_ACCESS, "manager-1", "manager", grants);
    const m = openOwnGrantsInTeacherView(actor, "manager-1", "manager", grants);
    expect(m.okr.teacher).toBe("scoped");
    expect(m.work_records.teacher).toBe("full");
    expect(m.newcomers.teacher).toBe("none"); // 개인 줄이 없는 메뉴는 그대로
    expect(openOwnGrantsInTeacherView(actor, "manager-2", "manager", grants)).toBe(actor);
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
