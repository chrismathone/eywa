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
  "lesson_reports",
  "staff",
  "billing",
  "textbook_requests",
  "meetings",
  "documents",
  "integrations",
  "sheet_sync",
  "help",
  "admin",
  "owner",
  "teacher_onescreen",
  "my_learning",
  "kiosk_settings",
] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

/**
 * 강사 미니멀 셸 '내 메뉴' 드롭다운에 노출되는 메뉴(=표시 순서). 강사 메뉴 소비처(teacher-menu.tsx)와
 * owner '역할·권한'의 '강사 내 메뉴 표시' 토글이 공유하는 단일 소스.
 * teacher_onescreen(수업 마감 원스크린)은 ROLE_LOCKED라 항상 표시(끌 수 없음) — 목록엔 포함하되 토글에선 고정.
 */
export const TEACHER_MENU_KEYS = [
  "teacher_onescreen",
  "students",
  "attendance",
  "classes",
  "timetable",
  "exams",
  "consultations",
  "textbook_requests",
  "documents", // 서식 저장소 — 강사는 readonly(빈 양식 다운로드 용도)
] as const satisfies readonly MenuKey[];

export type Access = "full" | "scoped" | "readonly" | "none";
export type AccessMatrix = Record<MenuKey, Record<SystemRole, Access>>;

export const MENU_ACCESS: AccessMatrix = {
  // 강사=none — 대시보드는 테넌트 전체 재무(미수·수납률·미수상위 등)를 보여주고 강사 스코핑이 없어 누수라,
  // 강사는 접근 불가(강제 URL 진입 시 requireAccess가 roleHome=/onescreen으로 폴백). 강사 홈은 원스크린.
  dashboard: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "scoped", accountant: "scoped", viewer: "readonly", student: "none" },
  timetable: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "readonly", accountant: "readonly", viewer: "readonly", student: "none" },
  attendance: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "readonly", viewer: "readonly", student: "none" },
  classes: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "readonly", student: "none" },
  students: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "readonly", viewer: "readonly", student: "none" },
  // 성적관리 — 시험 등록 + 반 일괄 성적입력. 강사는 담당 반 채점(scoped), 회계는 무관, 학생 미표시.
  exams: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "none", viewer: "readonly", student: "none" },
  enrollment: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "none", viewer: "none", student: "none" },
  consultations: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "none", viewer: "readonly", student: "none" },
  // 강사=none — 전체 퇴원 학생(테넌트 전역, 강사 스코핑 없음)이라 누수. 강사 메뉴엔 없음(담당 교육 페이지만).
  withdrawals: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "full", viewer: "readonly", student: "none" },
  // 이탈 방어(리텐션) — 위험도 기반 재등록 방어. 강사는 담당 학생만(scoped), 회계는 매출 위험 열람.
  retention: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "readonly", viewer: "readonly", student: "none" },
  // 수업보고서(발송 관리) — 학원 전체 보고서 발송 큐·작성률·목록 총괄(오버사이트). 구 학원설정 ?tab=report_mgmt에서
  // 좌측 독립 메뉴로 승격(옛 Edutrix 외부링크 대체). 사무실(master/admin/manager)이 관리(재발송 등 쓰기 포함),
  // 뷰어는 열람만. 강사=none(작성은 /onescreen 원스크린 담당, 여기는 전체 오버사이트라 스코핑 없음).
  lesson_reports: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "readonly", student: "none" },
  // 강사=none — 전체 직원 목록·상세(급여·계정 등 민감)라 누수. 강사 메뉴엔 없음.
  staff: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  billing: { master: "full", admin: "full", manager: "readonly", teacher: "none", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  // 교재 요청 — 강사가 본인 담당 학생 교재를 요청(스코프)하는 전용 면. 사무실(master/admin/accountant)은 /billing 교재 면에서 처리하되 여기서도 열람 가능.
  textbook_requests: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  // 강사=none — 원장 회의 포함 전체 회의록(민감)이라 누수. 강사 메뉴엔 없음(화자 연결은 데이터일 뿐 열람권 아님).
  meetings: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "full", viewer: "readonly", student: "none" },
  // 데이터베이스(서식 저장소) — 사무실(master/admin/manager)이 업로드·작성, 나머지는 조회만. 학생은 미노출.
  documents: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "readonly", accountant: "readonly", viewer: "readonly", student: "none" },
  // makeedu 연동 조작 — '지금 동기화'(정방향 릴레이 트리거)·'makeedu로 보내기'(역동기화 큐잉) 실행 권한.
  // 사이드바 메뉴가 아니라 **액션 권한 키**(hidden) — 버튼 노출(목록 ↻ 배지 옆·등록상담 전송 카드)과 서버 액션
  // 게이트(canWriteTenant)가 함께 읽는다. 역할·권한 면에 행이 떠 원장이 조정 가능(예: 상담사에게 열기).
  // ⚠️ 구글 시트 반영·가져오기는 이 키가 아니라 sheet_sync(아래). 연동 ON/OFF 토글만 owner 콘솔 소속(master).
  integrations: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" },
  // 구글 시트 연동 조작 — 시간표 '시트 반영'(DB→시트 전체 push)·'시트에서 가져오기'(시트→DB) 실행 권한.
  // integrations와 같은 **액션 권한 키**(hidden, 사이드바 메뉴 아님) — 버튼 노출(timetable/page)과 서버 액션
  // 게이트(canManageSheetSync)가 함께 읽는다. 역할·권한 면에 행이 떠 원장이 조정 가능.
  // ⚠️ 이 경로는 **테넌트 전체 시간표**(전 강사·전 학생 명단)를 외부 공유 시트와 주고받으므로 담당(scoped)
  // 개념이 없다 — 게이트가 "full"만 통과시킨다(전체/없음만 의미 있음). 강사에게 열면 전 학생 명단이 나간다.
  sheet_sync: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" },
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

/**
 * 역할별 홈(폴백) 경로 — 강사=원스크린, 학생=내 학습, 그 외=대시보드(미접근이면 공개 랜딩).
 * requireAccess 거부 시·로그인 후 착지점의 **단일 소스**. 강사/학생 전용 메뉴(teacher_onescreen·my_learning)는
 * ROLE_LOCKED라 항상 접근 가능 → 무한 리다이렉트 없음. (클라·서버 공용, server-only 아님.)
 */
export function roleHome(role: SystemRole, matrix: AccessMatrix = MENU_ACCESS): string {
  if (role === "teacher") return "/onescreen";
  if (role === "student") return "/my-learning";
  return canAccess(role, "dashboard", matrix) ? "/dashboard" : "/";
}

// === 테넌트 권한 override (owner 설정 permissions 섹션) ===
export type PermissionOverride = { menu: MenuKey; role: SystemRole; access: Access };

// 편집 금지 셀(가드레일) — 저장(superRefine)·적용(resolveMatrix) 양쪽에서 이중 방어.
// 1) 역할 전용 특수 화면은 override 자체 무효. 2) master는 자기 콘솔(owner/admin/대시보드)을 잠글 수 없음.
// 3) student는 '내 학습' 전용 역할이라 일반 메뉴 부여 자체를 막는다(아래).
const ROLE_LOCKED_MENUS = new Set<MenuKey>(["teacher_onescreen", "my_learning"]);
export function isPermissionLocked(menu: MenuKey, role: SystemRole, access: Access): boolean {
  if (ROLE_LOCKED_MENUS.has(menu)) return true;
  // 대시보드 집계는 테넌트 전체 데이터다. 강사 scoped 쿼리가 마련되기 전까지는
  // 강사에게 메뉴를 열면 담당 범위를 넘어 학생·출결 데이터가 노출되므로 override를 막는다.
  if (menu === "dashboard" && role === "teacher") return true;
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
