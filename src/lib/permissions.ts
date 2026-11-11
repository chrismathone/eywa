// 역할×메뉴 접근 매트릭스. 하드코딩 MENU_ACCESS가 "기본값"이고, 테넌트는 owner 설정의
// permissions 섹션(jsonb sparse override)으로 셀 단위로 덮어쓴다(resolveMatrix). canAccess/
// accessLevel은 optional 3번째 인자 matrix를 받아 — 생략 시 하드코딩 default(기존 콜사이트 불변).
// MenuKey/SystemRole은 튜플에서 추론(단일 소스 → Zod z.enum과 공유).

import { NEW_SETTINGS_ROLE_KEYS, SETTINGS_ROLE_KEYS } from "./settings-role-catalog";

export const SYSTEM_ROLES = [
  "master",
  "admin",
  "manager",
  "teacher",
  "counselor",
  "accountant",
  "viewer",
  // 아르바이트(원장 2026-11-05 *"열람보다 낮은 등급"*) — 기본은 도움말·고객센터만. 필요한 메뉴는 원장이 역할·권한 표나
  // 개인별 메뉴 권한으로 연다(랩실·JJ실 출석은 직원관리의 '자리 담당' 토글). 열람(viewer)보다 넓게 두지 말 것.
  "parttime",
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
  "makeups",
  "seat_attendance",
  "classes",
  "students",
  "student_contribution",
  "student_english_name",
  "exams",
  "enrollment",
  "consultations",
  "withdrawals",
  "withdrawal_reports",
  "retention",
  "newcomers",
  "ecs",
  "mcs",
  "lesson_reports",
  "before_class_checklist",
  ...NEW_SETTINGS_ROLE_KEYS,
  "staff",
  "teacher_view",
  "billing",
  "textbook_requests",
  "expense_requests",
  "meetings",
  "documents",
  "class_review",
  "approvals",
  "calendar",
  "shuttle",
  "inventory",
  "textbooks",
  "integrations",
  "sheet_sync",
  "help",
  "support",
  "admin",
  "owner",
  "teacher_onescreen",
  "my_learning",
  "kiosk_settings",
  // 2026-11-09 권한 줄 정비(원장 *"항상 새로운 메뉴가 추가되거나 신설되면 권한 배정을 잘 해놓도록"*) — 코드에 역할로 박혀 있던 문을 권한으로 옮겼다.
  "assistant", // 학원 비서(사이드바 아래 줄 · 폰 위쪽 줄 단추 · Ctrl+J) — 메뉴가 아니라 어디서나 여는 도구
  "management", // 경영 분석 · 스키마·지식그래프(시안)
  "okr", // 조직·OKR(시안)
  "marketing", // 연간 운영계획 · 홍보·마케팅(시안)
  "work_records", // 업무 작성센터(시안)
  "shuttle_admin", // 셔틀 관리자 화면(학부모 관리 현황 · 탑승 학생 시간표 · 가까운 노선 찾기 · 실시간 위치) — 셔틀 권한 위 조건
  // 연결 앱(왼쪽 '연결 앱'의 바깥 앱 링크) — 앱마다 한 키. 아래 CONNECTED_APP_MENU_KEYS에도 함께 적는다.
  "app_todays_math",
] as const;

/**
 * **연결 앱 권한** 키 — 바깥 앱 링크(오늘 수학 등)를 그 역할에게 세우나(원장 2026-11-05 *"연결앱 권한 따로 빼나줘"*).
 * 칸은 **전체(보임) · 없음**만 쓴다(`isPermissionLocked`가 담당·읽기를 막는다) · 역할별 표가 아니라 '연결 앱 권한' 표에 선다(permission-rows).
 * 🔴 새 연결 앱의 기본값 = **전 역할 없음**(원장 2026-11-05 *"새 연동앱은 전부 꺼짐으로 기본값"* — 가드 permissions.test.ts).
 *    오늘 수학만 강사 이상(원장·관리자·매니저(실장)·강사 — 권한 표의 강사 왼쪽 칸 · 오늘 수학 쪽 로그인 자격과 같은 네 역할)에게 열린 채 시작한다.
 * 판정 = [`getMyConnectedApps`](@/features/connected-apps/server/visible.ts) 한 곳(사이드바 · 폰 메뉴 · 강사 내 메뉴 · 출발 라우트 · 오늘 수학 v2 로그인 authorize).
 */
export const CONNECTED_APP_MENU_KEYS = ["app_todays_math"] as const;
export function isConnectedAppMenu(menu: string): boolean {
  return (CONNECTED_APP_MENU_KEYS as readonly string[]).includes(menu);
}
/** 연결 앱 칸에 '담당'·'읽기'를 실은 저장 요청의 거절 문구(역할 칸 · 개인 줄 — saveOwnerSection). 화면은 이 값을 만들지 않는다(칸 순환이 건너뛴다). */
export const CONNECTED_APP_ACCESS_MESSAGE = "연결 앱 권한은 전체·없음 중에서 선택해 주세요";

/**
 * 칸이 **전체·없음만** 뜻이 있는 권한 — 연결 앱(링크를 세우나 마나) · 학원 비서(쓰나 마나) · 셔틀 관리자 화면(여나 마나 — 2026-11-10).
 * 학원 비서는 지점 자료 전부를 읽는 전용 DB 역할로 조회해(`src/features/assistant/server/executor.ts`) '담당'(본인 반만)·'읽기'로 좁힐 수 없다 —
 * 두 값을 열어 두면 표에는 좁은 값이 적히는데 실제로는 '전체'와 같이 열린다(강사보다 낮은 직급의 '담당' 금지와 같은 까닭).
 * 판정 = `isPermissionLocked`(담당·읽기 잠금) · 칸 순환(`permissionAccessOptions`) · 저장 거절(`onOffAccessMessage`)이 함께 이 함수를 본다.
 */
export function isOnOffMenu(menu: string): boolean {
  return isConnectedAppMenu(menu) || menu === "assistant" || menu === "shuttle_admin";
}
/** 셔틀 관리자 화면(`shuttle_admin`)을 줄 수 있는 역할 — 학부모 계정 표의 DB 정책(0320a `parent_accounts_tenant_read`)과 같은 두 역할. */
export const SHUTTLE_ADMIN_ROLES = ["master", "admin"] as const;
/** 위 권한에 '담당'·'읽기'를 실은 저장 요청의 거절 문구 — 연결 앱은 종전 문구 그대로. */
export function onOffAccessMessage(menu: MenuKey): string {
  return isConnectedAppMenu(menu) ? CONNECTED_APP_ACCESS_MESSAGE : `${MENU_LABEL[menu]} 권한은 전체·없음 중에서 선택해 주세요`;
}

/**
 * 메뉴 한글 라벨 — **단일 소스**. 권한 편집기(화면)와 감사로그(설정 변경 상세)가 같은 말을 써야
 * "무엇이 열렸는지"가 두 곳에서 갈리지 않는다(2026-08-27, 전엔 권한 편집기 안에만 있었다).
 * ⚠️ 새 메뉴키를 추가하면 여기도 함께 — 빠지면 화면·감사로그에 영문 키가 그대로 샌다(raw 노출 금지).
 */
export const MENU_LABEL: Record<MenuKey, string> = {
  dashboard: "대시보드",
  timetable: "시간표",
  attendance: "출석부",
  makeups: "보강관리",
  seat_attendance: "랩실·JJ실 출석부",
  classes: "수업목록",
  students: "원생목록",
  student_contribution: "원생 로열티",
  student_english_name: "원생목록 - 영어이름",
  exams: "성적관리",
  enrollment: "신규 콜&상담",
  consultations: "원생상담",
  withdrawals: "퇴원관리",
  withdrawal_reports: "퇴원보고서",
  retention: "이탈 방어",
  newcomers: "신규생 관리",
  ecs: "영어 강사 시트",
  mcs: "수학 강사 시트",
  lesson_reports: "수업보고서",
  before_class_checklist: "비포클래스체크리스트",
  report_settings: "보고서 설정",
  ai_ment: "AI 멘트",
  profile_settings: "프로필·브랜드 설정",
  operations_settings: "운영·과목·시간표 설정",
  billing_settings: "수납·청구 설정",
  notification_settings: "알림·약관 설정",
  consultation_settings: "상담 양식 설정",
  navigation_settings: "탭 및 메뉴 구성",
  integration_settings: "연동 설정",
  popup_settings: "팝업 공지 설정",
  attendance_salary_settings: "출석부 급여 비율 설정",
  payroll_settings: "급여 정책 설정",
  staff: "직원관리",
  teacher_view: "강사뷰 접근",
  billing: "수납관리",
  textbook_requests: "교재 요청",
  expense_requests: "지출결의서",
  meetings: "회의록",
  documents: "데이터베이스",
  class_review: "직원 평가",
  approvals: "전자결재",
  calendar: "캘린더",
  shuttle: "셔틀",
  inventory: "재고관리",
  textbooks: "교재목록",
  integrations: "makeedu 연동",
  sheet_sync: "구글 시트 연동",
  help: "도움말",
  support: "고객센터",
  admin: "관리자 도구",
  owner: "학원 설정",
  teacher_onescreen: "선생님 원스크린",
  my_learning: "내 학습",
  kiosk_settings: "키오스크 설정",
  assistant: "학원 비서",
  management: "경영 분석·지식그래프",
  okr: "조직·OKR",
  marketing: "홍보·마케팅",
  work_records: "업무 작성센터",
  shuttle_admin: "셔틀 관리자 화면",
  app_todays_math: "오늘 수학(연결 앱)",
};
export type MenuKey = (typeof MENU_KEYS)[number];

/**
 * 강사 미니멀 셸 '내 메뉴' 드롭다운에 노출되는 메뉴(=표시 순서). 강사 메뉴 소비처(teacher-menu.tsx)와
 * owner '역할·권한'의 '강사 내 메뉴 표시' 토글이 공유하는 단일 소스.
 * teacher_onescreen(수업 마감 원스크린)은 ROLE_LOCKED라 항상 표시(끌 수 없음) — 목록엔 포함하되 토글에선 고정.
 */
export const TEACHER_MENU_KEYS = [
  "teacher_onescreen",
  "ecs", // English Class Sheet — 영어 강사 주간 수업계획서/출석부(scoped: 담당 반만)
  "mcs", // Math Class Sheet — 수학 반별 월간 진도표(scoped: 담당 반만)
  "students",
  "attendance",
  "makeups",
  "classes",
  "timetable",
  "exams",
  "consultations",
  "textbook_requests",
  "expense_requests", // 지출결의서 — 강사가 본인 지출을 작성·제출(사무실은 /billing 지출 면에서 결재)
  "approvals", // 전자결재 — 기본 none(역할 표나 개인별 메뉴 권한으로 연 계정에만 보인다). 문서 스코프는 결재선·RLS.
  "calendar", // 캘린더 — 학원 공용 일정(강사 readonly 열람)
  // 수업 평가 — 강사에겐 **자기 평가 전용**(본인 평가지의 본인 채점만, self-only.ts). 기본값 none이라
  // 학원설정에서 열어야 보인다. 남의 평가지·평가자 점수는 조회 초크포인트에서 잘려 나간다.
  "class_review",
  "withdrawal_reports",
  // 비포클래스체크리스트(초안) — 기본 none. 개인별 메뉴 권한으로 연 사람에게만 선다(읽기 = 열람, 전체 = 체크).
  "before_class_checklist",
  "documents", // 서식 저장소 — 강사는 readonly(빈 양식 다운로드 용도)
] as const satisfies readonly MenuKey[];

export type Access = "full" | "scoped" | "readonly" | "none";
export type AccessMatrix = Record<MenuKey, Record<SystemRole, Access>>;

export const MENU_ACCESS: AccessMatrix = {
  // 강사=none — 대시보드는 테넌트 전체 재무(미수·수납률·미수상위 등)를 보여주고 강사 스코핑이 없어 누수라,
  // 강사는 접근 불가(강제 URL 진입 시 requireAccess가 roleHome=/onescreen으로 폴백). 강사 홈은 원스크린.
  dashboard: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "scoped", accountant: "scoped", viewer: "readonly", parttime: "none", student: "none" },
  timetable: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "readonly", accountant: "readonly", viewer: "readonly", parttime: "none", student: "none" },
  attendance: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "readonly", viewer: "readonly", parttime: "none", student: "none" },
  makeups: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 자리(랩실·JJ실) 출석부 — 여러 반이 동시에 들어오는 **방**을 축으로 출석만 찍는 면(0208a).
  // 🔴 attendance와 **별개 키**인 이유: 자리 당번은 아르바이트(현재 viewer)라 출석 쓰기를 통째로 주면
  //    학원 전체 출석부가 함께 열린다(#77). "이 기능만 다른 권한"은 menuKey 승격이 정석
  //    (textbook_requests·integrations 선례) → 개인은 permissions.userOverrides로 이 키만 연다.
  // ⚠️ 기본값은 사무실만. 자리 당번 계정은 역할 승격이 아니라 **개인 예외**로 열 것
  //    (역할을 올리면 급여·직원명부·알림 수신자가 따라 붙는다 — LAB 가짜 강사 사고와 같은 종류).
  seat_attendance: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  classes: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "readonly", parttime: "none", student: "none" },
  students: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "readonly", viewer: "readonly", parttime: "none", student: "none" },
  // 영어 시트의 이름 한 칸만 수정. 원생목록 전체 권한과 별도로 부여한다.
  student_english_name: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  student_contribution: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  teacher_view: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 성적관리 — 시험 등록 + 반 일괄 성적입력. 강사는 담당 반 채점(scoped), 회계는 무관, 학생 미표시.
  exams: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "none", viewer: "readonly", parttime: "none", student: "none" },
  enrollment: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  consultations: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "none", viewer: "readonly", parttime: "none", student: "none" },
  // 강사=none — 전체 퇴원 학생(테넌트 전역, 강사 스코핑 없음)이라 누수. 강사 메뉴엔 없음(담당 교육 페이지만).
  withdrawals: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "full", viewer: "readonly", parttime: "none", student: "none" },
  withdrawal_reports: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 이탈 방어(리텐션) — 위험도 기반 재등록 방어. 강사는 담당 학생만(scoped), 회계는 매출 위험 열람.
  retention: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "readonly", viewer: "readonly", parttime: "none", student: "none" },
  // 신규생 관리 — 신입 등록 후 90일 체크리스트(사전 콜·첫 수업 안내·OJT·만족도 콜). **데스크 업무**라
  // 사무실 역할만 연다. 🔴 강사=none인 이유는 퇴원관리와 같다: 이 목록은 **테넌트 전역 신입 명단**이라
  // 강사 스코핑이 없어, readonly로 열면 담당하지 않는 학생까지 통째로 보인다(#77 계열 누수).
  newcomers: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "none", viewer: "readonly", parttime: "none", student: "none" },
  // English Class Sheet(ECS) — 영어 반별 주간 수업계획서/출석부(구글시트 이식). 강사=scoped(담당 반만,
  // 게이트는 requireEcsClassAccess 공용 함수 — effectiveTeacherScope 상시 적용). viewer=readonly(열람만).
  // 출석 체크 쓰기는 이 키가 아니라 attendance 게이트(비파괴 markPresentIfAbsent)가 별도 판정.
  ecs: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "readonly", parttime: "none", student: "none" },
  // Math Class Sheet(MCS) — 수학 반별 **월간 진도표**(학생 × 수업일). ECS와 축이 다르다: 영어는 반 전체가
  // 같은 진도를 나가지만 수학은 학생마다 제 교재·제 진도라(실측 2026-08: 같은 반 같은 날 묶음의 79%에서
  // 교재가 갈린다) 행이 학생이다. 권한 모양은 ecs와 같게 둔다 — 같은 성격의 화면이고, 다르게 두면
  // "영어 담임은 되는데 수학 담임은 안 되는" 이유를 아무도 설명할 수 없다.
  // ⚠️ SQL auth_menu_access DEFAULTS엔 넣지 않는다(0170a는 SQL 정책이 참조하는 4개만 담는다 —
  //    math_month_goals는 service_role 전용이라 SQL이 이 키를 묻지 않는다. ecs도 같은 이유로 없다).
  mcs: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "readonly", parttime: "none", student: "none" },
  // 수업보고서(발송 관리) — 학원 전체 보고서 발송 큐·작성률·목록 총괄(오버사이트). 구 학원설정 ?tab=report_mgmt에서
  // 좌측 독립 메뉴로 승격(옛 Edutrix 외부링크 대체). 사무실(master/admin/manager)이 관리(재발송 등 쓰기 포함),
  // 뷰어는 열람만. 강사=none(작성은 /onescreen 원스크린 담당, 여기는 전체 오버사이트라 스코핑 없음).
  lesson_reports: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "readonly", parttime: "none", student: "none" },
  report_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  ai_ment: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  profile_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  operations_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  billing_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  notification_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  consultation_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  navigation_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  integration_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  popup_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  attendance_salary_settings: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  payroll_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 강사=none — 전체 직원 목록·상세(급여·계정 등 민감)라 누수. 강사 메뉴엔 없음.
  staff: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "full", viewer: "none", parttime: "none", student: "none" },
  billing: { master: "full", admin: "full", manager: "readonly", teacher: "none", counselor: "none", accountant: "full", viewer: "none", parttime: "none", student: "none" },
  // 교재 요청 — 강사가 본인 담당 학생 교재를 요청(스코프)하는 전용 면. 사무실(master/admin/accountant)은 /billing 교재 면에서 처리하되 여기서도 열람 가능.
  textbook_requests: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "none", accountant: "full", viewer: "none", parttime: "none", student: "none" },
  // 지출결의서(강사 제출) — 강사가 본인 지출을 작성·제출하고 결재 진행상태를 조회하는 전용 면(강사=본인 것만).
  // 사무실(master/admin/accountant)은 /billing 지출 면에서 결재·처리하므로 여기 접근 시 그쪽으로 이동(=full은 라우팅만,
  // 생성 게이트엔 영향 없음 — 이들은 이미 billing 쓰기로 생성). manager는 billing=readonly라 여기서도 none(생성 권한
  // 확장 방지 — 이 기능은 '강사 제출'에 한정). ⚠️ 결재 승인(원장/대표 토글)은 이 키가 아니라 billing 쓰기만 통과 →
  // 강사가 자기 결의서를 셀프 승인 못 함(expense-actions 게이트).
  expense_requests: { master: "full", admin: "full", manager: "none", teacher: "full", counselor: "none", accountant: "full", viewer: "none", parttime: "none", student: "none" },
  // 강사=none — 원장 회의 포함 전체 회의록(민감)이라 누수. 강사 메뉴엔 없음(화자 연결은 데이터일 뿐 열람권 아님).
  meetings: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "full", viewer: "readonly", parttime: "none", student: "none" },
  // 데이터베이스(서식 저장소) — 사무실(master/admin/manager)이 업로드·작성, 나머지는 조회만. 학생은 미노출.
  documents: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "readonly", accountant: "readonly", viewer: "readonly", parttime: "none", student: "none" },
  // 수업 평가 체크리스트(참관 30문항, 원장 지시 2026-08-04) — **테스트 단계라 기본 전원 차단**.
  // 개방은 코드가 아니라 tenant_settings 데이터로만 한다(배포 없이 명단 조정):
  //   · 원장직급(master) = 역할 override — ⚠️ **여기 기본값이 none이라 원장도 이 행이 없으면 못 들어간다**
  //     (2026-08-13 실측: 원장이 "원장은 풀려 있을 텐데"라고 여긴 3주간 실제로는 막혀 있었다).
  //   · 개별 인원 = 개인 예외(userOverrides) — 같은 역할 전원이 따라 열리는 것을 막으려고 개인으로만.
  // 개인에게 여는 자리 = 학원 설정 → 역할·권한 → '개인별 메뉴 권한'(2026-10-06부터 원장이 화면에서 주고 거둔다).
  // 예전 명단 스크립트(scripts/staff-access/grant-class-review.mjs)는 다시 돌리지 말 것 — 거둔 명단이 되살아난다.
  // ⚠️ 개인 예외는 CRUD뿐 아니라 **실명 열람·문항 세트 편집**까지 연다(getReviewPrivileges) — 명단은 최소로.
  class_review: { master: "none", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 캘린더(학원 공용 일정, 원장 2026-08-18 "일단 캘린더 탭으로 일정부터 관리") — 일정 등록·수정은
  // 사무실(full), 강사·상담·회계·뷰어는 열람(readonly). 학원 일정은 전 직원이 봐야 의미가 있다.
  calendar: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "readonly", accountant: "readonly", viewer: "readonly", parttime: "none", student: "none" },
  // 셔틀(노랑버스, 원장 2026-08-19 makeedu에서 이관) — 편성·등하원 기록은 사무실(full).
  // 강사·상담·회계·뷰어는 **열람만**: 담임이 "우리 반 누가 셔틀 타나"를 봐야 결석 판단이 되는데,
  // 편성을 만지면 그 학생의 등하원 동선이 조용히 바뀐다(학생 레코드 잠금과 같은 결, CLAUDE.md).
  shuttle: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "readonly", accountant: "readonly", viewer: "readonly", parttime: "none", student: "none" },
  // 재고관리(전자기기 자산관리대장, 원장 2026-09-02 — 0242a). 자산대장은 **경영지원팀 도구**다(원본 시트의
  // 분배관리 = 경영지원팀). 회계는 자산 현황을 볼 일이 있어 열람만. 강사·상담·뷰어에게 열면 사이드바 줄만
  // 늘고 쓸 일이 없다. 쓰기 게이트는 canWriteTenant("inventory")(회계 readonly는 자산을 못 고친다).
  // ⚠️ 기본값이 full인 셀이 있으므로 super_admin은 mergeMostPermissive로 자동 통과한다(별도 처리 불요).
  inventory: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "readonly", viewer: "none", parttime: "none", student: "none" },
  // 교재목록(수업 교재 마스터, 0266a). 원장 2026-09-16: *"사무실만 편집 · 강사는 고르기만"*.
  // 🔴 강사가 **readonly**인 건 의도다 — 시트에서 교재를 고르려면 목록을 볼 수 있어야 하지만, 마스터를
  //    고치게 하면 372종으로 갈렸던 이름이 다시 갈린다(이 기능의 존재 이유가 그 통일이다).
  // ⚠️ **반 배정·차수 기입은 이 키가 아니다** — 그건 그 반의 ECS 계획 줄을 쓰는 행위라
  //    `requireEcsClassAccess(classId,{write:true})`가 연다(0266a 헤더). 여기 readonly인 담임 강사도
  //    자기 반에는 교재를 태울 수 있다.
  // ⚠️ 기본값이 full인 셀이 있으므로 super_admin은 mergeMostPermissive로 자동 통과한다.
  textbooks: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 전자결재(기안·결재함, 원장 지시 2026-08-14 — 첫 양식 = 휴가신청서) — **기본 전원 차단**.
  // 여는 길은 둘뿐이다: 역할·권한 표에서 그 역할의 칸을 열거나, '개인별 메뉴 권한'에서 그 사람에게 준다
  // (원장 2026-10-06 — 전에 있던 코드 명단은 없앴다, [`access.ts`](../features/approvals/access.ts)).
  // ⚠️ 전 직원에게 열 땐 **이 행의 기본값을 올려라**(결재는 결국 모든 직원의 기능이다. student는 계속 none).
  approvals: { master: "none", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // makeedu 연동 조작 — '지금 동기화'(정방향 릴레이 트리거)·'makeedu로 보내기'(역동기화 큐잉) 실행 권한.
  // 사이드바 메뉴가 아니라 **액션 권한 키**(hidden) — 버튼 노출(목록 ↻ 배지 옆·등록상담 전송 카드)과 서버 액션
  // 게이트(canWriteTenant)가 함께 읽는다. 역할·권한 면에 행이 떠 원장이 조정 가능(예: 상담사에게 열기).
  // ⚠️ 구글 시트 반영·가져오기는 이 키가 아니라 sheet_sync(아래). 연동 ON/OFF 토글만 owner 콘솔 소속(master).
  integrations: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 구글 시트 연동 조작 — 시간표 '시트 반영'(DB→시트 전체 push)·'시트에서 가져오기'(시트→DB) 실행 권한.
  // integrations와 같은 **액션 권한 키**(hidden, 사이드바 메뉴 아님) — 버튼 노출(timetable/page)과 서버 액션
  // 게이트(canManageSheetSync)가 함께 읽는다. 역할·권한 면에 행이 떠 원장이 조정 가능.
  // ⚠️ 이 경로는 **테넌트 전체 시간표**(전 강사·전 학생 명단)를 외부 공유 시트와 주고받으므로 담당(scoped)
  // 개념이 없다 — 게이트가 "full"만 통과시킨다(전체/없음만 의미 있음). 강사에게 열면 전 학생 명단이 나간다.
  sheet_sync: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  help: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "full", accountant: "full", viewer: "full", parttime: "full", student: "none" },
  // 고객센터(0294a) — 지점 → aywa 운영자 창구(공지사항·개선요청). makeedu처럼 지점 직원 누구나 요청을 쓴다.
  // 원장이 좁히려면 역할·권한 면에서 끈다. 🔴 표 RLS는 이 키를 안 본다(tenant 격리만, #92) — 새 키라도 락아웃 없음.
  support: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "full", accountant: "full", viewer: "full", parttime: "full", student: "none" },
  // master 전용 — 중복 병합 / 데이터 정리 / Google Sheets 통합 등 위험도 높은 도구
  admin: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // owner(=원장/테넌트 소유자) 전용 — 학원 설정 콘솔(과목·교시·직급·청구 기본값·약관 등 테넌트 전체 적용)
  owner: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 강사 전용 — 수업 마감 원스크린(진도·테스트·보고서). 원장(master) 사이드바엔 미표시.
  // (오버사이트가 필요하면 master를 "full"로만 바꾸면 됨.)
  teacher_onescreen: { master: "none", admin: "none", manager: "none", teacher: "full", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 학생 전용 — 내 학습 현황(누적 대시보드) + 데일리 리포트. 직원(원장·강사 등)에겐 미표시.
  my_learning: { master: "none", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "full" },
  // master 전용 — 출석 키오스크 설정(출석번호 발급·기기 등록·발송 시뮬 피드). 사이드바 미표시(직접 URL).
  kiosk_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 비포클래스체크리스트(초안, 원장 2026-10-28) — 수업 전 준비 체크(시트 이식). 새 키 규칙대로 원장만 전체.
  // 체크하는 사람(전체)·보는 사람(읽기)은 학원 설정 → 역할·권한 → 개인별 메뉴 권한으로 연다. 표는 서버 전용(정책 0개).
  before_class_checklist: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 학원 비서(원장 2026-11-09 *"역할에 '비서 추가' 권한은 없네. 기본 디폴트로 원장하고 나머지 비활성화"*) — 새 키 규칙 그대로.
  // 칸은 전체·없음만(isOnOffMenu) · 강사 칸은 잠근다(강사 화면엔 비서 단추가 없다 — isPermissionLocked).
  // 🔴 비서는 **지점 자료 전부**(급여·계약·연락처·계좌 포함)를 읽는다 — 다른 역할에 열면 그 사람도 전부를 묻고 본다(권한 표 줄 설명이 같은 말을 한다).
  //    판정 = assistantViewer()(src/features/assistant/server/gate.ts) 한 곳 — 서버 라우트 전부와 셸 레이아웃의 단추·단축키가 같은 함수를 지난다.
  assistant: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // ── 시안 화면(2026-11-09 이식) — 원장 2026-11-10 결정: **원장 '전체' · 나머지 '없음'**(새 권한 규칙 그대로).
  //    2026-11-11부터 조직·OKR · 업무 작성센터 · 지식그래프는 실제 기록(s2_0048~0051 · 서버 문 = src/lib/auth/menu-gate.ts) — 경영 분석·홍보는 아직 예시 값.
  //    다른 역할에게는 원장이 역할·권한 면에서 연다. 메뉴 버튼 · 운영실 핵심 업무 칸(canOpenCore) · 페이지 문이 같은 키를 본다.
  // 경영 분석 · 스키마·지식그래프(features/mockup/access.ts).
  management: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 조직·OKR(organization-okr/access.ts · 2026-11-11 실제 기록) · 연간 운영계획·홍보·마케팅(marketing/sample-access.ts).
  okr: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  marketing: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 업무 작성센터(work-records 페이지 둘).
  work_records: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 셔틀 관리자 화면(원장 2026-11-10 결정 *"기존 동작 유지"*) — 학부모 관리 현황 · 탑승 학생 시간표 · 가까운 노선 찾기 · 실시간 위치(같은 탭 줄 · 같은 문).
  // 🔴 셔틀 권한 **위에 덧붙는 조건**이다 — 셔틀 권한이 없으면 못 연다(판정 canOpenShuttleAdmin · features/shuttle/admin-access.ts).
  // 칸은 전체·없음만(isOnOffMenu) · 원장·관리자 칸만 바꿀 수 있다(SHUTTLE_ADMIN_ROLES — 학부모 계정 표의 DB 정책 0320a가 이 두 역할에게만 읽기를 연다).
  shuttle_admin: { master: "full", admin: "full", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
  // 연결 앱 '오늘 수학'(원장 2026-11-05 *"지금 하나 있는 '오늘 수학'은 강사 이상에게 열림"*) — 강사 이상 = 원장·관리자·매니저(실장)·강사(권한 표의 강사 왼쪽 칸 ·
  // 오늘 수학 쪽 로그인 자격 tm_sync_control과 같은 네 역할 — 상담·회계는 링크를 눌러도 로그인되지 않는다). 상담·회계·열람·아르바이트·학생은 없음.
  // 영어만 맡은 선생님은 이 값과 따로 과목 축으로 빠진다(connected-apps/apps.ts). 새 연결 앱은 전부 없음으로 시작한다.
  app_todays_math: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none" },
};

// 🔴 **새 권한 키의 기본값 = 원장 '전체' · 나머지 '없음'**(원장 2026-10-06: *"새 권한을 넣으면 '원장' 전체가 디폴트로 하고 나머진 없음을
//    디폴트로"*). 다른 역할에게 여는 것은 원장이 역할·권한 면에서 한다 — 코드 기본값으로 미리 열어 두지 않는다.
//    위 표에서 그 모양이 아닌 줄은 이 규칙 전에 정해진 것이다(바꾸면 쓰고 있는 학원의 접근이 바뀐다 — 가드 permissions.test.ts가 그 목록을 잠근다).
//    ⚠️ 새 키는 DB의 권한 함수 기본값(auth_menu_access)과 권한 표의 자리(permission-rows.ts)도 함께 정할 것.
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
  // 대시보드 접근을 제한한 계정은 업무 선택 안내로 보낸다. 권한 거부 시 순환 이동을 막는다.
  return canAccess(role, "dashboard", matrix) ? "/dashboard" : "/menu";
}

// (shell) 최상위 라우트 폴더 → 그 페이지가 게이트하는 MenuKey. 폴더명이 곧 키인 경우가 대부분이나
// 하이픈/특수 케이스는 명시. integrations·sheet_sync는 라우트가 아니라 액션 권한 키라 여기 없음.
const PATH_SEGMENT_TO_MENU: Record<string, MenuKey> = {
  dashboard: "dashboard",
  timetable: "timetable",
  attendance: "attendance",
  makeups: "makeups",
  classes: "classes",
  students: "students",
  "student-contribution": "student_contribution",
  exams: "exams",
  enrollment: "enrollment",
  consultations: "consultations",
  withdrawals: "withdrawals",
  "before-class": "before_class_checklist",
  "withdrawal-reports": "withdrawal_reports",
  retention: "retention",
  newcomers: "newcomers",
  ecs: "ecs",
  mcs: "mcs",
  "lesson-reports": "lesson_reports",
  staff: "staff",
  billing: "billing",
  "textbook-requests": "textbook_requests",
  "expense-requests": "expense_requests",
  meetings: "meetings",
  documents: "documents",
  "class-review": "class_review",
  approvals: "approvals",
  calendar: "calendar",
  shuttle: "shuttle",
  inventory: "inventory",
  textbooks: "textbooks",
  help: "help",
  support: "support",
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
/** 역할 전용 화면인가(선생님 원스크린 = 강사 · 내 학습 = 학생) — 어느 역할의 칸도 바꿀 수 없어 권한 표 · 개인별 권한에 세우지 않는다. */
export function isRoleOnlyMenu(menu: MenuKey): boolean {
  return ROLE_LOCKED_MENUS.has(menu);
}
/**
 * **'담당'을 줄 수 없는 역할** — 강사보다 낮은 직급(`ROLE_HIERARCHY`: 강사 5 < 열람 6 · 아르바이트 7 — 가드 시험이 맞춘다).
 * 원장 2026-11-05 *"관리자도 수업을 할 수 있기 때문에 '담당'일 수도 있음. 강사보다 낮은 직급은 담당 금지."*
 * 이 역할은 맡을 반이 없어(담임·위임 대상 = 강사 이상) '담당'이 '본인 것만'으로 좁혀지지 않고 대부분의 화면에서 '전체'처럼 열린다
 * (조사 2026-11-05 — 목록 범위는 강사 판정 `effectiveTeacherId`만 본다). 학생은 컬럼 전체가 이미 잠겨 있다.
 * 🔴 말없이 막지 않는다(원장 *"무조건적으로 안되게하지말고 알림메시지도 배선"*) — 권한 표·개인별 권한·저장 거절이 아래 문구를 보인다.
 */
export const SCOPED_FORBIDDEN_ROLES = ["viewer", "parttime"] as const satisfies readonly SystemRole[];
export function isScopedForbiddenRole(role: SystemRole): boolean {
  return (SCOPED_FORBIDDEN_ROLES as readonly SystemRole[]).includes(role);
}
/** 위 금지의 안내 문구 — 권한 표 · 개인별 권한 · 저장 거절이 같은 말을 쓴다(역할 이름은 권한 화면 표기 — 시험이 맞춘다). */
export const SCOPED_FORBIDDEN_MESSAGE =
  "‘담당’은 강사보다 낮은 직급(열람·아르바이트)에는 줄 수 없습니다 — 맡은 반이 없어 ‘담당’이 ‘전체’처럼 열리기 때문입니다. ‘전체’·‘읽기’·‘없음’ 중에서 골라 주세요.";

/**
 * 저장돼 있던 금지 '담당'(손으로 넣은 값 · 역할이 바뀐 사람의 개인 줄)은 **'읽기'와 "그 줄이 없을 때의 값"(`fallback`) 중 좁은 쪽**으로
 * 내려 적용한다 — 그 줄이 없을 때보다 넓어지는 일이 없다.
 * - 버리면 `fallback`(예: 역할 칸 '전체')으로 돌아가 오히려 넓어진다(리뷰 2026-11-05 — 역할 '전체' + 개인 '담당'으로 좁혀 둔 사람).
 * - 무조건 '읽기'로 올려도 넓어진다 — `fallback`이 '없음'인 칸(아르바이트 기본값 등)에서 학원 전체 원생 상세(전화·주소·보호자)가
 *   열린다. '담당'은 원생 상세·실시간 출결을 본인 반으로 좁혀, 맡은 반이 없는 이 역할에게는 열지 않았다(재리뷰 2026-11-05).
 * 그래서 `fallback`이 '없음'이면 '없음', 아니면 '읽기'다(이 역할의 코드 기본값에는 '담당'이 없다 — 시험이 맞춘다).
 * `fallback` = 역할 칸이면 그 칸의 코드 기본값(앞서 저장된 같은 칸이 있으면 그 값), 개인 줄이면 그 사람 역할 칸의 값.
 * 강사뷰 접근의 '담당'은 원래 뜻이 없는 값이라 그대로 둔다(잠금이 버린다).
 */
export function storedScopedAccess(menu: MenuKey, role: SystemRole, access: Access, fallback: Access): Access {
  if (access !== "scoped" || menu === "teacher_view" || !isScopedForbiddenRole(role)) return access;
  return fallback === "none" ? "none" : "readonly";
}

export function isPermissionLocked(menu: MenuKey, role: SystemRole, access: Access): boolean {
  if (menu === "teacher_view" && access === "scoped") return true;
  if (access === "scoped" && isScopedForbiddenRole(role)) return true;
  // 연결 앱은 링크를 세우나 마나뿐이다 — 담당·읽기는 뜻이 없다(전체 = 보임 · 없음 = 안 보임). 학원 비서도 같다(isOnOffMenu).
  if (isOnOffMenu(menu) && (access === "scoped" || access === "readonly")) return true;
  // 학원 비서는 강사에게 열 수 없다 — 강사 화면(미니셸)엔 비서 단추·단축키가 없어 열어도 쓸 곳이 없고(저장만 되는 칸),
  // 비서는 담당 범위 없이 지점 자료 전부를 읽는다(아래 대시보드 강사 잠금과 같은 결).
  if (menu === "assistant" && role === "teacher") return true;
  // 셔틀 관리자 화면은 원장·관리자 칸만 — 학부모 관리 현황의 학부모 계정(로그인 이메일·연락처)은 DB 정책(0320a)이 이 두 역할에게만 읽기를 연다.
  // 다른 역할에 열려면 그 정책을 먼저 넓혀야 한다(화면은 열리는데 목록이 비는 일이 없게).
  if (menu === "shuttle_admin" && !(SHUTTLE_ADMIN_ROLES as readonly SystemRole[]).includes(role)) return true;
  if (ROLE_LOCKED_MENUS.has(menu)) return true;
  // 대시보드 집계는 테넌트 전체 데이터다. 강사 scoped 쿼리가 마련되기 전까지는
  // 강사에게 메뉴를 열면 담당 범위를 넘어 학생·출결 데이터가 노출되므로 override를 막는다.
  if (menu === "dashboard" && role === "teacher") return true;
  // 'student'는 '내 학습' 전용 역할(미니멀 셸) — 일반 메뉴를 부여하면 requireAccess(menu)가 통과해
  // 학생이 /billing 등에 직접 URL로 진입한다. 학생에게 줄 수 있는 일반 메뉴 자체가 없으므로 컬럼 전체를 잠근다.
  if (role === "student") return true;
  if (role === "master" && (menu === "owner" || menu === "admin" || menu === "dashboard" || SETTINGS_ROLE_KEYS.some(key => key === menu)) && access === "none") {
    return true;
  }
  return false;
}

/**
 * 하드코딩 MENU_ACCESS(기본값) 위에 저장된 sparse override를 셀 단위로 덮어쓴 "유효 매트릭스".
 * 순수 함수(Vitest 대상). 가드레일에 걸리는 셀(잠긴 메뉴·master 자기잠금)은 무시한다(DB 직접 변조 대비).
 * 단 강사보다 낮은 직급의 저장된 '담당'은 무시하지 않고 '읽기'(그 칸이 원래 '없음'이면 '없음')로 내린다(`storedScopedAccess`).
 */
export function resolveMatrix(overrides: readonly PermissionOverride[]): AccessMatrix {
  const matrix = Object.fromEntries(
    MENU_KEYS.map((k) => [k, { ...MENU_ACCESS[k] }]),
  ) as AccessMatrix;
  for (const o of overrides) {
    if (!matrix[o.menu]) continue;
    const access = storedScopedAccess(o.menu, o.role, o.access, matrix[o.menu][o.role]);
    if (isPermissionLocked(o.menu, o.role, access)) continue;
    matrix[o.menu][o.role] = access;
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
  let out: AccessMatrix | null = null;
  for (const o of overrides) {
    if (o.userId !== userId || !matrix[o.menu]) continue;
    // 금지 '담당'은 그 사람 역할 칸 값(= 이 줄이 없을 때의 값)보다 넓어지지 않게 내린다(storedScopedAccess).
    const access = storedScopedAccess(o.menu, role, o.access, (out ?? matrix)[o.menu][role]);
    if (isPermissionLocked(o.menu, role, access)) continue;
    out ??= { ...matrix };
    out[o.menu] = { ...out[o.menu], [role]: access };
  }
  return out ?? matrix;
}

/**
 * 겸직(관리자 계열 + 담당 반)의 **본인 강사뷰**에서도 그 사람에게 준 개인 메뉴 권한이 열리게 — 강사 행을 실제 역할 값까지 올린다.
 * 강사뷰는 '내 메뉴'와 뷰-경로 가드가 강사 행을 보는데 개인 예외는 실제 역할 행에만 얹혀(위 applyUserOverrides),
 * 관리자 화면에선 보이는 메뉴가 강사뷰에선 숨고 주소로 들어가도 강사 홈으로 튕겼다(원장 2026-10-30 *"비포클래스 허은진도 볼수있게"*).
 * 올리기만 한다(강사 행이 더 넓으면 그대로) · 개인 예외가 있는 메뉴만 · 값은 캡까지 반영된 실제 역할 칸 그대로.
 * 🔴 강사 '내 메뉴'에 설 수 있는 메뉴(TEACHER_MENU_KEYS)만 — 직원관리 같은 관리자 화면을 개인 예외로 받은 사람이 강사뷰에서
 *    그 주소로 들어가면 미니셸이 관리자 화면을 감싸는 깨진 렌더가 된다(레이아웃 뷰-경로 가드가 막던 그것).
 * ⚠️ 셸 레이아웃의 강사뷰 크롬 판정 전용 — 페이지 게이트(requireAccess)는 원래 실제 역할로 판정한다.
 */
export function openOwnGrantsInTeacherView(
  matrix: AccessMatrix,
  userId: string,
  realRole: SystemRole,
  overrides: readonly UserPermissionOverride[],
): AccessMatrix {
  if (realRole === "teacher") return matrix;
  let out: AccessMatrix | null = null;
  for (const o of overrides) {
    if (o.userId !== userId || !matrix[o.menu] || !(TEACHER_MENU_KEYS as readonly MenuKey[]).includes(o.menu)) continue;
    const real = matrix[o.menu][realRole];
    if (ACCESS_RANK[real] <= ACCESS_RANK[matrix[o.menu].teacher]) continue;
    out ??= { ...matrix };
    out[o.menu] = { ...out[o.menu], teacher: real };
  }
  return out ?? matrix;
}
