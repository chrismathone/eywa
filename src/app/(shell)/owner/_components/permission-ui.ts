import { DASHBOARD_ROLE_LABELS } from "@/features/dashboard/layout/roles";
import { isStaffRecordLocked, SHUTTLE_ADMIN_ROLES, type Access, type MenuKey, type SystemRole } from "@/lib/permissions";

/** 역할·권한 면의 세 구획(역할 표 · 강사 내 메뉴 · 개인별 권한)이 함께 쓰는 이름과 색. */
export const ROLE_LABEL: Record<SystemRole, string> = DASHBOARD_ROLE_LABELS;

export const ACCESS_LABEL: Record<Access, string> = { full: "전체", scoped: "담당", readonly: "읽기", none: "없음" };
export const ACCESS_CLS: Record<Access, string> = {
  full: "bg-primary/10 text-primary",
  scoped: "bg-blue/10 text-blue",
  readonly: "bg-bg-soft text-text-dim",
  none: "text-text-faint",
};

// 셀 편집 불가: 역할 전용 화면(원스크린/내 학습) 행 전체 + 학생 컬럼 전체(내 학습 전용 역할) +
// 원장의 owner/admin/대시보드(자기잠금 방지) + 강사 대시보드(전역 집계 누수 방지).
// permissions.ts의 isPermissionLocked와 동일 규약.
export function isCellLocked(menu: MenuKey, role: SystemRole): boolean {
  if (menu === "teacher_onescreen" || menu === "my_learning") return true;
  if (role === "student") return true;
  if (menu === "dashboard" && role === "teacher") return true;
  // 학원 비서 — 강사 화면엔 단추가 없다(isPermissionLocked와 같은 규칙).
  if (menu === "assistant" && role === "teacher") return true;
  // 셔틀 관리자 화면 — 원장·관리자 칸만(학부모 계정 DB 정책 0320a와 같은 두 역할 · isPermissionLocked와 같은 규칙).
  if (menu === "shuttle_admin" && !(SHUTTLE_ADMIN_ROLES as readonly SystemRole[]).includes(role)) return true;
  // 조직·OKR · 업무 작성센터 — 직원 역할 여섯만 쓰는 화면이라 열람·아르바이트 칸은 고정(isPermissionLocked와 같은 함수).
  if (isStaffRecordLocked(menu, role)) return true;
  if (role === "master" && (menu === "owner" || menu === "admin" || menu === "dashboard")) return true;
  return false;
}
