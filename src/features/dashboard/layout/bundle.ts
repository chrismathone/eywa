/**
 * 운영실을 여는 사람 → 역할 묶음 — **단일 판정 함수**(순수). 서버(`loadOverview`)와 편집기 안내가 같은 표를 읽는다.
 *
 * 시스템 역할 8개와 총괄 자격을 각각 구분한다(2026-10-02).
 * 관리자만 직원별로 과목 운영형/경영지원형을 고른다. 지정 전 기존 계정은 종전 과목 유무 판정을 유지한다.
 * 🔴 bare 역할 문자열 비교를 호출부에 흩지 말 것(#58) — 이 함수 한 곳.
 */
import type { SystemRole } from "@/lib/permissions";
import type { Bundle, DashboardAssignment } from "./types";

export function dashboardBundleOf(input: { systemRole: SystemRole; isSuperAdmin: boolean; subjects: readonly string[]; assignment?: DashboardAssignment }): Bundle {
  if (input.isSuperAdmin) return "super";
  if (input.systemRole === "master") return "owner";
  if (input.systemRole === "admin") return input.assignment?.adminLayout ?? (input.subjects.length > 0 ? "subject" : "desk");
  return input.systemRole;
}

/** 편집기 미리보기의 시스템 역할(권한 상한 경고용). */
export const BUNDLE_ROLES: Record<Bundle, readonly SystemRole[]> = {
  super: ["master"],
  owner: ["master"],
  subject: ["admin"],
  desk: ["admin"],
  manager: ["manager"],
  teacher: ["teacher"], counselor: ["counselor"], accountant: ["accountant"], viewer: ["viewer"], student: ["student"],
};
