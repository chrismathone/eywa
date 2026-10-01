/**
 * 운영실을 여는 사람 → 역할 묶음 — **단일 판정 함수**(순수). 서버(`loadOverview`)와 편집기 안내가 같은 표를 읽는다.
 *
 * 묶음은 메뉴 권한이 아니라 사람의 자리로 가른다(설계 메모 2026-10-01):
 *  · 원장 = master + 슈퍼관리자(슈퍼관리자는 users 역할이 admin일 수 있어 호출부가 따로 물어 `isSuperAdmin`으로 넘긴다 — "새 제한 명단 자동 통과")
 *  · 관리자(admin) + 담당 과목(`users.subjects`) 있음 = 과목 관리자 / 없음 = 경영지원·데스크
 *  · 매니저(manager) = 실장
 *  · 그 밖(상담·회계·열람 등) = 그 밖의 직책(기본 = 실장과 같은 배치 — 민감 칸 빠짐, 금액·전화번호 가림)
 * 🔴 bare 역할 문자열 비교를 호출부에 흩지 말 것(#58) — 이 함수 한 곳.
 */
import type { SystemRole } from "@/lib/permissions";
import type { Bundle } from "./types";

export function dashboardBundleOf(input: { systemRole: SystemRole; isSuperAdmin: boolean; subjects: readonly string[] }): Bundle {
  if (input.isSuperAdmin || input.systemRole === "master") return "owner";
  if (input.systemRole === "admin") return input.subjects.length > 0 ? "subject" : "desk";
  if (input.systemRole === "manager") return "manager";
  return "other";
}

/** 묶음마다 편집기 미리보기에서 "이 역할의 권한"을 대표하는 시스템 역할(권한 상한 경고용). `other`는 후보 전부 — 하나라도 보면 보인다. */
export const BUNDLE_ROLES: Record<Bundle, readonly SystemRole[]> = {
  owner: ["master"],
  subject: ["admin"],
  desk: ["admin"],
  manager: ["manager"],
  other: ["counselor", "accountant", "viewer"],
};
