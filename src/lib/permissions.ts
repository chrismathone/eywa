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

/**
 * 반 담임으로 **배정 가능한** 시스템 역할 — 강사 선택지·서버 검증·시간표 임포트 대조의 **단일 소스**.
 *
 * ⚠️ 이 목록이 좁히는 건 "가르칠 수 있는가"이지 **재직 여부가 아니다** — 퇴직자를 후보에서 빼는 건
 *    `status='active'` 조건이 하는 일이다. 둘을 헷갈려 역할로 좁히면 **멀쩡히 운영 중인 반이 화면에서
 *    사라진다**: injaewon은 관리자(admin)가 수업을 겸해 활성 반 6개(김민주 3·정유진 2·허은진 1)를 맡고 있고,
 *    `admin` 누락으로 2026-07-22 수업목록 필터 → 08-03 인수인계·반 수정·새 반 순으로 두 번 터졌다.
 *
 * 🔴 **이 상수를 쓰지 않고 역할 배열을 새로 적지 말 것.** 같은 배열이 세 벌로 복제돼 있었고 한 벌만
 *    고쳐져서 재발했다(선택지는 고쳤는데 서버 검증이 거절 = "목록엔 뜨는데 저장이 안 됨"). 복제 방지
 *    테스트는 [`assignable-teacher-roles.test.ts`](./assignable-teacher-roles.test.ts).
 *    ⚠️ TS 밖(스크립트 등)에서 같은 판정이 필요하면 이 상수를 주석으로 가리키고 값을 맞출 것.
 */
export const ASSIGNABLE_TEACHER_ROLES = ["teacher", "manager", "master", "admin"] as const;

/** 위 목록 판정 — DB에서 온 임의 문자열(역할 컬럼)도 그대로 받는다. */
export function isAssignableTeacherRole(role: string | null | undefined): boolean {
  return !!role && (ASSIGNABLE_TEACHER_ROLES as readonly string[]).includes(role);
}

export const MENU_KEYS = [
  "dashboard",
  "timetable",
  "attendance",
  "seat_attendance",
  "classes",
  "students",
  "exams",
  "enrollment",
  "consultations",
  "withdrawals",
  "retention",
  "ecs",
  "lesson_reports",
  "staff",
  "billing",
  "textbook_requests",
  "expense_requests",
  "meetings",
  "documents",
  "class_review",
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
  "ecs", // English Class Sheet — 영어 강사 주간 수업계획서/출석부(scoped: 담당 반만)
  "students",
  "attendance",
  "classes",
  "timetable",
  "exams",
  "consultations",
  "textbook_requests",
  "expense_requests", // 지출결의서 — 강사가 본인 지출을 작성·제출(사무실은 /billing 지출 면에서 결재)
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
  // 자리(랩실·JJ실) 출석부 — 여러 반이 동시에 들어오는 **방**을 축으로 출석만 찍는 면(0208a).
  // 🔴 attendance와 **별개 키**인 이유: 자리 당번은 아르바이트(현재 viewer)라 출석 쓰기를 통째로 주면
  //    학원 전체 출석부가 함께 열린다(#77). "이 기능만 다른 권한"은 menuKey 승격이 정석
  //    (textbook_requests·integrations 선례) → 개인은 permissions.userOverrides로 이 키만 연다.
  // ⚠️ 기본값은 사무실만. 자리 당번 계정은 역할 승격이 아니라 **개인 예외**로 열 것
  //    (역할을 올리면 급여·직원명부·알림 수신자가 따라 붙는다 — LAB 가짜 강사 사고와 같은 종류).
  seat_attendance: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" },
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
  // English Class Sheet(ECS) — 영어 반별 주간 수업계획서/출석부(구글시트 이식). 강사=scoped(담당 반만,
  // 게이트는 requireEcsClassAccess 공용 함수 — effectiveTeacherScope 상시 적용). viewer=readonly(열람만).
  // 출석 체크 쓰기는 이 키가 아니라 attendance 게이트(비파괴 markPresentIfAbsent)가 별도 판정.
  ecs: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "readonly", student: "none" },
  // 수업보고서(발송 관리) — 학원 전체 보고서 발송 큐·작성률·목록 총괄(오버사이트). 구 학원설정 ?tab=report_mgmt에서
  // 좌측 독립 메뉴로 승격(옛 Edutrix 외부링크 대체). 사무실(master/admin/manager)이 관리(재발송 등 쓰기 포함),
  // 뷰어는 열람만. 강사=none(작성은 /onescreen 원스크린 담당, 여기는 전체 오버사이트라 스코핑 없음).
  lesson_reports: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "readonly", student: "none" },
  // 강사=none — 전체 직원 목록·상세(급여·계정 등 민감)라 누수. 강사 메뉴엔 없음.
  staff: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  billing: { master: "full", admin: "full", manager: "readonly", teacher: "none", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  // 교재 요청 — 강사가 본인 담당 학생 교재를 요청(스코프)하는 전용 면. 사무실(master/admin/accountant)은 /billing 교재 면에서 처리하되 여기서도 열람 가능.
  textbook_requests: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  // 지출결의서(강사 제출) — 강사가 본인 지출을 작성·제출하고 결재 진행상태를 조회하는 전용 면(강사=본인 것만).
  // 사무실(master/admin/accountant)은 /billing 지출 면에서 결재·처리하므로 여기 접근 시 그쪽으로 이동(=full은 라우팅만,
  // 생성 게이트엔 영향 없음 — 이들은 이미 billing 쓰기로 생성). manager는 billing=readonly라 여기서도 none(생성 권한
  // 확장 방지 — 이 기능은 '강사 제출'에 한정). ⚠️ 결재 승인(원장/대표 토글)은 이 키가 아니라 billing 쓰기만 통과 →
  // 강사가 자기 결의서를 셀프 승인 못 함(expense-actions 게이트).
  expense_requests: { master: "full", admin: "full", manager: "none", teacher: "full", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  // 강사=none — 원장 회의 포함 전체 회의록(민감)이라 누수. 강사 메뉴엔 없음(화자 연결은 데이터일 뿐 열람권 아님).
  meetings: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "full", viewer: "readonly", student: "none" },
  // 데이터베이스(서식 저장소) — 사무실(master/admin/manager)이 업로드·작성, 나머지는 조회만. 학생은 미노출.
  documents: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "readonly", accountant: "readonly", viewer: "readonly", student: "none" },
  // 수업 평가 체크리스트(참관 30문항, 원장 지시 2026-08-04) — **테스트 단계라 기본 전원 차단**.
  // 개방은 코드가 아니라 tenant_settings 데이터로만 한다(배포 없이 명단 조정):
  //   · 원장직급(master) = 역할 override — ⚠️ **여기 기본값이 none이라 원장도 이 행이 없으면 못 들어간다**
  //     (2026-08-13 실측: 원장이 "원장은 풀려 있을 텐데"라고 여긴 3주간 실제로는 막혀 있었다).
  //   · 개별 인원 = 개인 예외(userOverrides) — 같은 역할 전원이 따라 열리는 것을 막으려고 개인으로만.
  // 명단·개방은 scripts/staff-access/grant-class-review.mjs(드라이런→--apply, --revoke로 원복) 단일 소스.
  // ⚠️ 개인 예외는 CRUD뿐 아니라 **실명 열람·문항 세트 편집**까지 연다(getReviewPrivileges) — 명단은 최소로.
  class_review: { master: "none", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" },
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

/**
 * 접근 수준의 강도 순서 — **`mergeMostPermissive` 전용**. 일반 게이트 판정에 쓰지 말 것
 * (canAccess·canWrite·accessLevel이 단일 소스다).
 * ⚠️ readonly↔scoped는 "전체 읽기"와 "담당 쓰기"라 서로를 포함하지 않는다. 그래도 안전한 이유는
 * 병합이 **항상 올라가는 방향**이기 때문 — 어떤 셀도 이 순서 때문에 잠기지 않는다.
 */
const ACCESS_RANK: Record<Access, number> = { none: 0, readonly: 1, scoped: 2, full: 3 };

/**
 * 두 매트릭스를 셀 단위로 **더 허용적인 쪽**으로 합친다(순수 함수).
 *
 * 용도는 하나 — **super_admin**(SaaS 총괄)이다. super_admin은 원장이 편집하는 권한 매트릭스 **위에**
 * 있어야 하므로 owner override가 super_admin을 잠그면 안 된다(결정 2026-07-02). 그런데 예전 구현은
 * 그걸 "override를 **통째로 버리고** 코드 기본값만 쓴다"로 처리했다 — 잠금은 무시됐지만 **원장이 준
 * 권한도 함께 사라졌다.**
 *
 * 🔴 2026-08-13 실측(원장 제보 "수업평가가 사라졌는데"): 이승엽이 super_admin이 된 순간, 개인 예외로
 *    열어 둔 **수업 평가**(userOverrides full)와 역할 override로 열어 둔 **학원 설정**(owner admin=full)이
 *    동시에 사이드바에서 사라졌다. 반대로 원장이 닫아 둔 이탈 방어·성적관리·직원관리는 그대로 보였다.
 *    즉 기본값이 `none`인 메뉴에선 super_admin이 **일반 직원보다 덜 보는 역전**이 생긴다.
 * ⚠️ 그래서 "override 무시"를 **"기본값과 override 중 높은 쪽"** 으로 바꿨다 — 잠금은 여전히 무시하고
 *    (기본값이 살아남는다), 부여는 보존한다. super_admin 판정을 다시 `resolveMatrix([])`로 되돌리지 말 것.
 */
export function mergeMostPermissive(a: AccessMatrix, b: AccessMatrix): AccessMatrix {
  const out = {} as AccessMatrix;
  for (const menu of MENU_KEYS) {
    const cells = {} as Record<SystemRole, Access>;
    for (const role of SYSTEM_ROLES) {
      cells[role] = ACCESS_RANK[b[menu][role]] > ACCESS_RANK[a[menu][role]] ? b[menu][role] : a[menu][role];
    }
    out[menu] = cells;
  }
  return out;
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

// (shell) 최상위 라우트 폴더 → 그 페이지가 게이트하는 MenuKey. 폴더명이 곧 키인 경우가 대부분이나
// 하이픈/특수 케이스는 명시. integrations·sheet_sync는 라우트가 아니라 액션 권한 키라 여기 없음.
const PATH_SEGMENT_TO_MENU: Record<string, MenuKey> = {
  dashboard: "dashboard",
  timetable: "timetable",
  attendance: "attendance",
  classes: "classes",
  students: "students",
  exams: "exams",
  enrollment: "enrollment",
  consultations: "consultations",
  withdrawals: "withdrawals",
  retention: "retention",
  ecs: "ecs",
  "lesson-reports": "lesson_reports",
  staff: "staff",
  billing: "billing",
  "textbook-requests": "textbook_requests",
  "expense-requests": "expense_requests",
  meetings: "meetings",
  documents: "documents",
  "class-review": "class_review",
  help: "help",
  admin: "admin",
  owner: "owner",
  onescreen: "teacher_onescreen",
  "my-learning": "my_learning",
  "kiosk-settings": "kiosk_settings",
};

/**
 * URL 경로 → 그 페이지의 MenuKey(첫 세그먼트 기준). 매핑 없는 경로(신규/비메뉴 라우트)는 null.
 * (shell) 레이아웃의 **뷰-경로 정합성 가드**가 쓴다 — 강사 뷰(겸직 강사뷰 포함)에서 강사가 접근 못 하는
 * 페이지를 미니셸이 감싸는 것을 막기 위해 canAccess("teacher", menu)와 대조한다. null(모르는 경로)은
 * fail-open — 페이지 자체의 requireAccess가 판정(신규 라우트를 이 맵 누락으로 과잉 차단하지 않음).
 */
export function menuKeyForPath(pathname: string): MenuKey | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg ? (PATH_SEGMENT_TO_MENU[seg] ?? null) : null;
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

// === 개인 예외 (per-user override, 2026-08-01) ===
// 역할 매트릭스만으론 "같은 admin인데 두 명만 직원관리"를 표현할 수 없어 신설(원장 지시: 직원관리를
// 원장 2명 + 개발팀 설현·이승엽만). 저장은 tenant_settings.data.permissions.userOverrides(별도 테이블 없음 —
// getTenantSettings 캐시에 실려 추가 쿼리 0, 쓰기는 0038a master-guard 트리거가 보호).
// ⚠️ SQL 미러: auth_menu_access(0170a)가 같은 우선순위(개인 예외 > 역할 override > 코드 기본값)로 판정한다.
export type UserPermissionOverride = { userId: string; menu: MenuKey; access: Access };

/**
 * 역할 매트릭스 위에 **이 사용자에게만** 셀 단위 예외를 얹은 유효 매트릭스. 순수 함수(Vitest 대상).
 * 자기 역할 행만 바뀌므로, 이 결과를 requireAccess·사이드바 등 "현재 행위자" 판정에만 쓰면
 * 다른 역할 행 판정(강사뷰 가드 등)은 영향받지 않는다. 잠긴 셀(isPermissionLocked)은 예외로도 못 연다.
 * 입력 matrix는 변형하지 않는다(getPermMatrix의 요청 캐시 오염 방지).
 */
export function applyUserOverrides(
  matrix: AccessMatrix,
  userId: string,
  role: SystemRole,
  overrides: readonly UserPermissionOverride[],
): AccessMatrix {
  const mine = overrides.filter(
    (o) => o.userId === userId && matrix[o.menu] && !isPermissionLocked(o.menu, role, o.access),
  );
  if (mine.length === 0) return matrix;
  const out = { ...matrix };
  for (const o of mine) {
    out[o.menu] = { ...out[o.menu], [role]: o.access };
  }
  return out;
}
