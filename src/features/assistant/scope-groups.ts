/**
 * 학원 비서 권한 범위 — 묶음 키 → 메뉴·역할(2026-11-12 · Codex 초안 · 근거 = 그 메뉴 조회가 역할별로 행을 좁히는 곳).
 * 🔴 묶음 허용 = 그 메뉴 권한이 '전체' 또는 '읽기' **그리고** 역할이 roles 안. 앱이 그 역할에게 본인·담당·과목으로 행을 좁혀 보이는 메뉴는 그 역할을 뺐다(닫는 쪽).
 *    roles가 원장뿐인 묶음은 지금 원장만 본다(행 범위를 재현하면 연다 — Codex 합의 4).
 * 표 → 묶음은 DB 대응표(s2_0096 scope_tables)가 원본이다. 새 묶음 키를 SQL에 쓰면 여기에도 한 줄(가드 scope-map.test.ts).
 * 이름(label)은 권한 표의 메뉴 이름 그대로(MENU_LABEL — 거절 안내 '○○ 권한이 필요합니다').
 */
import { MENU_LABEL, type MenuKey, type SystemRole } from "@/lib/permissions";
import type { ScopeGroup } from "./scope";

type Rule = { key: string; menus: readonly MenuKey[]; roles: readonly SystemRole[] };

const RULES: readonly Rule[] = [
  // teacher 제외: 메뉴 수준과 별개로 담당 학생 목록을 적용한다. src/features/students/server/queries.ts:491; 상세 담당 판정은 src/features/students/server/read-scope.ts:94.
  { key: "students", menus: ["students"], roles: ["master", "admin", "manager", "counselor", "accountant", "viewer"] },
  // teacher 제외: 담당 반·교시 담당·임시 위임으로 목록과 상세가 제한된다. src/features/classes/server/queries.ts:487, src/features/classes/server/queries.ts:754.
  { key: "classes", menus: ["classes"], roles: ["master", "admin", "manager", "viewer"] },
  // teacher 제외: 실제 강사는 effectiveTeacherId가 항상 본인이며 시간표의 담당 범위에 사용된다. src/lib/auth/view-mode.ts:34, src/features/timetable/server/queries.ts:688.
  { key: "timetable", menus: ["timetable"], roles: ["master", "admin", "manager", "counselor", "accountant", "viewer"] },
  // teacher 제외: full·readonly여도 강사 축은 담당 반으로 제한된다. src/features/attendance/server/queries.ts:886, src/features/attendance/live/server/queries.ts:94.
  { key: "attendance", menus: ["attendance"], roles: ["master", "admin", "manager", "accountant", "viewer"] },
  // 명시적 메뉴 full·readonly는 자리 화면을 열며 역할별 학생 제한이 없다. 자리 담당 토글만 있는 사람에게 이 묶음을 부여하지 않는다. src/app/(shell)/attendance/seat/[seat]/page.tsx:95, src/features/attendance/seat/server/queries.ts:164.
  { key: "seat_attendance", menus: ["seat_attendance"], roles: ["master", "admin", "manager", "teacher", "counselor", "accountant", "viewer", "parttime"] },
  // teacher 제외: readonly 강사는 담당 케이스만 읽는다. 보강 원장의 전체 읽기 판정은 supabase/migrations/s1_season1.sql:26109; 앱 조회 문은 src/features/makeups/server/queries.ts:11.
  { key: "makeups", menus: ["makeups"], roles: ["master", "admin", "manager"] },
  // teacher 제외: effectiveTeacherScope로 담당 반과 학생을 제한한다. src/features/grades/server/queries.ts:46, src/features/grades/unified/server/queries.ts:45.
  { key: "exams", menus: ["exams"], roles: ["master", "admin", "manager", "counselor", "viewer"] },
  // 확인된 사무실 역할만 허용한다. 상담자 조건은 사용자가 고르는 검색 조건이며 본인 상담 강제 제한은 없다. src/features/enrollment/server/queries.ts:183, src/lib/permissions.ts:262.
  { key: "enrollment", menus: ["enrollment"], roles: ["master", "admin", "manager", "counselor"] },
  // teacher 제외: 담당 학생이어도 다른 직원이 작성한 상담은 제외하고 counselor_id를 본인으로 제한한다. src/features/consultations/server/queries.ts:310, src/features/consultations/server/queries.ts:373.
  { key: "consultations", menus: ["consultations"], roles: ["master", "admin", "manager", "counselor", "viewer"] },
  // teacher 제외: 담당 학생 명단과 그 명단의 캠페인 대상으로 제한하는 경로가 있다. src/features/retention/server/queries.ts:177, src/features/retention/server/campaign-queries.ts:79.
  { key: "retention", menus: ["retention"], roles: ["master", "admin", "manager", "counselor", "accountant", "viewer"] },
  // teacher 제외: full·readonly여도 강사는 담당 학생·과목 범위다. src/features/newcomers/server/scope.ts:19, src/features/newcomers/server/followup-query.ts:26.
  { key: "newcomers", menus: ["newcomers"], roles: ["master", "admin", "manager", "counselor", "viewer"] },
  // teacher 제외: 메뉴 수준과 별개로 담당 반·교시 담당·위임 범위를 항상 적용한다. src/features/class-sheets/server/access.ts:70.
  { key: "ecs", menus: ["ecs"], roles: ["master", "admin", "manager", "viewer"] },
  // teacher 제외: 메뉴 수준과 별개로 담당 반·위임 반을 검사한다. src/features/math-sheets/server/access.ts:85.
  { key: "mcs", menus: ["mcs"], roles: ["master", "admin", "manager", "viewer"] },
  // 학원 전체 발송 관리 화면의 확인된 역할만 허용한다. 강사의 담당 원스크린 권한을 전체 보고서 열람으로 확장하지 않는다. src/lib/permissions.ts:284, src/features/report-admin/server/queries.ts:205.
  { key: "lesson_reports", menus: ["lesson_reports"], roles: ["master", "admin", "manager", "viewer"] },
  // 명시적 full·readonly 부여 시 다른 반 담임도 대상 반들을 함께 보는 기능이다. 담당 반 제한을 추가하는 역할 분기가 없다. src/features/before-class/server/queries.ts:14.
  { key: "before_class_checklist", menus: ["before_class_checklist"], roles: ["master", "admin", "manager", "teacher", "counselor", "accountant", "viewer", "parttime"] },
  // 모든 비원장 역할을 보수적으로 제외한다. staffSubjectScopes가 역할과 무관하게 목록·상세를 과목으로 제한할 수 있다. src/features/staff/department/server/subject-scope.ts:13, src/features/staff/server/queries.ts:163.
  { key: "staff", menus: ["staff"], roles: ["master"] },
  // 확인된 수납 역할은 청구·지출 전체를 읽는다. expense_requests의 본인 제출 권한은 사용하지 않는다. src/features/billing/server/queries.ts:68, src/features/billing/server/expense-visibility.ts:18.
  { key: "billing", menus: ["billing"], roles: ["master", "admin", "manager", "accountant"] },
  // teacher 제외: 기본 full이어도 담당 학생의 요청과 본인이 만든 요청만 조회한다. 사무실 경로는 전체 요청이다. src/app/(shell)/textbook-requests/page.tsx:42, src/app/(shell)/textbook-requests/page.tsx:58.
  { key: "textbook_requests", menus: ["textbook_requests"], roles: ["master", "admin", "manager", "accountant"] },
  // 확인된 메뉴 역할은 학원 회의록 전체를 조회하며 참석자·작성자 본인 제한이 없다. src/features/meetings/server/queries.ts:138, src/lib/permissions.ts:311.
  { key: "meetings", menus: ["meetings"], roles: ["master", "admin", "manager", "counselor", "accountant", "viewer"] },
  // 공용 분류 사전만 연결한다. 본문 표는 직원 연결 문서 제외와 역할별 restricted 제한이 있어 master로 닫는다. src/features/documents/server/category-queries.ts:26, src/features/documents/server/queries.ts:49.
  { key: "documents", menus: ["documents"], roles: ["master", "admin", "manager", "teacher", "counselor", "accountant", "viewer"] },
  // 학원 공용 일정·태그는 직원 전체 열람이다. 휴가 오버레이에서 이름·기간을 보인다는 이유로 휴가 원문 표까지 열지 않는다. src/features/calendar/server/queries.ts:10, src/features/calendar/server/queries.ts:34.
  { key: "calendar", menus: ["calendar"], roles: ["master", "admin", "manager", "teacher", "counselor", "accountant", "viewer"] },
  // 일반 편성·탑승 표에는 강사 본인 반 제한이 없다. 관리자 화면의 계정·위치 표는 별도로 닫는다. src/features/shuttle/server/queries.ts:28, src/features/shuttle/admin-access.ts:5.
  { key: "shuttle", menus: ["shuttle"], roles: ["master", "admin", "manager", "teacher", "counselor", "accountant", "viewer"] },
  // 확인된 재고 역할은 학원 자산·대여·실사·거래처 전체를 읽는다. readonly는 쓰기만 제한한다. src/features/inventory/server/access.ts:9, src/lib/permissions.ts:333.
  { key: "inventory", menus: ["inventory"], roles: ["master", "admin", "manager", "accountant"] },
  // teacher readonly도 공용 교재 목록 전체를 읽으며 담당 학생 범위와 구분된다. src/lib/permissions.ts:338, src/features/textbooks/server/queries.ts:96.
  { key: "textbooks", menus: ["textbooks"], roles: ["master", "admin", "manager", "teacher"] },
  // 명시적으로 급여 정책 full·readonly를 받은 역할의 정책 읽기에는 본인·과목 제한이 없다. 명세서 지정 열람과 분리한다. src/features/payroll/server/salary-access.ts:23, src/features/payroll/server/class-salary-queries.ts:50.
  { key: "salary", menus: ["payroll_settings"], roles: ["master", "admin", "manager", "teacher", "counselor", "accountant", "viewer"] },
  // 비원장은 우선 제외한다. 실제 게이트는 출석부 접근과 급여 비율 설정 접근을 모두 요구하고 강사 본인 공개 경로도 별도다. src/features/attendance/server/salary-rates.ts:15, src/features/attendance/server/salary-rates.ts:101.
  { key: "attendance_salary", menus: ["attendance_salary_settings"], roles: ["master"] },
  // 비원장은 우선 제외한다. admin·manager도 readonly이면 본인 목표만 읽으며 근거 문서도 추가 권한으로 가린다. src/lib/auth/menu-gate.ts:27, src/features/organization-okr/server.ts:25, src/features/organization-okr/server.ts:45.
  { key: "okr", menus: ["okr"], roles: ["master"] },
];

export const SCOPE_GROUPS: readonly ScopeGroup[] = RULES.map((r) => ({ ...r, label: MENU_LABEL[r.menus[0]!] }));
