/**
 * 강사 미니셸 '내 메뉴'의 **항목 표 — 단일 소스**. 드롭다운([TeacherMenu](@/components/teacher-menu))과
 * 학원 설정 '탭 및 메뉴 구성 → 강사뷰'(원장이 순서·표시를 정하는 화면)가 같은 표를 본다.
 *
 * ⚠️ 여기엔 **강사 스코핑이 적용된 페이지만** 넣는다(teacher-scope.ts). 미스코프 페이지(대시보드 등)는
 *    테넌트 전체가 새므로 노출 금지 — 스코핑하면 그때 추가.
 * 🔴 라벨은 **사전 키**다(한국어 원문은 [i18n.ts](@/features/teacher-view/i18n) 한 곳) — 여기에 문자열을
 *    다시 적으면 한/영이 갈린다. 키는 `menu.item.<menuKey>`가 원칙이고, 같은 menuKey를 두 줄이 쓰는
 *    출결 모드만 `menu.item.attendanceQuick`으로 구분한다.
 * 🔴 판정 단위는 **목적지(href)** 다 — 출결 모드와 출석부가 같은 menuKey(`attendance`)라 menuKey로는 둘을 못 가른다
 *    (관리자뷰 메뉴 구성 [menu-layout.ts](@/features/owner/menu-layout)와 같은 규약).
 * ⚠️ 이 파일은 순수 모듈이다(`"use client"` 금지) — 서버 컴포넌트가 import해도 값이 살아 있어야 한다([[#81]]).
 */
import { MENU_ICON, type AywaIconName } from "@/components/icons/aywa-icons";
import type { SheetDictKey } from "@/features/teacher-view/i18n";
import type { MenuKey } from "@/lib/permissions";

export type TeacherMenuLink = { href: string; labelKey: SheetDictKey; icon: AywaIconName; menu: MenuKey };

/** 코드 기본 순서 — 원장이 순서를 정하지 않은 학원은 이 순서 그대로(설정이 비면 지금과 같다). */
export const TEACHER_MENU_LINKS: readonly TeacherMenuLink[] = [
  // 출결 모드(2026-08-20) — 내 반 오늘 출결만 터치 몇 번으로. 원장 지시: 원스크린 상단 바에만 두니
  //   *"완전 안보인다"* → 강사의 주 진입로인 이 드롭다운에도 올린다(홈 바로 아래).
  //   ⚠️ 권한 키는 출석부와 같은 `attendance` — 새 메뉴 키를 만들면 auth_menu_access DEFAULTS 누락으로 잠긴다.
  // 🔴 출석부와 **다른 그림**이어야 한다 — 같은 드롭다운에 나란히 선다(menu-hub의 출결 모드와 같은 listChecks).
  { href: "/attendance/quick", labelKey: "menu.item.attendanceQuick", icon: "listChecks", menu: "attendance" },
  { href: "/onescreen", labelKey: "menu.item.teacher_onescreen", icon: MENU_ICON.teacher_onescreen, menu: "teacher_onescreen" },
  // 영상 제출 현황 — 관리자 화면과 같은 장부를 **내가 낸 영상 숙제만**(원장 2026-10-03 *"강사뷰에 새 매뉴 추가 … 내가 출제한것만"*).
  //   ⚠️ 권한 키는 원스크린과 같은 `teacher_onescreen`(원스크린에서 낸 숙제를 보는 화면) — 새 메뉴 키를 만들면 auth_menu_access DEFAULTS
  //   누락으로 잠긴다(출결 모드와 같은 규약). 스코프는 화면이 보고서 작성 계정으로 좁힌다(`getOwnVideoHomework`).
  { href: "/onescreen/video-homework", labelKey: "menu.item.videoHomework", icon: MENU_ICON.lesson_reports, menu: "teacher_onescreen" },
  // English Class Sheet — 영어 반별 주간 수업계획서/출석부(scoped: 담당 반만. requireEcsClassAccess 게이트).
  { href: "/ecs", labelKey: "menu.item.ecs", icon: MENU_ICON.ecs, menu: "ecs" },
  // Math Class Sheet — 수학 반별 월간 진도표(scoped: 담당 반만. requireMcsClassAccess 게이트).
  // 🔴 이 줄이 없어서 **수학만 맡은 강사 9명에게는 MCS로 가는 길이 아예 없었다**(폰엔 사이드바가 없고
  //    이 드롭다운이 강사의 유일한 진입로다). 노출 조건은 영어와 대칭(`showMcs`).
  { href: "/mcs", labelKey: "menu.item.mcs", icon: MENU_ICON.mcs, menu: "mcs" },
  { href: "/students", labelKey: "menu.item.students", icon: MENU_ICON.students, menu: "students" },
  { href: "/attendance", labelKey: "menu.item.attendance", icon: MENU_ICON.attendance, menu: "attendance" },
  { href: "/makeups", labelKey: "menu.item.makeups", icon: MENU_ICON.makeups, menu: "makeups" },
  { href: "/classes", labelKey: "menu.item.classes", icon: MENU_ICON.classes, menu: "classes" },
  { href: "/timetable", labelKey: "menu.item.timetable", icon: MENU_ICON.timetable, menu: "timetable" },
  { href: "/exams", labelKey: "menu.item.exams", icon: MENU_ICON.exams, menu: "exams" },
  { href: "/consultations", labelKey: "menu.item.consultations", icon: MENU_ICON.consultations, menu: "consultations" },
  // 신규생 관리 — 기본 teacher=none이라 원장이 역할·권한에서 강사를 '담당'으로 연 학원에서만 선다(2026-11-11). 강사는 늘 담당 범위:
  // 자기가 담임인 학생·과목만 보고 적응 피드백만 남긴다(서버가 다시 좁힌다 — newcomers/server/followup-query.ts `followupAccess`).
  // 학원 전체 집계(/newcomers/stats)는 담당 범위 계정을 이 화면으로 돌려보낸다.
  { href: "/newcomers", labelKey: "menu.item.newcomers", icon: MENU_ICON.newcomers, menu: "newcomers" },
  // 교재 요청 — 강사 스코프(본인 담당 학생) 요청 + 진행상태. 사무실은 /billing 교재 면에서 처리.
  { href: "/textbook-requests", labelKey: "menu.item.textbook_requests", icon: MENU_ICON.textbook_requests, menu: "textbook_requests" },
  // 지출결의서 — 강사가 본인 지출을 작성·제출 + 결재 진행상태 조회. 사무실은 /billing 지출 면에서 결재.
  { href: "/expense-requests", labelKey: "menu.item.expense_requests", icon: MENU_ICON.expense_requests, menu: "expense_requests" },
  // 캘린더 — 학원 공용 일정(강사 readonly 기본). 테넌트 공용 정보라 스코핑 무관.
  // 🔴 지금은 **메뉴에서 뺀 항목**이라 서지 않는다(원장 2026-09-10 "캘린더 탭은 메뉴에서 제외") — NAV 표의 `hidden`을
  //    teacherMenuKeysFor가 따른다. 되살릴 땐 그 표의 `hidden`만 푼다(이 줄은 그대로 둔다 — 입구 정책은 한 곳).
  { href: "/calendar", labelKey: "menu.item.calendar", icon: MENU_ICON.calendar, menu: "calendar" },
  // 전자결재 — 기본 teacher=none이라 학원 설정에서 강사에게(또는 그 사람에게) 연 경우에만 보인다. 문서 스코프는
  // 결재선·RLS가 정하므로(본인 관련 문서만) 미스코프 누수 없음.
  { href: "/approvals", labelKey: "menu.item.approvals", icon: MENU_ICON.approvals, menu: "approvals" },
  // 업무 작성센터 · 조직·OKR — 기본 teacher=none(원장이 강사에게 열었을 때 길이 없지 않게 입구만 둔다 · 2026-11-11).
  // 강사 '담당' = 본인 문서·본인 목표만 쓰고 본다(검토·피드백은 원장·관리자·매니저의 '전체' — 서버가 가른다, 각 server.ts).
  // 관찰 기록(/work-records/knowledge)은 업무 작성센터 안의 링크로 간다(같은 권한 · 줄을 따로 세우지 않는다).
  { href: "/work-records", labelKey: "menu.item.work_records", icon: MENU_ICON.work_records, menu: "work_records" },
  { href: "/organization/okr", labelKey: "menu.item.okr", icon: MENU_ICON.okr, menu: "okr" },
  // 수업 평가 — 강사는 **자기 평가 전용**(본인 평가지의 본인 채점만 보이고 쓸 수 있다, 원장 2026-08-19).
  // 기본 teacher=none이라 학원설정에서 연 학원에서만 보인다.
  { href: "/class-review", labelKey: "menu.item.class_review", icon: MENU_ICON.class_review, menu: "class_review" },
  { href: "/withdrawal-reports", labelKey: "menu.item.withdrawal_reports", icon: MENU_ICON.withdrawal_reports, menu: "withdrawal_reports" },
  // 비포클래스체크리스트(초안) — 기본 none. 개인별 메뉴 권한으로 연 선생님에게만 선다(읽기 = 열람).
  { href: "/before-class", labelKey: "menu.item.before_class_checklist", icon: MENU_ICON.before_class_checklist, menu: "before_class_checklist" },
  // 데이터베이스(서식 저장소) — 강사 readonly(빈 양식 다운로드). 테넌트 공용 자료라 스코핑 무관.
  { href: "/documents", labelKey: "menu.item.documents", icon: MENU_ICON.documents, menu: "documents" },
];
