// 역할×메뉴 접근 매트릭스. 하드코딩 MENU_ACCESS가 "기본값"이고, 테넌트는 owner 설정의
// permissions 섹션(jsonb sparse override)으로 셀 단위로 덮어쓴다(resolveMatrix). canAccess/
// accessLevel은 optional 3번째 인자 matrix를 받아 — 생략 시 하드코딩 default(기존 콜사이트 불변).
// MenuKey/SystemRole은 튜플에서 추론(단일 소스 → Zod z.enum과 공유).

export const SYSTEM_ROLES = [
  "master",
  "admin",
  "manager",
  "teacher",
  "counselor",
  "accountant",
  "viewer",
  "student",
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const MENU_KEYS = [
  "dashboard",
  "timetable",
  "attendance",
  "classes",
  "students",
  "exams",
  "enrollment",
  "consultations",
  "withdrawals",
  "retention",
  "staff",
  "billing",
  "textbook_requests",
  "meetings",
  "help",
  "admin",
  "owner",
  "teacher_onescreen",
  "my_learning",
  "kiosk_settings",
] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export type Access = "full" | "scoped" | "readonly" | "none";
export type AccessMatrix = Record<MenuKey, Record<SystemRole, Access>>;

export const MENU_ACCESS: AccessMatrix = {
  dashboard: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "scoped", accountant: "scoped", viewer: "readonly", student: "none" },
  timetable: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "readonly", accountant: "readonly", viewer: "readonly", student: "none" },
  attendance: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "readonly", viewer: "readonly", student: "none" },
  classes: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "readonly", student: "none" },
  students: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "readonly", viewer: "readonly", student: "none" },
  // 성적관리 — 시험 등록 + 반 일괄 성적입력. 강사는 담당 반 채점(scoped), 회계는 무관, 학생 미표시.
  exams: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "none", viewer: "readonly", student: "none" },
  enrollment: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "none", viewer: "none", student: "none" },
  consultations: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "none", viewer: "readonly", student: "none" },
  withdrawals: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "full", accountant: "full", viewer: "readonly", student: "none" },
  // 이탈 방어(리텐션) — 위험도 기반 재등록 방어. 강사는 담당 학생만(scoped), 회계는 매출 위험 열람.
  retention: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "readonly", viewer: "readonly", student: "none" },
  staff: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  billing: { master: "full", admin: "full", manager: "readonly", teacher: "none", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  // 교재 요청 — 강사가 본인 담당 학생 교재를 요청(스코프)하는 전용 면. 사무실(master/admin/accountant)은 /billing 교재 면에서 처리하되 여기서도 열람 가능.
  textbook_requests: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  meetings: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "full", accountant: "full", viewer: "readonly", student: "none" },
  help: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "full", accountant: "full", viewer: "full", student: "none" },
  // master 전용 — 중복 병합 / 데이터 정리 / Google Sheets 통합 등 위험도 높은 도구
  admin: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" },
  // owner(=원장/테넌트 소유자) 전용 — 학원 설정 콘솔(과목·교시·직급·청구 기본값·약관 등 테넌트 전체 적용)
  owner: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" },
  // 강사 전용 — 수업 마감 원스크린(진도·테스트·보고서). 원장(master) 사이드바엔 미표시.
  // (오버사이트가 필요하면 master를 "full"로만 바꾸면 됨.)
  teacher_onescreen: { master: "none", admin: "none", manager: "none", teacher: "full", counselor: "none", accountant: "none", viewer: "none", student: "none" },
  // 학생 전용 — 내 학습 현황(누적 대시보드) + 데일리 리포트. 직원(원장·강사 등)에겐 미표시.
  my_learning: { master: "none", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "full" },
  // master 전용 — 출석 키오스크 설정(출석번호 발급·기기 등록·발송 시뮬 피드). 사이드바 미표시(직접 URL).
  kiosk_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" },
};

export function canAccess(role: SystemRole, menu: MenuKey, matrix: AccessMatrix = MENU_ACCESS): boolean {
  return matrix[menu][role] !== "none";
}

export function accessLevel(role: SystemRole, menu: MenuKey, matrix: AccessMatrix = MENU_ACCESS): Access {
  return matrix[menu][role];
}

/**
 * 쓰기 권한 여부 = 접근 수준이 full 또는 scoped. readonly/none은 false.
 * ⚠️ 변경(mutating) 서버 액션의 게이트는 canAccess(=none만 차단, readonly 통과)가 아니라 이걸 써야 한다 —
 * readonly 역할이 쓰기 액션을 통과하는 누수 방지. (tenant override 반영은 canWriteTenant.)
 */
export function canWrite(role: SystemRole, menu: MenuKey, matrix: AccessMatrix = MENU_ACCESS): boolean {
  const a = matrix[menu][role];
  return a === "full" || a === "scoped";
}

// === 테넌트 권한 override (owner 설정 permissions 섹션) ===
export type PermissionOverride = { menu: MenuKey; role: SystemRole; access: Access };

// 편집 금지 셀(가드레일) — 저장(superRefine)·적용(resolveMatrix) 양쪽에서 이중 방어.
// 1) 역할 전용 특수 화면은 override 자체 무효. 2) master는 자기 콘솔(owner/admin/대시보드)을 잠글 수 없음.
// 3) student는 '내 학습' 전용 역할이라 일반 메뉴 부여 자체를 막는다(아래).
const ROLE_LOCKED_MENUS = new Set<MenuKey>(["teacher_onescreen", "my_learning"]);
export function isPermissionLocked(menu: MenuKey, role: SystemRole, access: Access): boolean {
  if (ROLE_LOCKED_MENUS.has(menu)) return true;
  // 'student'는 '내 학습' 전용 역할(미니멀 셸) — 일반 메뉴를 부여하면 requireAccess(menu)가 통과해
  // 학생이 /billing 등에 직접 URL로 진입한다. 학생에게 줄 수 있는 일반 메뉴 자체가 없으므로 컬럼 전체를 잠근다.
  if (role === "student") return true;
  if (role === "master" && (menu === "owner" || menu === "admin" || menu === "dashboard") && access === "none") {
    return true;
  }
  return false;
}

/**
 * 하드코딩 MENU_ACCESS(기본값) 위에 저장된 sparse override를 셀 단위로 덮어쓴 "유효 매트릭스".
 * 순수 함수(Vitest 대상). 가드레일에 걸리는 셀(잠긴 메뉴·master 자기잠금)은 무시한다(DB 직접 변조 대비).
 */
export function resolveMatrix(overrides: readonly PermissionOverride[]): AccessMatrix {
  const matrix = Object.fromEntries(
    MENU_KEYS.map((k) => [k, { ...MENU_ACCESS[k] }]),
  ) as AccessMatrix;
  for (const o of overrides) {
    if (!matrix[o.menu] || isPermissionLocked(o.menu, o.role, o.access)) continue;
    matrix[o.menu][o.role] = o.access;
  }
  return matrix;
}
