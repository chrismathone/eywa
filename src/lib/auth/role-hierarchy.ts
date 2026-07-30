import type { SystemRole } from "@/lib/permissions";

// 작을수록 권한이 강함.
// 작을수록 권한이 강함. student는 직원 위계 밖(학생 본인 화면 전용) — 맨 끝.
export const ROLE_HIERARCHY: Record<SystemRole, number> = {
  master: 0,
  admin: 1,
  manager: 2,
  accountant: 3,
  counselor: 4,
  teacher: 5,
  viewer: 6,
  student: 7,
};

// master 표시 라벨 = "원장"(테넌트 소유자) — 사용자 결정 2026-07-07(2026-07-02 "owner" 통일을 정정).
// super_admin(SaaS 총괄)과는 별개 개념(직교). 전역 통일: 직원관리·역할권한 매트릭스·super-admin 콘솔 모두 "원장".
export const ROLE_LABEL: Record<SystemRole, string> = {
  master: "원장",
  admin: "관리자",
  manager: "매니저",
  accountant: "회계",
  counselor: "상담사",
  teacher: "강사",
  viewer: "참관",
  student: "학생",
};

/**
 * 현재 사용자(actor)가 대상 직원(target)에게 newRole을 부여할 수 있는지.
 * - actor는 newRole보다 엄격히 강해야 함 (낮은 인덱스).
 * - target의 현재 권한도 actor보다 약해야 함 (자기보다 강한 사람 권한 변경 금지).
 */
export function canAssignRole(args: {
  actor: SystemRole;
  targetCurrent: SystemRole;
  newRole: SystemRole;
}): boolean {
  const actorRank = ROLE_HIERARCHY[args.actor];
  const targetRank = ROLE_HIERARCHY[args.targetCurrent];
  const newRank = ROLE_HIERARCHY[args.newRole];
  return actorRank < newRank && actorRank < targetRank;
}

/** 자기보다 약한 역할만 가능한 옵션 리스트. student는 직원 역할이 아니므로 제외. */
export function assignableRoles(actor: SystemRole): SystemRole[] {
  const actorRank = ROLE_HIERARCHY[actor];
  return (Object.keys(ROLE_HIERARCHY) as SystemRole[]).filter(
    (r) => r !== "student" && ROLE_HIERARCHY[r] > actorRank,
  );
}

export function canManageStaff(actor: SystemRole): boolean {
  return actor === "master" || actor === "admin" || actor === "manager";
}

/**
 * actor가 특정 직원(target)의 민감 계정 작업(비번 재설정·이메일 변경·삭제)을 할 수 있는지.
 * 직원 관리 권한 + actor가 target보다 엄격히 강해야 함(동급·상위 계정은 못 건드림).
 */
export function canManageStaffMember(actor: SystemRole, target: SystemRole): boolean {
  if (!canManageStaff(actor)) return false;
  // 원장·관리자는 **동급까지** 관리한다(원장 지시 2026-07-29: "관리자급들까지는 풀어줘 — 어차피
  // 관리자부터는 계약이나 이런 수정이 되어야 함"). 종전 '엄격히 상위만'이라 원장이 원장을,
  // 관리자가 관리자를 손댈 수 없어 계약·이메일·비번 버튼이 통째로 사라졌다.
  // ⚠️ **상위는 여전히 불가**(관리자 → 원장 X) — 아래로 향한 권한만 넓힌 것이다.
  // 매니저는 종전대로 자기보다 낮은 직급만(관리 계열 중 가장 약한 축이라 동급 개방 대상 아님).
  // 자기 계정 파괴(삭제·퇴사)는 각 액션의 self 가드가 따로 막는다.
  if (actor === "master" || actor === "admin") return ROLE_HIERARCHY[actor] <= ROLE_HIERARCHY[target];
  return ROLE_HIERARCHY[actor] < ROLE_HIERARCHY[target];
}
