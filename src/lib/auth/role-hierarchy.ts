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
  // 아르바이트 = 열람보다 아래(2026-11-05). DB 트리거 guard_user_privilege_columns는 parttime을 따로 적지 않아
  // 모르는 역할 = 99(가장 아래)로 본다 — 숫자는 다르지만 '열람보다 아래'라는 방향은 같다(이메일·재직 상태 변경 위계에만 쓰임).
  parttime: 7,
  student: 8,
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
  parttime: "아르바이트",
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
 * actor가 특정 직원(target)의 민감 계정 작업(비번 재설정·이메일 변경·삭제·역할 변경)을 할 수 있는지.
 *
 * 🔴 이 함수는 **대상 보호선만** 판정한다. "누가 직원관리 담당인가"는 여기가 아니라 **직원관리 메뉴
 * 게이트**(`canWriteTenant(role, "staff")` — 개인 예외 `userOverrides` 반영)가 정하며, 호출부는 반드시
 * **둘을 함께** 통과시켜야 한다(서버 = account-actions `loadTarget`, 화면 = staff/[id] `canManage &&`).
 * 이 함수만 단독으로 쓰면 메뉴가 잠긴 사람도 통과한다(#77).
 *
 * 규칙 = **자신 권한 이하(동급 포함) 전부**(원장 지시 2026-08-11) — `rank(actor) <= rank(target)`.
 *   · 원장  → 전원(원장 계정 포함)   · 관리자 → 관리자 이하   · 매니저 → 매니저 이하(관리자·원장 불가)
 *
 * 종전엔 동급 개방이 master·admin **에게만** 있어서(2026-07-29), 직원관리를 개인 예외로 받은 데스크
 * 매니저(김예원)가 매니저 동급 3명까지 못 봐 데스크 업무가 막혔다. 축을 하나로 통일한 것이다.
 * 🔴 **상위는 여전히 불가** — 비번 재설정으로 상위 계정을 탈취하는 권한 상승 경로를 막는 보호선이다.
 * ⚠️ 역할 **부여**는 이 함수가 아니라 `canAssignRole`(엄격히 아래만)이 막는다 — 동급 계정을 만질 수 있어도
 *    자기와 같은 등급으로 **승급**시키지는 못한다.
 * ⚠️ 자기 계정 파괴(삭제·퇴사)는 각 액션의 self 가드가 따로 막는다.
 */
export function canManageStaffMember(actor: SystemRole, target: SystemRole): boolean {
  return ROLE_HIERARCHY[actor] <= ROLE_HIERARCHY[target];
}
