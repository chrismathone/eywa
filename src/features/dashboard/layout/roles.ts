import { SYSTEM_ROLES, type SystemRole } from "@/lib/permissions";
import type { Bundle } from "./types";

/** 권한 표와 대시보드 역할 탭의 같은 이름. 총괄 자격은 시스템 역할과 별도로 표시한다. */
export const DASHBOARD_ROLE_LABELS = {
  super: "슈퍼관리자", master: "원장", admin: "관리자", manager: "실장",
  teacher: "강사", counselor: "상담", accountant: "회계", viewer: "열람", parttime: "아르바이트", student: "학생",
} as const;
export type DashboardRole = SystemRole | "super";
export const DASHBOARD_ROLES: readonly DashboardRole[] = ["super", ...SYSTEM_ROLES];
export const ROLE_BUNDLE: Record<DashboardRole, Bundle> = {
  super: "super", master: "owner", admin: "subject", manager: "manager", teacher: "teacher",
  counselor: "counselor", accountant: "accountant", viewer: "viewer", parttime: "parttime", student: "student",
};
export function roleOfBundle(bundle: Bundle): DashboardRole {
  if (bundle === "owner") return "master";
  if (bundle === "subject" || bundle === "desk") return "admin";
  return bundle;
}
